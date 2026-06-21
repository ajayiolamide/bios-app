"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Zap, LayoutTemplate, BrainCircuit,
  ArrowRight, Clock, CheckCircle2, AlertCircle,
  Lightbulb, FileText, Plus, Loader2,
} from "lucide-react";
import { useOrg } from "@/contexts/org-context";
import { createClient } from "@/lib/supabase/client";
import { QuickInsight } from "./quick-insight";
import { getDashboardData, type DashboardData } from "@/app/actions/dashboard";
import type { BusinessGoal } from "@/types/database";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "done") return <CheckCircle2 size={14} className="text-green-500" />;
  if (status === "failed") return <AlertCircle size={14} className="text-red-400" />;
  return <Clock size={14} className="text-amber-400" />;
}

// ─── Status summary ───────────────────────────────────────────────────────────
// Replaces the old dark "Feature impact" hero (segmented bar + colored dot
// legend) and the "Goal health" card (6 stat pills + a "% of goals with data
// flowing" progress bar). Both were precise but not legible at a glance,
// especially with only one or two goals where every bar just reads "100%" or
// "0%" — true but useless. This says the same things in plain sentences
// instead, and only surfaces a number when there's more than one of
// something to count.

function StatusSummary({ data }: { data: DashboardData }) {
  const {
    activeGoals, achievedGoals, missedGoals, noFeatureGoals, linkedNoDataGoals,
    trackingGoals, featureImpactSummaries, positiveImpact, inconclusiveImpact,
    negativeImpact, unmeasurableImpact, negativeImpactFeatures,
  } = data;

  const lines: { text: string; tone: "warn" | "good" | "neutral" }[] = [];

  // Goals
  if (activeGoals.length === 0) {
    lines.push({ text: "No active goals right now.", tone: "neutral" });
  } else {
    const goalWord = activeGoals.length === 1 ? "goal" : "goals";
    if (trackingGoals.length === activeGoals.length) {
      lines.push({
        text: activeGoals.length === 1
          ? "Your active goal is wired up and receiving real event data."
          : `All ${activeGoals.length} active ${goalWord} are wired up and receiving real event data.`,
        tone: "good",
      });
    } else {
      lines.push({
        text: `${trackingGoals.length} of ${activeGoals.length} active ${goalWord} ${trackingGoals.length === 1 ? "is" : "are"} actually receiving event data — the rest aren't measurable yet.`,
        tone: trackingGoals.length === 0 ? "warn" : "neutral",
      });
    }
    if (noFeatureGoals.length > 0) {
      lines.push({
        text: `${noFeatureGoals.length} active ${noFeatureGoals.length === 1 ? "goal has" : "goals have"} no feature linked to it yet.`,
        tone: "warn",
      });
    }
    if (linkedNoDataGoals.length > 0) {
      lines.push({
        text: `${linkedNoDataGoals.length} ${linkedNoDataGoals.length === 1 ? "goal has" : "goals have"} a feature linked but no events firing yet.`,
        tone: "warn",
      });
    }
  }
  if (achievedGoals.length > 0 || missedGoals.length > 0) {
    const parts: string[] = [];
    if (achievedGoals.length > 0) parts.push(`${achievedGoals.length} achieved`);
    if (missedGoals.length > 0) parts.push(`${missedGoals.length} missed`);
    lines.push({ text: `Past goals: ${parts.join(", ")}.`, tone: missedGoals.length > 0 ? "warn" : "good" });
  }

  // Feature impact
  if (featureImpactSummaries.length > 0) {
    if (negativeImpact > 0) {
      lines.push({
        text: `${negativeImpact} of ${featureImpactSummaries.length} feature${featureImpactSummaries.length === 1 ? "" : "s"} ${negativeImpact === 1 ? "is showing" : "are showing"} no real lift over non-adopters.`,
        tone: "warn",
      });
    }
    if (positiveImpact > 0) {
      lines.push({
        text: `${positiveImpact} feature${positiveImpact === 1 ? "" : "s"} proven to move ${positiveImpact === 1 ? "its" : "their"} goal.`,
        tone: "good",
      });
    }
    const stillBuilding = inconclusiveImpact + unmeasurableImpact;
    if (stillBuilding > 0) {
      lines.push({
        text: `${stillBuilding} feature${stillBuilding === 1 ? "" : "s"} still building evidence — check back once they've had more usage.`,
        tone: "neutral",
      });
    }
  }

  const toneStyles: Record<string, string> = {
    warn: "text-amber-700",
    good: "text-emerald-700",
    neutral: "text-gray-600",
  };
  const toneDot: Record<string, string> = {
    warn: "bg-amber-400",
    good: "bg-emerald-400",
    neutral: "bg-gray-300",
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-gray-800">Where things stand</p>
        <Link href="/goals" className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5 transition-colors">
          View all <ArrowRight size={11} />
        </Link>
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${toneDot[l.tone]}`} />
            <p className={`text-sm ${toneStyles[l.tone]}`}>{l.text}</p>
          </div>
        ))}
      </div>

      {negativeImpactFeatures.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-50 space-y-1.5">
          {negativeImpactFeatures.map((f) => (
            <div key={f.featureId} className="flex items-center gap-2 text-xs">
              <AlertCircle size={12} className="text-red-400 flex-shrink-0" />
              <span className="font-medium text-gray-600">{f.featureName}</span>
              <span className="text-gray-400">— showing no real lift over non-adopters</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Goal row ─────────────────────────────────────────────────────────────────

function GoalRow({
  goal, featCount, hasEvents,
}: { goal: BusinessGoal; featCount: number; hasEvents: boolean }) {
  const health = featCount === 0 ? "no-features"
    : !hasEvents ? "no-data"
    : "tracking";

  const badge =
    health === "no-features" ? (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100 font-medium">No features linked</span>
    ) : health === "no-data" ? (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-100 font-medium">No event data</span>
    ) : (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 font-medium">Tracking</span>
    );

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 font-medium truncate">{goal.title}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {goal.type} {goal.timeframe ? `· ${goal.timeframe}` : ""}
        </p>
      </div>
      {badge}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { currentOrg } = useOrg();
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
    });
  }, [currentOrg]);

  if (loading || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={20} className="animate-spin text-gray-300" />
      </div>
    );
  }

  const {
    trackingGoals, attentionGoals, featuresByGoal,
    eventCount, eventCount7d, featureCount, recentReports, doneReports,
    featureImpactSummaries,
  } = data;

  const hasGoals = data.goals.length > 0;

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
          {hasGoals && (
            <Link href="/reports"
              className="flex items-center gap-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 px-4 py-2 rounded-xl transition-colors">
              <LayoutTemplate size={14} /> Generate Report
            </Link>
          )}
        </div>
      </div>

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
          {/* ── Where things stand — one plain-language summary ───────────────── */}
          <StatusSummary data={data} />

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

        {/* Left: goals needing attention + AI insight */}
        <div className="lg:col-span-2 space-y-5">

          {attentionGoals.length > 0 && (
            <div className="bg-white border border-amber-100 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={14} className="text-amber-500" />
                <p className="text-sm font-semibold text-gray-800">Needs attention</p>
                <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">{attentionGoals.length}</span>
              </div>
              <div>
                {attentionGoals.map(g => (
                  <GoalRow
                    key={g.id}
                    goal={g}
                    featCount={featuresByGoal[g.id] ?? 0}
                    hasEvents={trackingGoals.includes(g)}
                  />
                ))}
              </div>
              <Link href="/goals" className="mt-3 flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors">
                Manage goals <ArrowRight size={11} />
              </Link>
            </div>
          )}

          {hasGoals && <QuickInsight orgId={currentOrg?.id ?? ""} hasData={eventCount > 0} />}
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
