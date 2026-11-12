import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { seedLore, seedMessages } from "../seed-data.ts";
import type { ChatMessage, LoreEntry, LoreStatus } from "../types.ts";
import { getSupabaseAdmin } from "./supabase.ts";

type LocalState = { messages: ChatMessage[]; lore: LoreEntry[] };
const localPath = path.join(process.cwd(), "data", "local.json");
let localQueue: Promise<void> = Promise.resolve();

export { assertProductionSupabaseConfigured, isSupabaseConfigured } from "./supabase.ts";

async function readLocal(): Promise<LocalState> {
  try {
    return JSON.parse(await readFile(localPath, "utf8")) as LocalState;
  } catch {
    const initial = { messages: seedMessages, lore: seedLore };
    await writeLocal(initial);
    return initial;
  }
}

async function writeLocal(state: LocalState) {
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, JSON.stringify(state, null, 2), "utf8");
}

async function mutateLocal<T>(change: (state: LocalState) => T): Promise<T> {
  let result!: T;
  const current = localQueue.then(async () => {
    const state = await readLocal();
    result = change(state);
    await writeLocal(state);
  });
  localQueue = current.catch(() => undefined);
  await current;
  return result;
}

function requireChannelId(channelId: string | undefined): string {
  if (!channelId) throw new Error("A server-resolved creator channel is required for this operation.");
  return channelId;
}

export async function listLore(channelId?: string): Promise<LoreEntry[]> {
  const client = getSupabaseAdmin();
  if (!client) return (await readLocal()).lore.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const ownedChannelId = requireChannelId(channelId);
  const { data, error } = await client.from("lore_entries").select("*")
    .eq("channel_id", ownedChannelId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load lore: ${error.message}`);
  return (data ?? []) as LoreEntry[];
}

export async function getApprovedLore(channelId: string): Promise<LoreEntry[]> {
  const client = getSupabaseAdmin();
  if (!client) {
    return (await readLocal()).lore.filter((entry) => entry.channel_id === channelId && entry.status === "approved");
  }
  const { data, error } = await client.from("lore_entries").select("*")
    .eq("channel_id", requireChannelId(channelId))
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load approved lore: ${error.message}`);
  return (data ?? []) as LoreEntry[];
}

export async function setLoreStatus(channelId: string, id: string, status: Extract<LoreStatus, "approved" | "rejected">): Promise<LoreEntry | null> {
  const client = getSupabaseAdmin();
  if (!client) {
    return mutateLocal((state) => {
      const entry = state.lore.find((item) => item.id === id && item.channel_id === channelId);
      if (!entry) return null;
      entry.status = status;
      entry.updated_at = new Date().toISOString();
      return entry;
    });
  }
  const { data, error } = await client.from("lore_entries")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("channel_id", requireChannelId(channelId))
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Could not update lore: ${error.message}`);
  return data as LoreEntry | null;
}

export async function saveChatMessage(channelId: string, input: Omit<ChatMessage, "id" | "channel_id">): Promise<ChatMessage> {
  const client = getSupabaseAdmin();
  if (!client) {
    return mutateLocal((state) => {
      const existing = state.messages.find((message) => message.twitch_message_id === input.twitch_message_id);
      if (existing) return existing;
      const message: ChatMessage = { ...input, id: randomUUID(), channel_id: channelId || "demo-channel" };
      state.messages.push(message);
      return message;
    });
  }

  const ownedChannelId = requireChannelId(channelId);
  const row = {
    channel_id: ownedChannelId,
    twitch_message_id: input.twitch_message_id,
    chatter_user_id: input.chatter_user_id ?? null,
    user_login: input.user_login,
    user_name: input.user_name,
    message_text: input.message_text,
    sent_at: input.sent_at
  };
  const { data, error } = await client.from("chat_messages").insert(row).select("*").single();
  if (!error) return data as ChatMessage;
  if (error.code !== "23505") throw new Error(`Could not save chat message: ${error.message}`);

  const { data: existing, error: existingError } = await client.from("chat_messages")
    .select("*")
    .eq("twitch_message_id", input.twitch_message_id)
    .maybeSingle();
  if (existingError) throw new Error(`Could not verify a duplicate chat message: ${existingError.message}`);
  if (!existing || existing.channel_id !== ownedChannelId) {
    throw new Error("The Twitch message ID is already associated with a different creator channel.");
  }
  return existing as ChatMessage;
}

export async function createLoreProposal(input: {
  channelId: string;
  title: string;
  summary: string;
  source_message_ids: string[];
  twitch_message_id: string;
}): Promise<LoreEntry> {
  const client = getSupabaseAdmin();
  if (!client) {
    return mutateLocal((state) => {
      const sourceMessage = state.messages.find((message) =>
        message.twitch_message_id === input.twitch_message_id && message.channel_id === input.channelId
      );
      if (!sourceMessage) throw new Error("Could not find the Twitch message for this lore proposal.");
      if (!input.source_message_ids.includes(sourceMessage.id)) {
        throw new Error("The lore proposal must include its triggering Twitch message as a source.");
      }
      const duplicate = state.lore.find((entry) =>
        entry.channel_id === input.channelId && entry.source_message_ids.includes(sourceMessage.id)
      );
      if (duplicate) return duplicate;
      const now = new Date().toISOString();
      const entry: LoreEntry = {
        title: input.title,
        summary: input.summary,
        source_message_ids: input.source_message_ids,
        id: randomUUID(),
        channel_id: input.channelId,
        status: "proposed",
        created_at: now,
        updated_at: now
      };
      state.lore.unshift(entry);
      return entry;
    });
  }

  const channelId = requireChannelId(input.channelId);
  const { data, error } = await client.rpc("create_lore_proposal_once", {
    p_channel_id: channelId,
    p_twitch_message_id: input.twitch_message_id,
    p_title: input.title,
    p_summary: input.summary,
    p_source_message_ids: input.source_message_ids
  });
  if (error) throw new Error(`Could not create lore proposal: ${error.message}`);
  const entry = Array.isArray(data) ? data[0] : data;
  if (!entry) throw new Error("Could not create lore proposal: the database returned no entry.");
  return entry as LoreEntry;
}

export async function getChatMessages(channelId: string, ids: string[]): Promise<ChatMessage[]> {
  if (ids.length === 0) return [];
  const client = getSupabaseAdmin();
  if (!client) return (await readLocal()).messages.filter((message) =>
    message.channel_id === channelId && ids.includes(message.id)
  );
  const { data, error } = await client.from("chat_messages").select("*")
    .eq("channel_id", requireChannelId(channelId))
    .in("id", ids);
  if (error) throw new Error(`Could not load source messages: ${error.message}`);
  return (data ?? []) as ChatMessage[];
}

export async function getStatus() {
  const client = getSupabaseAdmin();
  return {
    mode: client ? "supabase" : "demo",
    aiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim())
  };
}

export async function resetSeed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The demo seed command is disabled in production.");
  }
  const client = getSupabaseAdmin();
  if (!client) {
    await mutateLocal((state) => { state.messages = [...seedMessages]; state.lore = [...seedLore]; });
    return;
  }
  throw new Error("The demo seed command only supports the local development store.");
}
