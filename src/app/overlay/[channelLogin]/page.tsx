import { notFound } from "next/navigation";
import { Overlay } from "@/components/overlay";
import { getPublicChannelByLogin } from "@/lib/server/creator-auth";

export const dynamic = "force-dynamic";

export default async function ChannelOverlay({ params }: { params: Promise<{ channelLogin: string }> }) {
  const { channelLogin } = await params;
  const channel = await getPublicChannelByLogin(channelLogin);
  if (!channel) notFound();
  return <Overlay channelLogin={channel.login} />;
}
