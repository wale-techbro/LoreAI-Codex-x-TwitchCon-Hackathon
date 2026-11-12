import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Overlay } from "@/components/overlay";
import { CREATOR_SESSION_COOKIE, getCreatorContext } from "@/lib/server/creator-auth";
import { isSupabaseConfigured } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export default async function OverlayPage() {
  const cookieStore = await cookies();
  const creator = await getCreatorContext(cookieStore.get(CREATOR_SESSION_COOKIE)?.value);
  if (creator) redirect(`/overlay/${creator.channelLogin}`);
  if (isSupabaseConfigured()) redirect("/");
  return <Overlay channelLogin="demo" />;
}
