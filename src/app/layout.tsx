import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { Providers } from "@/components/Providers";
import { auth } from "@/auth";
import { listUserBusinesses } from "@/lib/business";
import type { ShellData } from "@/lib/nav-types";

// Self-hosted via next/font: fonts are fetched at build time and served from the
// app's own origin (no runtime dependency on fonts.googleapis.com). The CSS
// variables below are consumed by globals.css (--font-sans / --font-serif).
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans-next",
  display: "swap",
});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif-next",
  display: "swap",
});

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
  // Allow zoom for accessibility; the layout is responsive down to phone widths.
  maximumScale: 5,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  let shell: ShellData | null = null;
  if (session?.user?.id) {
    const businesses = await listUserBusinesses(session.user.id);
    const activeBusinessId =
      businesses.find((b) => b.id === session.activeBusinessId)?.id ?? businesses[0]?.id ?? null;
    shell = {
      user: { email: session.user.email ?? "", name: session.user.name ?? null },
      businesses,
      activeBusinessId,
    };
  }

  return (
    <html lang="en" className={`${instrumentSans.variable} ${instrumentSerif.variable}`}>
      <body>
        <Providers>
          <AppShell shell={shell}>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
