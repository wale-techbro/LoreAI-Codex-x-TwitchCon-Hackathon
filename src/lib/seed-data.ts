import type { ChatMessage, LoreEntry } from "@/lib/types";

const channelId = "demo-channel";
const base = new Date("2026-10-24T19:20:00.000Z").getTime();

export const seedMessages: ChatMessage[] = [
  { id: "msg-1", twitch_message_id: "demo-1", channel_id: channelId, user_login: "mossy", user_name: "Mossy", message_text: "the banana is ready for launch", sent_at: new Date(base).toISOString() },
  { id: "msg-2", twitch_message_id: "demo-2", channel_id: channelId, user_login: "pixelpete", user_name: "PixelPete", message_text: "captain, the banana is not aerodynamic", sent_at: new Date(base + 36_000).toISOString() },
  { id: "msg-3", twitch_message_id: "demo-3", channel_id: channelId, user_login: "junebug", user_name: "JuneBug", message_text: "we believe in you, banana", sent_at: new Date(base + 71_000).toISOString() },
  { id: "msg-4", twitch_message_id: "demo-4", channel_id: channelId, user_login: "mossy", user_name: "Mossy", message_text: "IT STUCK TO THE CEILING LMAO", sent_at: new Date(base + 108_000).toISOString() },
  { id: "msg-5", twitch_message_id: "demo-5", channel_id: channelId, user_login: "streamer", user_name: "Fern", message_text: "that banana is part of the set now", sent_at: new Date(base + 142_000).toISOString() },
  { id: "msg-6", twitch_message_id: "demo-6", channel_id: channelId, user_login: "pixelpete", user_name: "PixelPete", message_text: "banana ceiling cam when", sent_at: new Date(base + 170_000).toISOString() },
  { id: "msg-7", twitch_message_id: "demo-7", channel_id: channelId, user_login: "fernfrond", user_name: "FernFrond", message_text: "we need a banana emote now", sent_at: new Date(base + 211_000).toISOString() },
  { id: "msg-8", twitch_message_id: "demo-8", channel_id: channelId, user_login: "mossy", user_name: "Mossy", message_text: "the ceiling banana survives another stream", sent_at: new Date(base + 259_000).toISOString() }
];

export const seedLore: LoreEntry[] = [
  {
    id: "lore-banana-incident",
    channel_id: channelId,
    title: "The Banana Incident",
    summary: "During a chaotic craft stream, Fern tried to toss a banana into a prop basket. It stuck to the studio ceiling instead, and chat declared it part of the set. The community still asks for a ceiling banana cam.",
    status: "approved",
    source_message_ids: ["msg-1", "msg-2", "msg-4", "msg-5", "msg-6", "msg-8"],
    created_at: new Date(base + 300_000).toISOString(),
    updated_at: new Date(base + 300_000).toISOString()
  },
  {
    id: "lore-banana-emote",
    channel_id: channelId,
    title: "The ceiling banana emote campaign",
    summary: "After the banana stuck above the set, chat wants a banana emote and a dedicated ceiling cam.",
    status: "proposed",
    source_message_ids: ["msg-6", "msg-7", "msg-8"],
    created_at: new Date(base + 310_000).toISOString(),
    updated_at: new Date(base + 310_000).toISOString()
  }
];
