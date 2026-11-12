import { cookies } from "next/headers";
import { Lorebook } from "@/components/lorebook";
import { CREATOR_SESSION_COOKIE, getCreatorContext } from "@/lib/server/creator-auth";
import { getStatus, isSupabaseConfigured, listLore } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cookieStore = await cookies();
  const creator = await getCreatorContext(cookieStore.get(CREATOR_SESSION_COOKIE)?.value);
  const status = await getStatus();
  const entries = creator
    ? await listLore(creator.channelId)
    : !isSupabaseConfigured() ? await listLore("demo-channel") : [];
  return <Lorebook initialEntries={entries} status={{
    ...status,
    creatorConnected: Boolean(creator),
    creatorLogin: creator?.twitchLogin ?? null,
    channelLogin: creator?.channelLogin ?? null
  }} />;
}
