"use client";

// This is a CLIENT component ("use client" at the top).
// Why? Because it uses usePathname() — a hook that reads the current URL
// to highlight the active nav link. Hooks only work in client components.
// The rest of the sidebar (links, icons) is static, but this one dynamic
// piece forces the whole component to be a client component.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LayoutDashboard, TrendingUp, Receipt, FileText, PieChart } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portfolio", label: "Portfolio", icon: PieChart },
  { href: "/investments", label: "Investments", icon: TrendingUp },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/statements", label: "Statements", icon: FileText },
];

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const personId = searchParams.get("personId");

  function buildHref(base: string) {
    if (!personId) return base;
    return `${base}?personId=${personId}`;
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="bg-sidebar flex h-full w-56 flex-col border-r px-3 py-4">
      <div className="mb-6 px-2">
        <h1 className="text-lg font-semibold tracking-tight">Finance Tracker</h1>
        <p className="text-muted-foreground text-xs">Arjun & Priya</p>
      </div>

      <nav className="flex flex-col gap-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={buildHref(href)}
            className={cn(
              "flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors",
              isActive(href)
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
