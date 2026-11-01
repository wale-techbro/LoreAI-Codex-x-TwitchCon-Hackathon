import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { seedLore, seedMessages } from "../seed-data.ts";
import type { ChatMessage, LoreEntry, LoreStatus } from "../types.ts";

type LocalState = { messages: ChatMessage[]; lore: LoreEntry[] };
const localPath = path.join(process.cwd(), "data", "local.json");
let localQueue: Promise<void> = Promise.resolve();
let supabaseClient: SupabaseClient | null = null;

export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SECRET_KEY?.trim());
}

export function assertProductionSupabaseConfigured() {
  if (process.env.NODE_ENV !== "production" || isSupabaseConfigured()) return;

  const missing = ["SUPABASE_URL", "SUPABASE_SECRET_KEY"].filter((name) => !process.env[name]?.trim());
  throw new Error(`Production requires ${missing.join(" and ")}. Configure the missing Supabase environment variables.`);
}

function supabase() {
  assertProductionSupabaseConfigured();
  if (!isSupabaseConfigured()) return null;
  supabaseClient ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return supabaseClient;
}

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

async function channelId(client: SupabaseClient): Promise<string> {
  const broadcasterId = process.env.TWITCH_BROADCASTER_USER_ID;
  const identity = broadcasterId ?? "demo-channel";
  const found = await client.from("channels").select("id").eq("twitch_user_id", identity).maybeSingle();
  if (found.error) throw new Error(`Could not load Twitch channel: ${found.error.message}`);
  if (found.data) return found.data.id as string;
  const inserted = await client.from("channels").insert({
    twitch_user_id: identity,
    login: process.env.TWITCH_CHANNEL_LOGIN ?? (broadcasterId ? "channel" : "fernscorner")
  }).select("id").single();
  if (inserted.error) throw new Error(`Could not create Twitch channel: ${inserted.error.message}`);
  return inserted.data.id as string;
}

export async function listLore(): Promise<LoreEntry[]> {
  const client = supabase();
  if (!client) return (await readLocal()).lore.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const { data, error } = await client.from("lore_entries").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load lore: ${error.message}`);
  return (data ?? []) as LoreEntry[];
}

export async function getApprovedLore(): Promise<LoreEntry[]> {
  return (await listLore()).filter((entry) => entry.status === "approved");
}

export async function setLoreStatus(id: string, status: Extract<LoreStatus, "approved" | "rejected">): Promise<LoreEntry | null> {
  const client = supabase();
  if (!client) {
    return mutateLocal((state) => {
      const entry = state.lore.find((item) => item.id === id);
      if (!entry) return null;
      entry.status = status;
      entry.updated_at = new Date().toISOString();
      return entry;
    });
  }
  const { data, error } = await client.from("lore_entries").update({ status, updated_at: new Date().toISOString() }).eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(`Could not update lore: ${error.message}`);
  return data as LoreEntry | null;
}

export async function saveChatMessage(input: Omit<ChatMessage, "id" | "channel_id"> & { broadcaster_user_id?: string }): Promise<ChatMessage> {
  const client = supabase();
  if (!client) {
    return mutateLocal((state) => {
      const existing = state.messages.find((message) => message.twitch_message_id === input.twitch_message_id);
      if (existing) return existing;
      const message: ChatMessage = { ...input, id: randomUUID(), channel_id: "demo-channel" };
      state.messages.push(message);
      return message;
    });
  }
  const resolvedChannel = await channelId(client);
  const { data, error } = await client.from("chat_messages").upsert({
    channel_id: resolvedChannel,
    twitch_message_id: input.twitch_message_id,
    user_login: input.user_login,
    user_name: input.user_name,
    message_text: input.message_text,
    sent_at: input.sent_at
  }, { onConflict: "twitch_message_id" }).select("*").single();
  if (error) throw new Error(`Could not save chat message: ${error.message}`);
  return data as ChatMessage;
}

export async function createLoreProposal(input: { title: string; summary: string; source_message_ids: string[]; twitch_message_id: string }): Promise<LoreEntry> {
  const client = supabase();
  if (!client) {
    return mutateLocal((state) => {
      const sourceMessage = state.messages.find((message) => message.twitch_message_id === input.twitch_message_id);
      if (!sourceMessage) throw new Error("Could not find the Twitch message for this lore proposal.");
      if (!input.source_message_ids.includes(sourceMessage.id)) {
        throw new Error("The lore proposal must include its triggering Twitch message as a source.");
      }
      const duplicate = state.lore.find((entry) => entry.channel_id === sourceMessage.channel_id && entry.source_message_ids.includes(sourceMessage.id));
      if (duplicate) return duplicate;
      const now = new Date().toISOString();
      const entry: LoreEntry = {
        title: input.title,
        summary: input.summary,
        source_message_ids: input.source_message_ids,
        id: randomUUID(),
        channel_id: "demo-channel",
        status: "proposed",
        created_at: now,
        updated_at: now
      };
      state.lore.unshift(entry);
      return entry;
    });
  }
  const resolvedChannel = await channelId(client);
  const { data, error } = await client.rpc("create_lore_proposal_once", {
    p_channel_id: resolvedChannel,
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

export async function getChatMessages(ids: string[]): Promise<ChatMessage[]> {
  const client = supabase();
  if (!client) return (await readLocal()).messages.filter((message) => ids.includes(message.id));
  const { data, error } = await client.from("chat_messages").select("*").in("id", ids);
  if (error) throw new Error(`Could not load source messages: ${error.message}`);
  return (data ?? []) as ChatMessage[];
}

export async function getStatus() {
  assertProductionSupabaseConfigured();
  return {
    mode: isSupabaseConfigured() ? "supabase" : "demo",
    twitchConfigured: Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_ACCESS_TOKEN && process.env.TWITCH_BROADCASTER_USER_ID),
    aiConfigured: Boolean(process.env.OPENAI_API_KEY)
  };
}

export async function resetSeed() {
  const client = supabase();
  if (!client) {
    await mutateLocal((state) => { state.messages = [...seedMessages]; state.lore = [...seedLore]; });
    return;
  }
  const id = await channelId(client);
  const removedLore = await client.from("lore_entries").delete().eq("channel_id", id);
  if (removedLore.error) throw new Error(removedLore.error.message);
  const removedMessages = await client.from("chat_messages").delete().eq("channel_id", id);
  if (removedMessages.error) throw new Error(removedMessages.error.message);
  const insertedMessages = await client.from("chat_messages").insert(seedMessages.map((message) => ({
    channel_id: id,
    twitch_message_id: message.twitch_message_id,
    user_login: message.user_login,
    user_name: message.user_name,
    message_text: message.message_text,
    sent_at: message.sent_at
  }))).select("id,twitch_message_id");
  if (insertedMessages.error) throw new Error(insertedMessages.error.message);
  const idMap = new Map((insertedMessages.data ?? []).map((message) => [message.twitch_message_id, message.id]));
  const insertedLore = await client.from("lore_entries").insert(seedLore.map((entry) => ({
    channel_id: id,
    title: entry.title,
    summary: entry.summary,
    status: entry.status,
    source_message_ids: entry.source_message_ids.map((sourceId) => idMap.get(`demo-${sourceId.replace("msg-", "")}`)).filter(Boolean),
    created_at: entry.created_at,
    updated_at: entry.updated_at
  })));
  if (insertedLore.error) throw new Error(insertedLore.error.message);
}
