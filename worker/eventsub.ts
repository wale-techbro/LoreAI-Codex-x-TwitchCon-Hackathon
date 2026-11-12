import nextEnv from "@next/env";
import WebSocket from "ws";
import { answerFromLore } from "../src/lib/server/answer.ts";
import { assertProductionSupabaseConfigured, createLoreProposal, saveChatMessage } from "../src/lib/server/store.ts";
import { claimAskLoreRequest, getConnectedCreatorChannels, type ConnectedCreatorChannel } from "../src/lib/server/creator-store.ts";
import { createCreatorTwitchAuth } from "../src/lib/server/twitch-oauth.ts";

nextEnv.loadEnvConfig(process.cwd());

const endpoint = "wss://eventsub.wss.twitch.tv/ws";
const clientId = process.env.TWITCH_CLIENT_ID?.trim();
const handles = new Map<string, CreatorWorker>();
let pollTimer: NodeJS.Timeout | undefined;
let pollInProgress = false;

type ChatEvent = {
  message_id: string;
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  message: { text: string };
};

type EventSubEnvelope = {
  metadata?: { message_type?: string; message_timestamp?: string };
  payload?: {
    session?: { id: string; reconnect_url?: string };
    subscription?: { type?: string };
    event?: ChatEvent;
  };
};

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required. Configure the creator OAuth application on this worker.`);
  return value;
}

function truncateChatMessage(value: string): string {
  const chars = Array.from(value.trim());
  return chars.length > 500 ? `${chars.slice(0, 497).join("")}...` : chars.join("");
}

class CreatorWorker {
  readonly creator: ConnectedCreatorChannel;
  private socket: WebSocket | null = null;
  private previousSocket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private validationTimer: NodeJS.Timeout | undefined;
  private readonly recentSelfMessageIds = new Map<string, number>();
  private readonly repeatMessages = new Map<string, Array<{ id: string; user: string }>>();
  private auth!: Awaited<ReturnType<typeof createCreatorTwitchAuth>>;
  private readerUserId = "";
  private stopped = false;

  constructor(creator: ConnectedCreatorChannel) {
    this.creator = creator;
  }

  async start() {
    this.auth = await createCreatorTwitchAuth(this.creator);
    const validation = await this.auth.validateOrRefresh();
    this.readerUserId = validation.user_id;
    if (!validation.scopes.includes("user:write:chat")) {
      throw new Error(`@${this.creator.twitchLogin} is missing the user:write:chat permission. Reconnect the Twitch creator account.`);
    }
    if (this.readerUserId !== this.creator.twitchUserId) {
      throw new Error("The Twitch token identity does not match the connected creator account.");
    }
    this.validationTimer = setInterval(() => {
      void this.auth.validateOrRefresh().catch((error: unknown) => {
        console.error(`Twitch token validation failed for @${this.creator.twitchLogin}:`, safeError(error));
        this.stop();
      });
    }, 60 * 60 * 1000);
    this.validationTimer.unref();
    this.connect();
    console.log(`Authorized chat for @${this.creator.twitchLogin}; waiting for EventSub notifications.`);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.validationTimer);
    this.socket?.close();
    this.previousSocket?.close();
    this.socket = null;
    this.previousSocket = null;
  }

  private async subscribe(sessionId: string) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const accessToken = await this.auth.getAccessToken();
      const response = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Client-Id": required("TWITCH_CLIENT_ID", clientId),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          type: "channel.chat.message",
          version: "1",
          condition: { broadcaster_user_id: this.creator.twitchUserId, user_id: this.readerUserId },
          transport: { method: "websocket", session_id: sessionId }
        })
      });
      if (response.ok) {
        console.log(`Subscribed to channel.chat.message for @${this.creator.channelLogin}.`);
        return;
      }
      if (response.status === 401 && attempt === 0) {
        await this.auth.refreshAccessToken();
        continue;
      }
      throw new Error(`Could not subscribe to channel.chat.message for @${this.creator.channelLogin} (${response.status}).`);
    }
  }

  private connect(url = endpoint, migrated = false) {
    if (this.stopped) return;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.on("message", (raw) => {
      void (async () => {
        try {
          const message = JSON.parse(raw.toString()) as EventSubEnvelope;
          const messageType = message.metadata?.message_type;
          if (messageType === "session_welcome" && message.payload?.session) {
            if (migrated) {
              this.previousSocket?.close();
              this.previousSocket = null;
            } else {
              await this.subscribe(message.payload.session.id);
            }
            console.log(`EventSub WebSocket ready for @${this.creator.channelLogin}.`);
          } else if (messageType === "session_reconnect" && message.payload?.session?.reconnect_url) {
            console.log(`Twitch requested an EventSub session handoff for @${this.creator.channelLogin}.`);
            this.previousSocket = socket;
            this.connect(message.payload.session.reconnect_url, true);
          } else if (
            messageType === "notification" &&
            message.payload?.subscription?.type === "channel.chat.message" &&
            message.payload.event
          ) {
            await this.onChat(message.payload.event, message.metadata?.message_timestamp ?? new Date().toISOString());
          } else if (messageType === "revocation") {
            console.error(`Twitch revoked a chat subscription for @${this.creator.channelLogin}.`);
          }
        } catch (error) {
          console.error(`Could not process EventSub message for @${this.creator.channelLogin}:`, safeError(error));
        }
      })();
    });
    socket.on("error", (error) => console.error(`EventSub WebSocket error for @${this.creator.channelLogin}:`, error.message));
    socket.on("close", () => {
      if (this.socket !== socket || this.stopped) return;
      console.warn(`EventSub connection closed for @${this.creator.channelLogin}; reconnecting in 3 seconds.`);
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    });
  }

  private async sendChatMessage(message: string) {
    const text = truncateChatMessage(message);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const accessToken = await this.auth.getAccessToken();
      const response = await fetch("https://api.twitch.tv/helix/chat/messages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Client-Id": required("TWITCH_CLIENT_ID", clientId),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          broadcaster_id: this.creator.twitchUserId,
          sender_id: this.readerUserId,
          message: text
        })
      });
      if (response.status === 401 && attempt === 0) {
        await this.auth.refreshAccessToken();
        continue;
      }
      if (!response.ok) {
        console.error(`Twitch chat reply failed for @${this.creator.channelLogin} (${response.status}).`);
        return;
      }
      const value = await response.json() as { data?: Array<{ message_id?: string; is_sent?: boolean }> };
      const result = value.data?.[0];
      if (result?.is_sent === false) {
        console.error(`Twitch did not send a chat reply for @${this.creator.channelLogin}.`);
        return;
      }
      if (result?.message_id) {
        this.recentSelfMessageIds.set(result.message_id, Date.now() + 120_000);
        this.pruneSelfMessageIds();
      }
      return;
    }
  }

  private pruneSelfMessageIds() {
    const now = Date.now();
    for (const [id, expiresAt] of this.recentSelfMessageIds) {
      if (expiresAt <= now) this.recentSelfMessageIds.delete(id);
    }
  }

  private async onChat(event: ChatEvent, sentAt: string) {
    if (this.recentSelfMessageIds.has(event.message_id)) {
      this.recentSelfMessageIds.delete(event.message_id);
      return;
    }
    const saved = await saveChatMessage(this.creator.channelId, {
      twitch_message_id: event.message_id,
      chatter_user_id: event.chatter_user_id,
      user_login: event.chatter_user_login,
      user_name: event.chatter_user_name,
      message_text: event.message.text,
      sent_at: sentAt
    });
    const text = event.message.text.trim();
    const explicit = text.match(/^!lore\s+(.+)/i);
    if (explicit) {
      const summary = `${event.chatter_user_name} marked this moment for the community archive: “${explicit[1].trim()}”`;
      await createLoreProposal({
        channelId: this.creator.channelId,
        title: explicit[1].trim().slice(0, 90),
        summary,
        source_message_ids: [saved.id],
        twitch_message_id: saved.twitch_message_id
      });
      console.log(`Created or found a lore proposal from a chat moment in @${this.creator.channelLogin}.`);
      return;
    }

    const askMatch = text.match(/^!asklore(?:\s+(.+))?$/i);
    if (askMatch) {
      if (!askMatch[1]?.trim() || !event.chatter_user_id) return;
      const shouldAnswer = await claimAskLoreRequest({
        channelId: this.creator.channelId,
        chatterUserId: event.chatter_user_id,
        twitchMessageId: event.message_id
      });
      if (!shouldAnswer) return;
      const fallback = "I don't know that one yet. Maybe someone should add it with !lore!";
      const result = await answerFromLore(this.creator.channelId, askMatch[1].trim(), fallback);
      await this.sendChatMessage(result.answer);
      console.log(`Answered a rate-limited !asklore request in @${this.creator.channelLogin}.`);
      return;
    }

    const key = text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    if (key.length < 10) return;
    const previous = this.repeatMessages.get(key) ?? [];
    const occurrences = [...previous, { id: saved.id, user: saved.user_name }].slice(-5);
    this.repeatMessages.set(key, occurrences);
    const uniqueViewersBefore = new Set(previous.map((item) => item.user)).size;
    const uniqueViewersNow = new Set(occurrences.map((item) => item.user)).size;
    if (uniqueViewersBefore < 3 && uniqueViewersNow >= 3) {
      await createLoreProposal({
        channelId: this.creator.channelId,
        title: `Chat keeps saying: ${text.slice(0, 68)}`,
        summary: `The same phrase came up repeatedly in chat. Three viewers echoed: “${text.slice(0, 180)}”`,
        source_message_ids: occurrences.slice(-3).map((item) => item.id),
        twitch_message_id: saved.twitch_message_id
      });
      console.log(`Created a repeated-chat lore proposal for @${this.creator.channelLogin}.`);
    }
  }
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Unknown error.";
}

async function pollCreators() {
  if (pollInProgress) return;
  pollInProgress = true;
  try {
    const creators = await getConnectedCreatorChannels();
    const currentIds = new Set(creators.map((creator) => creator.accountId));
    for (const [accountId, handle] of handles) {
      const updated = creators.find((creator) => creator.accountId === accountId);
      if (!currentIds.has(accountId) || updated?.connectionVersion !== handle.creator.connectionVersion) {
        handle.stop();
        handles.delete(accountId);
        console.log(`Stopped EventSub for disconnected or reconnected creator account ${accountId}.`);
      }
    }
    for (const creator of creators) {
      if (handles.has(creator.accountId)) continue;
      const handle = new CreatorWorker(creator);
      try {
        await handle.start();
        handles.set(creator.accountId, handle);
      } catch (error) {
        handle.stop();
        console.error(`Could not start EventSub for @${creator.channelLogin}:`, safeError(error));
      }
    }
    if (creators.length === 0) console.log("No connected Twitch creators yet; worker is ready for creator OAuth.");
  } catch (error) {
    console.error("Could not refresh connected Twitch creators:", safeError(error));
  } finally {
    pollInProgress = false;
  }
}

async function main() {
  assertProductionSupabaseConfigured();
  required("TWITCH_CLIENT_ID", clientId);
  required("TWITCH_CLIENT_SECRET", process.env.TWITCH_CLIENT_SECRET?.trim());
  await pollCreators();
  pollTimer = setInterval(() => void pollCreators(), 30_000);
}

void main().catch((error: unknown) => {
  console.error("LORE EventSub worker could not start:", safeError(error));
  process.exitCode = 1;
});

function shutdown() {
  clearInterval(pollTimer);
  for (const worker of handles.values()) worker.stop();
  handles.clear();
}

process.on("SIGINT", () => { shutdown(); process.exit(0); });
process.on("SIGTERM", () => { shutdown(); process.exit(0); });
