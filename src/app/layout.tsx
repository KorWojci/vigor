import type { Metadata, Viewport } from "next";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Vigor", template: "%s · Vigor" },
  description: "Personal health, fitness and body-progress dashboard.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3ebdb" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1916" },
  ],
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = getSetting(getDb(), "theme");
  return (
    <html lang="en" data-theme={theme === "system" ? undefined : theme}>
      <body>{children}</body>
    </html>
  );
}
