import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { Providers } from "@/components/Providers";
import { auth } from "@/auth";
import { listUserBusinesses } from "@/lib/business";
import type { ShellData } from "@/lib/nav-types";

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
    <html lang="en">
      <body>
        <Providers>
          <AppShell shell={shell}>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
