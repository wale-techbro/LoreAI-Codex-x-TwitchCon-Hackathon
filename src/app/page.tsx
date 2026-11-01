import { Lorebook } from "@/components/lorebook";
import { getStatus, listLore } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [entries, status] = await Promise.all([listLore(), getStatus()]);
  return <Lorebook initialEntries={entries} status={status} />;
}
