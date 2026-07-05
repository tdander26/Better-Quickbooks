// Shared primary navigation, used by both the global AppShell sidebar and the
// Categorize cockpit's own left pane so they read as one design. Covers every
// real route in the app; the Categorize row carries the live inbox badge.
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ListChecks,
  Landmark,
  ArrowLeftRight,
  CheckCircle2,
  PiggyBank,
  BarChart3,
  Repeat,
  Receipt,
  History,
  Filter,
  Settings,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  hot?: boolean; // renders the "hot" accent badge (the Categorize inbox count)
}

export const NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/categorize", label: "Categorize", icon: ListChecks, hot: true },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/reconcile", label: "Reconcile", icon: CheckCircle2 },
  { href: "/budgets", label: "Budgets", icon: PiggyBank },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/recurring", label: "Recurring", icon: Repeat },
  { href: "/tax", label: "Tax", icon: Receipt },
  { href: "/imports", label: "Imports", icon: History },
  { href: "/rules", label: "Rules", icon: Filter },
  { href: "/settings", label: "Settings", icon: Settings },
];

// The five most-used destinations for the mobile bottom bar.
export const MOBILE_NAV = [
  NAV[1], // Categorize
  NAV[0], // Overview
  NAV[3], // Transactions
  NAV[6], // Reports
  NAV[11], // Settings
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
