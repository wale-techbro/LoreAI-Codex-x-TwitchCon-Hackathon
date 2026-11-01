export type LoreStatus = "proposed" | "approved" | "rejected";

export type ChatMessage = {
  id: string;
  twitch_message_id: string;
  channel_id: string;
  user_login: string;
  user_name: string;
  message_text: string;
  sent_at: string;
};

export type LoreEntry = {
  id: string;
  channel_id: string;
  title: string;
  summary: string;
  status: LoreStatus;
  source_message_ids: string[];
  created_at: string;
  updated_at: string;
};

export type LoreSource = Pick<LoreEntry, "id" | "title" | "summary" | "source_message_ids" | "created_at">;
