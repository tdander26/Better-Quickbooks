"use client";

// Global navigation shell, reskinned to the Ledger design handoff. Desktop: a
// 236px left rail with the "Ledger" wordmark and the shared nav. Mobile: a
// sticky bottom tab bar. The Categorize row carries a live "needs review" badge.
//
// The Categorize cockpit ("/categorize") renders its own full three-pane layout
// (including its own left rail), so — like "/login" — it opts out of this shell.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { NAV, MOBILE_NAV, isActive } from "@/components/nav";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const badge = useNeedsReviewCount();

  // Full-bleed routes render without the shell chrome.
  if (pathname === "/login" || pathname === "/categorize") return <>{children}</>;

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop left rail */}
      <aside
        className="sticky top-0 hidden h-dvh shrink-0 flex-col overflow-y-auto border-r px-[18px] pb-[18px] pt-[26px] md:flex"
        style={{ width: 236, borderColor: "var(--border)" }}
      >
        <div className="flex items-baseline gap-2 px-2 pb-[26px]">
          <span className="serif" style={{ fontSize: 25 }}>
            Ledger
          </span>
          <span
            className="uppercase"
            style={{ fontSize: 10.5, color: "var(--faint)", letterSpacing: "0.08em" }}
          >
            Anderson LLC
          </span>
        </div>

        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "flex items-center justify-between rounded-[7px] px-2.5 py-[9px] text-sm transition",
                  active ? "font-semibold" : "font-normal hover:bg-[var(--hover)]",
                )}
                style={{
                  color: active ? "var(--text)" : "var(--muted)",
                  background: active ? "#EFEAE0" : "transparent",
                }}
              >
                <span className="flex items-center gap-2.5">
                  <Icon size={16} strokeWidth={active ? 2.25 : 1.75} />
                  {item.label}
                </span>
                {item.hot && badge > 0 && (
                  <span
                    className="rounded-full px-[7px] py-px text-[11px] font-semibold"
                    style={{ background: "var(--accent)", color: "#FAF9F6" }}
                  >
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <form action="/api/auth/logout" method="post" className="mt-auto px-1 pt-6">
          <button className="text-xs hover:underline" style={{ color: "var(--faint)" }} type="submit">
            Sign out
          </button>
        </form>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header
          className="sticky top-0 z-10 flex items-center gap-2 border-b px-4 py-3 backdrop-blur md:hidden"
          style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}
        >
          <span className="serif" style={{ fontSize: 20 }}>
            Ledger
          </span>
          <span className="uppercase" style={{ fontSize: 9.5, color: "var(--faint)", letterSpacing: "0.08em" }}>
            Anderson LLC
          </span>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5 pb-24 md:px-6 md:pb-8">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t backdrop-blur md:hidden"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--bg) 92%, transparent)" }}
      >
        {MOBILE_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium"
              style={{ color: active ? "var(--accent)" : "var(--muted)" }}
            >
              <Icon size={20} />
              {item.label}
              {item.hot && badge > 0 && (
                <span
                  className="absolute right-1/2 top-1 translate-x-[14px] rounded-full px-[5px] text-[9px] font-semibold"
                  style={{ background: "var(--accent)", color: "#FAF9F6" }}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

// Live count of transactions still needing review, for the Categorize badge.
function useNeedsReviewCount(): number {
  const [count, setCount] = useState(0);
  const pathname = usePathname();
  useEffect(() => {
    let cancelled = false;
    fetch("/api/transactions?filter=needs_review&page=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && typeof d.total === "number") setCount(d.total);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Re-fetch on navigation so filing on the cockpit updates the badge elsewhere.
  }, [pathname]);
  return count;
}
