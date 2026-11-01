import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LORE — Community memory, still alive",
  description: "A living memory for the moments your Twitch community keeps talking about."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
