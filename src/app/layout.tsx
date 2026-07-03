import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Better Books",
  description: "Simple, friendly bookkeeping — profit & loss, balance sheet, and bank feeds.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Better Books" },
};

// This app is entirely data-backed; never prerender pages at build time (the
// database is provisioned/migrated by Netlify only around deploy, not build).
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  themeColor: "#18b463",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
