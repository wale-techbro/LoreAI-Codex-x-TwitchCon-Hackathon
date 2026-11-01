import { cookies } from "next/headers";
import { Lorebook } from "@/components/lorebook";
import { ADMIN_SESSION_COOKIE_NAME, getAdminAccess, visibleLoreEntries } from "@/lib/server/moderation-auth";
import { getStatus, listLore } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cookieStore = await cookies();
  const adminAccess = getAdminAccess(cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value ?? null);
  const [entries, status] = await Promise.all([listLore(), getStatus()]);
  const visibleEntries = visibleLoreEntries(entries, adminAccess.authorized);
  return <Lorebook initialEntries={visibleEntries} status={status} adminAccess={adminAccess} />;
}
