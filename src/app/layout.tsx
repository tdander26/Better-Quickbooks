import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Ledger — Anderson LLC",
  description:
    "A three-pane accounting cockpit — categorize bank & card activity, one tap at a time.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Ledger" },
};

// This app is entirely data-backed; never prerender pages at build time (the
// database is provisioned/migrated by Netlify only around deploy, not build).
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  themeColor: "#2a6b4f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Instrument Serif + Instrument Sans, per the design handoff. Loaded via
            <link> (matching the design files) so no build-time font fetch is needed. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Instrument+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
