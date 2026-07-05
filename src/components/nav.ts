// Shared primary navigation, used by both the global AppShell sidebar and the
// Categorize cockpit's own left pane so they read as one design. Labels follow
// the handoff; routes map to the app's real screens (the sample's unbuilt
// Invoices/Expenses/Taxes are replaced by the app's Transactions/Rules/Settings).
export interface NavItem {
  href: string;
  label: string;
  hot?: boolean; // renders the "hot" accent badge (the Categorize inbox count)
}

export const NAV: NavItem[] = [
  { href: "/", label: "Overview" },
  { href: "/categorize", label: "Categorize", hot: true },
  { href: "/transactions", label: "Transactions" },
  { href: "/accounts", label: "Banking" },
  { href: "/reports", label: "Reports" },
  { href: "/rules", label: "Rules" },
  { href: "/settings", label: "Settings" },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
