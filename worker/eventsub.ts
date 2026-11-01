import nextEnv from "@next/env";
import WebSocket from "ws";
import { assertProductionSupabaseConfigured, createLoreProposal, saveChatMessage } from "../src/lib/server/store.ts";
import { createTwitchAuth } from "./twitch-auth.ts";

nextEnv.loadEnvConfig(process.cwd());

const clientId = process.env.TWITCH_CLIENT_ID;
const channelId = process.env.TWITCH_BROADCASTER_USER_ID;
const channelLogin = process.env.TWITCH_CHANNEL_LOGIN;
const endpoint = "wss://eventsub.wss.twitch.tv/ws";
const repeatMessages = new Map<string, Array<{ id: string; user: string }>>();
let activeSocket: WebSocket | null = null;
let previousSocket: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | undefined;
let twitchAuth: Awaited<ReturnType<typeof createTwitchAuth>> | null = null;
let chatReaderUserId: string | null = null;

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required. Copy .env.example to .env and fill in Twitch settings.`);
  return value;
}

async function subscribe(sessionId: string) {
  const userId = chatReaderUserId;
  if (!twitchAuth || !clientId || !userId) throw new Error("Twitch authentication has not been initialized.");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const accessToken = await twitchAuth.getAccessToken();
    const response = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": clientId,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "channel.chat.message",
        version: "1",
        condition: { broadcaster_user_id: channelId, user_id: userId },
        transport: { method: "websocket", session_id: sessionId }
      })
    });
    if (response.ok) {
      console.log(`Subscribed to chat for ${channelLogin ?? channelId}.`);
      return;
    }
    if (response.status === 401 && attempt === 0) {
      await twitchAuth.refreshAccessToken();
      continue;
    }
    throw new Error(`Could not subscribe to channel.chat.message (${response.status}).`);
  }
}

async function onChat(event: {
  message_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  message: { text: string };
}, sentAt: string) {
  const saved = await saveChatMessage({
    twitch_message_id: event.message_id,
    user_login: event.chatter_user_login,
    user_name: event.chatter_user_name,
    message_text: event.message.text,
    sent_at: sentAt
  });
  console.log(`Saved @${saved.user_login}: ${saved.message_text}`);

  const text = event.message.text.trim();
  const explicit = text.match(/^!lore\s+(.+)/i);
  if (explicit) {
    const summary = `${event.chatter_user_name} marked this moment for the community archive: “${explicit[1].trim()}”`;
    await createLoreProposal({
      title: explicit[1].trim().slice(0, 90),
      summary,
      source_message_ids: [saved.id],
      twitch_message_id: saved.twitch_message_id
    });
    console.log(`Created a proposed lore entry from @${saved.user_login}'s !lore message.`);
    return;
  }

  const key = text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (key.length < 10) return;
  const occurrences = repeatMessages.get(key) ?? [];
  occurrences.push({ id: saved.id, user: saved.user_name });
  repeatMessages.set(key, occurrences.slice(-5));
  if (occurrences.length === 3) {
    await createLoreProposal({
      title: `Chat keeps saying: ${text.slice(0, 68)}`,
      summary: `The same phrase came up repeatedly in chat. Three viewers echoed: “${text.slice(0, 180)}”`,
      source_message_ids: occurrences.slice(-3).map((item) => item.id),
      twitch_message_id: saved.twitch_message_id
    });
    console.log("Created a repeated-chat lore proposal.");
  }
}

function connect(url = endpoint, migrated = false) {
  const socket = new WebSocket(url);
  activeSocket = socket;
  socket.on("message", (raw) => {
    void (async () => {
      try {
        const message = JSON.parse(raw.toString()) as {
          metadata?: { message_type?: string; message_timestamp?: string };
          payload?: { session?: { id: string; reconnect_url?: string }; event?: Parameters<typeof onChat>[0] };
        };
        const messageType = message.metadata?.message_type;
        if (messageType === "session_welcome" && message.payload?.session) {
          if (migrated) {
            previousSocket?.close();
            previousSocket = null;
          } else {
            await subscribe(message.payload.session.id);
          }
          console.log(migrated ? "EventSub session resumed." : "EventSub WebSocket ready.");
        }
        if (messageType === "session_reconnect" && message.payload?.session?.reconnect_url) {
          console.log("Twitch requested a session handoff; reconnecting.");
          previousSocket = socket;
          connect(message.payload.session.reconnect_url, true);
        }
        if (messageType === "notification" && message.payload?.event) {
          await onChat(message.payload.event, message.metadata?.message_timestamp ?? new Date().toISOString());
        }
        if (messageType === "revocation") console.error("Twitch revoked the EventSub subscription:", raw.toString());
      } catch (error) {
        console.error("Could not process EventSub message:", error);
      }
    })();
  });
  socket.on("error", (error) => console.error("EventSub WebSocket error:", error.message));
  socket.on("close", () => {
    if (activeSocket !== socket) return;
    console.warn("EventSub connection closed; reconnecting in 3 seconds.");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connect(), 3000);
  });
}

async function main() {
  assertProductionSupabaseConfigured();
  required("TWITCH_CLIENT_ID", clientId);
  required("TWITCH_CHANNEL_LOGIN", channelLogin);
  required("TWITCH_BROADCASTER_USER_ID", channelId);
  twitchAuth = await createTwitchAuth();
  const validation = await twitchAuth.validateOrRefresh();
  chatReaderUserId = validation.user_id;
  console.log(`Authorized chat reader @${validation.login}; token expires in ${validation.expires_in}s.`);
  const tokenValidationTimer = setInterval(() => {
    void twitchAuth?.validateOrRefresh().catch((error: unknown) => {
      console.error("Twitch token validation failed; stopping worker:", error instanceof Error ? error.message : "Unknown error.");
      process.exit(1);
    });
  }, 60 * 60 * 1000);
  tokenValidationTimer.unref();
  connect();
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

process.on("SIGINT", () => { activeSocket?.close(); process.exit(0); });
process.on("SIGTERM", () => { activeSocket?.close(); process.exit(0); });
