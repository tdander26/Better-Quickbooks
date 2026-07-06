"use client";

// Responsive navigation shell. Desktop: fixed left sidebar. Mobile: sticky
// bottom tab bar with large touch targets. The active route is highlighted.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  LayoutDashboard,
  Landmark,
  ArrowLeftRight,
  BarChart3,
  Filter,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { BusinessSwitcher } from "@/components/BusinessSwitcher";
import { SignOutButton } from "@/components/SignOutButton";
import type { ShellData } from "@/lib/nav-types";

// Routes that render their own full-screen chrome (auth / onboarding) — the app
// shell is hidden on these.
const BARE_ROUTES = ["/login", "/signup", "/select-business", "/business/new", "/invite"];

function isBareRoute(pathname: string) {
  return BARE_ROUTES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/rules", label: "Rules", icon: Filter },
  { href: "/settings/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

// The four most-used destinations get the mobile bottom bar; the rest live under
// Settings / are reachable from the dashboard.
const MOBILE_NAV = [NAV[0], NAV[2], NAV[3], NAV[5]];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppShell({ children, shell }: { children: ReactNode; shell: ShellData | null }) {
  const pathname = usePathname();
  if (isBareRoute(pathname) || !shell) return <>{children}</>;

  // Highlight the single best (longest) matching nav entry, so /settings/team
  // doesn't also light up /settings.
  const activeHref = [...NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((n) => isActive(pathname, n.href))?.href;

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop sidebar */}
      <aside
        className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r px-3 py-5 md:flex"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="mb-5">
          {shell.businesses.length > 0 ? (
            <BusinessSwitcher businesses={shell.businesses} activeBusinessId={shell.activeBusinessId} />
          ) : (
            <div className="flex items-center gap-2 px-2">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-b from-brand-400 to-brand-600 text-white">
                <Wallet size={18} />
              </div>
              <div className="text-sm font-semibold">Better Books</div>
            </div>
          )}
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = item.href === activeHref;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
                  active ? "bg-brand-500/15 text-brand-700 dark:text-brand-300" : "muted hover:bg-black/5 dark:hover:bg-white/5"
                )}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-1 px-1 pt-3">
          <div className="muted truncate px-1 text-xs" title={shell.user.email}>
            {shell.user.email}
          </div>
          <SignOutButton className="muted inline-flex items-center gap-1.5 text-xs hover:underline" />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header
          className="sticky top-0 z-10 flex items-center gap-2 border-b px-4 py-3 backdrop-blur md:hidden"
          style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}
        >
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-b from-brand-400 to-brand-600 text-white">
            <Wallet size={16} />
          </div>
          <span className="font-semibold">Better Books</span>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5 pb-24 md:px-6 md:pb-8">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t backdrop-blur md:hidden"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg) 92%, transparent)" }}
      >
        {MOBILE_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
                active ? "text-brand-600 dark:text-brand-400" : "muted"
              )}
            >
              <Icon size={20} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
