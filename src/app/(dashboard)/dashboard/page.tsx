"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Zap, LayoutTemplate, BrainCircuit, Trophy,
  ArrowRight, Clock, CheckCircle2,
  Lightbulb, FileText, Plus,
} from "lucide-react";
import { useOrg } from "@/contexts/org-context";
import { createClient } from "@/lib/supabase/client";
import { QuickInsight } from "./quick-insight";
import { GettingStarted } from "./getting-started";
import { getDashboardData, type DashboardData } from "@/app/actions/dashboard";
import { getFeatureImpactSummaries } from "@/app/actions/feature-impact";
import { getGoalProgress } from "@/app/actions/metrics";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Mirrors the same naive pluralization used on the Goals page — an org can
// rename "Product Goal" to whatever fits their own vocabulary (Settings →
// Terminology), and this just needs to read that back consistently.
function pluralize(label: string): string {
  return label.toLowerCase().endsWith("s") ? label : `${label}s`;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "done") return <CheckCircle2 size={14} className="text-green-500" />;
  if (status === "failed") return <AlertCircle size={14} className="text-red-400" />;
  return <Clock size={14} className="text-amber-400" />;
}

// ─── Goal hierarchy hero ───────────────────────────────────────────────────────
// Replaces the old "Where things stand" bullet list and "Needs attention" row
// list with one visual that shows the actual shape of the work: each real
// Business Goal, the Product Goals moving it, and how close each one is —
// all at a glance, no reading required.

type Objective = DashboardData["objectives"][number];
type Goal = DashboardData["goals"][number];
type ProgressMap = DashboardData["goalProgress"];

function ProgressRing({ pct }: { pct: number | null }) {
  const size = 52, stroke = 4.5, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const clamped = pct === null ? 0 : Math.min(Math.max(pct, 0), 100);
  const offset = c - (clamped / 100) * c;
  const hit = pct !== null && pct >= 100;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEF2FF" strokeWidth={stroke} />
        {pct !== null && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={hit ? "#10B981" : "#6366F1"} strokeWidth={stroke}
            strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] font-bold text-gray-800">{pct !== null ? `${Math.min(pct, 999)}%` : "—"}</span>
      </div>
    </div>
  );
}

function ProductGoalRow({ goal, progress }: { goal: Goal; progress: ProgressMap[string] | undefined }) {
  const ratio = progress?.progressRatio ?? null;
  const pct = ratio !== null ? Math.round(ratio * 100) : null;
  const hit = pct !== null && pct >= 100;
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${pct === null ? "bg-gray-200" : hit ? "bg-emerald-400" : "bg-indigo-300"}`} />
      <span className="text-[13px] text-gray-700 truncate flex-1">{goal.title}</span>
      <div className="w-16 h-1 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
        {pct !== null && (
          <div className={`h-full rounded-full ${hit ? "bg-emerald-400" : "bg-indigo-400"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        )}
      </div>
      <span className="text-[11px] text-gray-400 w-10 text-right flex-shrink-0">{pct !== null ? `${pct}%` : "—"}</span>
    </div>
  );
}

function BusinessGoalBlock({
  objective, goals, goalProgress, labelPlural,
}: { objective: Objective; goals: Goal[]; goalProgress: ProgressMap; labelPlural: string }) {
  const linked = goals.filter(g => g.company_objective_id === objective.id);
  const ratios = linked
    .map(g => goalProgress[g.id]?.progressRatio)
    .filter((r): r is number => typeof r === "number");
  const pct = ratios.length ? Math.round((ratios.reduce((s, r) => s + r, 0) / ratios.length) * 100) : null;

  return (
    <div className="flex gap-4 py-4 border-b border-gray-50 last:border-0">
      <ProgressRing pct={pct} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <Trophy size={11} className="text-indigo-400 flex-shrink-0" />
          <p className="text-[13px] font-bold text-gray-900 truncate">{objective.title}</p>
        </div>
        <p className="text-[11px] text-gray-400 mt-0.5 mb-2">
          {[objective.target, objective.timeframe].filter(Boolean).join(" · ") || "No target set"}
        </p>
        {linked.length === 0 ? (
          <p className="text-xs text-gray-400">No {labelPlural} linked yet.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {linked.map(g => <ProductGoalRow key={g.id} goal={g} progress={goalProgress[g.id]} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function GoalsOverview({ data, labelPlural }: { data: DashboardData; labelPlural: string }) {
  const { objectives, goals, goalProgress } = data;
  const activeGoals = goals.filter(g => g.status === "active");
  const unlinked = activeGoals.filter(g => !g.company_objective_id);

  // Attention items: objectives with no linked goals, unlinked goals, goals with no progress data
  const needsAttention: string[] = [];
  objectives.forEach(o => {
    if (!activeGoals.some(g => g.company_objective_id === o.id)) {
      needsAttention.push(`"${o.title}" has no ${labelPlural.toLowerCase()} linked`);
    }
  });
  if (unlinked.length > 0) needsAttention.push(`${unlinked.length} ${labelPlural.toLowerCase()} not linked to a business goal`);
  activeGoals.forEach(g => {
    if (goalProgress[g.id]?.progressRatio === null || goalProgress[g.id] === undefined) {
      needsAttention.push(`"${g.title}" has no KPI tracking set up`);
    }
  });
  const attentionCount = needsAttention.length;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Business Goal → {labelPlural}</p>
        <div className="flex items-center gap-3">
          {attentionCount > 0 && (
            <Link href="/goals" className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors px-2.5 py-1 rounded-full">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
              </span>
              {attentionCount} pending requirement{attentionCount !== 1 ? "s" : ""}
            </Link>
          )}
          <Link href="/goals" className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5 transition-colors">
            Manage <ArrowRight size={11} />
          </Link>
        </div>
      </div>

      {objectives.length === 0 ? (
        <p className="text-sm text-gray-400 py-3">
          No business goal set yet — add the one thing that matters most this quarter on the Goals page.
        </p>
      ) : (
        <div>
          {objectives.map(o => (
            <BusinessGoalBlock key={o.id} objective={o} goals={activeGoals} goalProgress={goalProgress} labelPlural={labelPlural} />
          ))}
        </div>
      )}

      {unlinked.length > 0 && (
        <div className={objectives.length > 0 ? "mt-1 pt-3 border-t border-gray-50" : ""}>
          <p className="text-[11px] text-gray-400 mb-1">Not linked to a business goal yet</p>
          <div className="divide-y divide-gray-50">
            {unlinked.map(g => <ProductGoalRow key={g.id} goal={g} progress={goalProgress[g.id]} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { currentOrg } = useOrg();
  const productGoalLabelPlural = pluralize(currentOrg?.product_goal_label?.trim() || "Product Goal");
  const [firstName, setFirstName] = useState("there");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  // Greeting based on the viewer's own clock, not the server's.
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  useEffect(() => {
    createClient().auth.getUser().then(({ data: { user } }) => {
      const name = user?.user_metadata?.full_name?.split(" ")[0] ?? user?.email?.split("@")[0] ?? "there";
      setFirstName(name);
    });
  }, []);

  useEffect(() => {
    // This is the fix for the dashboard showing stale/zeroed-out numbers:
    // it now loads data for whichever org is actually selected in the
    // sidebar (currentOrg, from the same shared context every other page
    // uses), instead of a server-side guess at "the" org that broke
    // silently for any account with more than one membership row.
    if (!currentOrg) return;
    setLoading(true);
    getDashboardData(currentOrg.id).then((d) => {
      setData(d);
      setLoading(false);

      // Feature Impact is the heaviest computation on this page (a real
      // query per launched feature) — it's fetched here, after the rest of
      // the dashboard has already rendered, instead of gating everything
      // else on it. Same deferred pattern the Goals page uses for this
      // exact same call.
      getFeatureImpactSummaries(currentOrg.id).then((featureImpactSummaries) => {
        setData((prev) => prev ? { ...prev, featureImpactSummaries } : prev);
      });

      // Goal progress fans out into a trend-data query per KPI in the org —
      // also deferred, also matching the Goals page's pattern. The hero
      // above renders fine with an empty map (every bar/ring just falls
      // back to "—" until this fills in a moment later).
      getGoalProgress(currentOrg.id).then((goalProgress) => {
        setData((prev) => prev ? { ...prev, goalProgress } : prev);
      });
    });
  }, [currentOrg]);

  if (loading || !data) {
    // A bare spinner on an otherwise blank page makes a ~5s load feel like
    // dead time — there's nothing to look at, so it's not obvious anything
    // is actually happening. This mirrors the real layout below (same
    // header, same card shapes) with pulsing placeholders instead, so the
    // page looks like it's already assembling itself rather than stalled.
    // The header text itself is real, not a placeholder — greeting/date
    // never depend on the data fetch, so there's no reason to fake it.
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-7 animate-pulse">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{greeting}, {firstName} 👋</h1>
            <p className="text-sm text-gray-400 mt-1">{today}</p>
          </div>
          <div className="h-9 w-32 bg-gray-100 rounded-xl" />
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-1">
          <div className="h-2.5 w-40 bg-gray-100 rounded mb-4" />
          {[...Array(2)].map((_, i) => (
            <div key={i} className="flex gap-4 py-3">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex-shrink-0" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-3 w-1/3 bg-gray-100 rounded" />
                <div className="h-2 w-2/3 bg-gray-50 rounded" />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-gray-100 rounded-2xl h-40" />
          <div className="space-y-5">
            <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-3.5">
              <div className="h-2.5 w-24 bg-gray-100 rounded mb-1" />
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-gray-100 flex-shrink-0" />
                  <div className="h-2.5 flex-1 bg-gray-50 rounded" />
                  <div className="h-2.5 w-8 bg-gray-100 rounded flex-shrink-0" />
                </div>
              ))}
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl h-32" />
          </div>
        </div>
      </div>
    );
  }

  const {
    eventCount, eventCount7d, featureCount, recentReports, doneReports,
    featureImpactSummaries,
  } = data;

  // Show the overview as soon as there's a Business Goal OR a Product Goal —
  // previously this only checked Product Goals, so a user who had set a
  // Business Goal but not yet a Product Goal still saw "Get started".
  const hasGoals = data.objectives.length > 0 || data.goals.length > 0;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-7">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{greeting}, {firstName} 👋</h1>
          <p className="text-sm text-gray-400 mt-1">{today}</p>
        </div>
        {/* Only one action when there's nothing set up yet — a "Generate
            Report" button with nothing to report on is just noise. */}
        <div className="flex items-center gap-2">
          <Link href="/goals"
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-xl transition-colors">
            <Plus size={14} /> Add Goal
          </Link>
          {data.goals.length > 0 && (
            <Link href="/reports"
              className="flex items-center gap-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 px-4 py-2 rounded-xl transition-colors">
              <LayoutTemplate size={14} /> Generate Report
            </Link>
          )}
        </div>
      </div>

      {/* ── Getting started checklist (auto-hides when all done or dismissed) ── */}
      <GettingStarted
        hasGoal={data.objectives.length > 0 || data.goals.length > 0}
        hasFeature={featureCount > 0}
        hasData={eventCount > 0}
        hasReport={doneReports > 0}
      />

      {/* ── Empty state: nothing set up at all ───────────────────────────────── */}
      {/* One card, one action — replaces what used to be two separate "no
          feature impact" and "no goals" cards stacked on top of each other,
          each with their own button. Feature impact can't exist before a
          goal does, so showing both was redundant noise. */}
      {!hasGoals ? (
        <div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 rounded-2xl p-6">
          <p className="font-semibold text-gray-900 mb-1">Get started</p>
          <p className="text-sm text-gray-500 max-w-lg">
            Add a business goal, then log a feature against it. Once it&apos;s launched and tracking real usage, this page will show whether it actually moved the goal.
          </p>
          <Link href="/goals"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-xl transition-colors">
            <Plus size={14} /> Add your first goal
          </Link>
        </div>
      ) : (
        <>
          {/* ── Business Goal → Product Goals → indicators, in one view ───────── */}
          <GoalsOverview data={data} labelPlural={productGoalLabelPlural} />

          {featureImpactSummaries.length === 0 && (
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5 flex items-center justify-between gap-6">
              <p className="text-sm text-gray-500">
                No feature impact data yet — launch a tracked feature and give it a week of real usage to see whether it moved its goal.
              </p>
              <Link href="/feature-metrics"
                className="flex-shrink-0 flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors">
                Plan a feature <ArrowRight size={11} />
              </Link>
            </div>
          )}
        </>
      )}

      {/* ── Middle row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: AI insight */}
        <div className="lg:col-span-2 space-y-5">
          {(data.objectives.length > 0 || data.goals.length > 0) && <QuickInsight orgId={currentOrg?.id ?? ""} hasData={eventCount > 0} />}
        </div>

        {/* Right: stats + recent reports */}
        <div className="space-y-5">

          <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">At a glance</p>

            {[
              { icon: Zap,        color: "text-blue-500 bg-blue-50",    label: "Events (7d)",       value: eventCount7d.toLocaleString() },
              { icon: Zap,        color: "text-slate-400 bg-slate-50",  label: "Events total",      value: eventCount.toLocaleString() },
              { icon: Lightbulb,  color: "text-violet-500 bg-violet-50",label: "Active features",   value: featureCount.toString() },
              { icon: LayoutTemplate, color: "text-indigo-500 bg-indigo-50", label: "Reports done", value: doneReports.toString() },
            ].map(({ icon: Icon, color, label, value }) => (
              <div key={label} className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
                  <Icon size={13} />
                </div>
                <p className="text-sm text-gray-600 flex-1">{label}</p>
                <p className="text-sm font-bold text-gray-900">{value}</p>
              </div>
            ))}

            {/* Single, non-duplicated link out to AI Analyst — replaces what
                used to be a whole separate "Quick actions" panel whose other
                three links just repeated buttons already on this page. */}
            <Link href="/ai-analyst" className="flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-700 transition-colors pt-1 border-t border-gray-50 !mt-3">
              <BrainCircuit size={12} /> Ask AI about this workspace <ArrowRight size={10} />
            </Link>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Recent reports</p>
              <Link href="/reports" className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5 transition-colors">
                All <ArrowRight size={11} />
              </Link>
            </div>
            {!recentReports.length ? (
              <div className="text-center py-5">
                <FileText size={22} className="mx-auto mb-2 text-gray-200" />
                <p className="text-xs text-gray-400">No reports yet</p>
                <Link href="/reports" className="text-xs text-indigo-500 hover:underline mt-1 inline-block">Generate one →</Link>
              </div>
            ) : (
              <div className="space-y-3">
                {recentReports.map(r => (
                  <div key={r.id} className="flex items-start gap-2.5">
                    <StatusIcon status={r.status} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-700 truncate">{r.template_name}</p>
                      <p className="text-[11px] text-gray-400">{r.period} · {timeAgo(r.created_at)}</p>
                    </div>
                    {r.file_url && r.status === "done" && (
                      <a href={r.file_url} target="_blank" rel="noreferrer"
                        className="flex-shrink-0 text-[10px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors">
                        ↓
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
