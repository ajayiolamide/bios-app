"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Database,
  Zap,
  GitBranch,
  Users,
  BrainCircuit,
  LayoutTemplate,
  Settings,
  ChevronRight,
  Lightbulb,
  Trophy,
  Figma,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OrgSwitcher } from "./org-switcher";

// ─── Nav structure ────────────────────────────────────────────────────────────

const nav = [
  {
    section: null,
    items: [
      { label: "Overview",      href: "/dashboard",   icon: LayoutDashboard, badge: null },
    ],
  },
  {
    section: "Analysis",
    items: [
      { label: "Goals",              href: "/goals",            icon: Trophy,      badge: null },
      { label: "Feature Metrics",   href: "/feature-metrics",  icon: Lightbulb,   badge: null },
      { label: "User Journeys",     href: "/funnels",          icon: GitBranch,   badge: null },
      { label: "Cohorts",           href: "/cohorts",          icon: Users,       badge: null },
    ],
  },
  {
    section: "Data",
    items: [
      { label: "Sources",       href: "/sources",     icon: Database,        badge: null },
      { label: "Events",        href: "/events",      icon: Zap,             badge: null },
    ],
  },
  {
    section: "Intelligence",
    items: [
      { label: "AI Analyst",    href: "/ai-analyst",  icon: BrainCircuit,    badge: null },
      { label: "Reports",       href: "/reports",     icon: LayoutTemplate,  badge: null },
      { label: "Figma Tracking",href: "/figma",       icon: Figma,           badge: "Soon" },
    ],
  },
];

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Logo */}
      <div className="flex h-14 items-center px-4 border-b border-sidebar-border flex-shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-metrik-white.svg" alt="Metrik" className="h-5 w-auto" />
      </div>

      {/* Org switcher */}
      <div className="px-3 py-2.5 border-b border-sidebar-border flex-shrink-0">
        <OrgSwitcher />
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {nav.map((group, gi) => (
          <div key={gi}>
            {group.section && (
              <p className="px-2 mb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                {group.section}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group flex items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-slate-400 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    )}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon className={cn("h-4 w-4 shrink-0 transition-colors", active ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-400")} />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.badge ? (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 flex-shrink-0">
                        {item.badge}
                      </span>
                    ) : active ? (
                      <ChevronRight className="h-3 w-3 text-indigo-400 flex-shrink-0 opacity-60" />
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: Settings */}
      <div className="px-2 py-3 border-t border-sidebar-border flex-shrink-0">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all",
            isActive("/settings")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-slate-400 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          )}
        >
          <Settings className="h-4 w-4 shrink-0 text-slate-500" />
          Settings
        </Link>
      </div>
    </aside>
  );
}
