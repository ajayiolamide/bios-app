"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  Sparkles, ArrowRight, Loader2, CheckCircle2,
  Zap, Target, Lightbulb, ChevronRight,
} from "lucide-react";
import {
  proposeObjectiveFromDescription,
  createCompanyObjective,
} from "@/app/actions/company-objectives";

// ─── Quick prompt chips shown on the goal step ────────────────────────────────
const PROMPT_CHIPS = [
  "Grow revenue by reducing friction in checkout",
  "Improve user retention past week 4",
  "Cut claims processing time by 30%",
  "Increase feature adoption for new users",
  "Reduce churn in the first 30 days",
];

// ─── Timeframes ───────────────────────────────────────────────────────────────
const TIMEFRAMES = [
  "Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026",
  "H1 2026", "H2 2026", "Annual 2026",
  "Q1 2027", "Annual 2027",
];

type ProposedGoal = {
  title: string;
  target: string;
  timeframe: string;
  description: string;
};

type WizardStep = "goal_describe" | "goal_confirm" | "next_steps";

export default function OnboardingPage() {
  const router = useRouter();

  // User + org state
  const [firstName, setFirstName] = useState("");
  const [orgId, setOrgId] = useState<string | null>(null);

  // Wizard
  const [step, setStep] = useState<WizardStep>("goal_describe");

  // Step 1 – describe
  const [description, setDescription] = useState("");
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [proposePending, startPropose] = useTransition();

  // Step 2 – confirm/edit
  const [proposed, setProposed] = useState<ProposedGoal | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [editTimeframe, setEditTimeframe] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savePending, startSave] = useTransition();

  // Step 3 – next steps (no state needed)

  // ── Load user + org on mount ────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push("/login"); return; }

      const name = user.user_metadata?.full_name?.split(" ")[0]
        ?? user.email?.split("@")[0]
        ?? "";
      setFirstName(name);

      // Fetch the org this user owns (created via create-workspace)
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (org) setOrgId(org.id);
    });
  }, [router]);

  // ── AI: propose goal from description ──────────────────────────────────────
  function handlePropose() {
    if (!description.trim()) return;
    setProposeError(null);
    startPropose(async () => {
      const result = await proposeObjectiveFromDescription(description);
      if (result.error) {
        setProposeError(result.error);
        return;
      }
      const goal: ProposedGoal = {
        title: result.title ?? "",
        target: result.target ?? "",
        timeframe: result.timeframe ?? TIMEFRAMES[1],
        description: result.description ?? "",
      };
      setProposed(goal);
      setEditTitle(goal.title);
      setEditTarget(goal.target);
      setEditTimeframe(goal.timeframe);
      setEditDesc(goal.description);
      setStep("goal_confirm");
    });
  }

  // ── Save confirmed goal ─────────────────────────────────────────────────────
  function handleSaveGoal() {
    if (!orgId) { setSaveError("Couldn't find your workspace. Try refreshing."); return; }
    setSaveError(null);
    startSave(async () => {
      const result = await createCompanyObjective(orgId, {
        title: editTitle,
        target: editTarget,
        timeframe: editTimeframe,
        description: editDesc,
      });
      if (result.error) { setSaveError(result.error); return; }
      setStep("next_steps");
    });
  }

  // ── Progress bar ────────────────────────────────────────────────────────────
  const stepIndex = step === "goal_describe" ? 0 : step === "goal_confirm" ? 1 : 2;
  const steps = ["Set a goal", "Confirm", "What's next"];

  return (
    <div className="min-h-screen bg-white">

      {/* Nav */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100 max-w-5xl mx-auto">
        <img src="/logo-metrik.svg" alt="Metrik" className="h-6 w-auto" />
        <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
          Skip setup →
        </Link>
      </div>

      {/* Progress */}
      <div className="max-w-5xl mx-auto px-8 pt-10">
        <div className="flex items-center gap-2 mb-10">
          {steps.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 text-xs font-semibold transition-colors ${
                i < stepIndex ? "text-indigo-400" :
                i === stepIndex ? "text-indigo-600" :
                "text-gray-300"
              }`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] transition-colors ${
                  i < stepIndex ? "bg-indigo-100 text-indigo-500" :
                  i === stepIndex ? "bg-indigo-600 text-white" :
                  "bg-gray-100 text-gray-400"
                }`}>
                  {i < stepIndex ? <CheckCircle2 size={10} /> : i + 1}
                </div>
                {label}
              </div>
              {i < steps.length - 1 && (
                <div className={`w-8 h-px transition-colors ${i < stepIndex ? "bg-indigo-200" : "bg-gray-100"}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 pb-20">

        {/* ── STEP 1: Describe goal ─────────────────────────────────────────── */}
        {step === "goal_describe" && (
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-600 text-xs font-semibold px-3 py-1.5 rounded-full border border-indigo-100 mb-6">
              <Sparkles size={11} /> Workspace created
            </div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight mb-2">
              {firstName ? `Welcome, ${firstName}.` : "Welcome."}
            </h1>
            <p className="text-gray-500 text-base mb-8 leading-relaxed">
              Let&apos;s start with the most important thing — what is your team actually trying to achieve this quarter? Metrik will use this to make every insight and report relevant to your real priorities.
            </p>

            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-6 mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Describe your main business goal
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="e.g. We want to grow premium subscriptions by reducing the time it takes for a claim to get processed and paid out…"
                rows={4}
                className="w-full text-sm text-gray-800 bg-white border border-gray-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400 leading-relaxed"
              />

              {/* Prompt chips */}
              <div className="flex flex-wrap gap-2 mt-3">
                {PROMPT_CHIPS.map(chip => (
                  <button
                    key={chip}
                    onClick={() => setDescription(chip)}
                    className="text-[11px] text-gray-500 bg-white border border-gray-200 rounded-lg px-2.5 py-1 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              {proposeError && (
                <p className="text-xs text-red-500 mt-3">{proposeError}</p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handlePropose}
                disabled={!description.trim() || proposePending}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
              >
                {proposePending ? (
                  <><Loader2 size={14} className="animate-spin" /> Thinking…</>
                ) : (
                  <><Sparkles size={14} /> Propose with AI</>
                )}
              </button>
              <button
                onClick={() => setStep("next_steps")}
                className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Confirm goal ──────────────────────────────────────────── */}
        {step === "goal_confirm" && proposed && (
          <div className="max-w-2xl">
            <h2 className="text-2xl font-black text-gray-900 mb-1">Does this look right?</h2>
            <p className="text-gray-500 text-sm mb-7">
              AI turned your description into a structured goal. Edit any field before saving.
            </p>

            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden mb-5">
              <div className="px-6 py-5 border-b border-gray-50">
                <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Title</label>
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full text-lg font-bold text-gray-900 bg-transparent border-0 border-b border-transparent focus:border-indigo-400 focus:outline-none pb-0.5 transition-colors"
                />
              </div>
              <div className="px-6 py-5 border-b border-gray-50 grid grid-cols-2 gap-5">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Target</label>
                  <input
                    value={editTarget}
                    onChange={e => setEditTarget(e.target.value)}
                    placeholder="e.g. 98% activation rate"
                    className="w-full text-sm text-gray-700 bg-transparent border-0 border-b border-transparent focus:border-indigo-400 focus:outline-none pb-0.5 transition-colors placeholder:text-gray-300"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Timeframe</label>
                  <select
                    value={editTimeframe}
                    onChange={e => setEditTimeframe(e.target.value)}
                    className="w-full text-sm text-gray-700 bg-transparent border-0 border-b border-transparent focus:border-indigo-400 focus:outline-none pb-0.5 transition-colors"
                  >
                    {TIMEFRAMES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="px-6 py-5">
                <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Why it matters</label>
                <textarea
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  rows={2}
                  className="w-full text-sm text-gray-500 bg-transparent border-0 resize-none focus:outline-none leading-relaxed"
                />
              </div>
            </div>

            {saveError && (
              <p className="text-xs text-red-500 mb-4">{saveError}</p>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveGoal}
                disabled={!editTitle.trim() || savePending}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
              >
                {savePending ? (
                  <><Loader2 size={14} className="animate-spin" /> Saving…</>
                ) : (
                  <><CheckCircle2 size={14} /> Save goal &amp; continue</>
                )}
              </button>
              <button
                onClick={() => setStep("goal_describe")}
                className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => setStep("next_steps")}
                className="text-sm text-gray-400 hover:text-gray-600 transition-colors ml-auto"
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Next steps ────────────────────────────────────────────── */}
        {step === "next_steps" && (
          <div>
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 size={16} className="text-green-500" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-gray-900 leading-none">You&apos;re set up.</h2>
                <p className="text-gray-500 text-sm mt-0.5">Here&apos;s what to do next to get the most out of Metrik.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {[
                {
                  icon: Target,
                  iconColor: "text-indigo-500",
                  iconBg: "bg-indigo-50",
                  title: "Add product goals & KPIs",
                  body: "Break your business goal down into product goals — the specific outcomes your team owns. Then attach KPIs to measure progress.",
                  cta: "Go to Goals →",
                  href: "/goals",
                  note: "Metrik uses KPIs to score feature impact and generate reports.",
                },
                {
                  icon: Lightbulb,
                  iconColor: "text-violet-500",
                  iconBg: "bg-violet-50",
                  title: "Log what you're building",
                  body: "Describe a feature you're working on. AI will suggest metrics, KPIs, and success criteria — already structured and ready to track.",
                  cta: "Log a feature →",
                  href: "/feature-metrics",
                  note: "After launch, Metrik measures whether it moved the needle.",
                },
                {
                  icon: Zap,
                  iconColor: "text-blue-500",
                  iconBg: "bg-blue-50",
                  title: "Connect your product data",
                  body: "Connect Mixpanel or Amplitude, or upload a CSV. Without event data the tool can measure nothing — this is what powers the dashboards.",
                  cta: "Connect a source →",
                  href: "/sources",
                  note: "You can connect multiple sources. Events sync automatically.",
                },
              ].map(({ icon: Icon, iconColor, iconBg, title, body, cta, href, note }) => (
                <Link
                  key={title}
                  href={href}
                  className="group bg-white border border-gray-100 rounded-2xl p-6 flex flex-col hover:border-gray-200 hover:shadow-sm transition-all"
                >
                  <div className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center mb-4`}>
                    <Icon size={16} className={iconColor} />
                  </div>
                  <h3 className="text-sm font-bold text-gray-900 mb-2">{title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed mb-4 flex-1">{body}</p>
                  <p className="text-[11px] text-gray-400 bg-gray-50 rounded-lg px-3 py-2 mb-4">💡 {note}</p>
                  <span className="flex items-center gap-1 text-sm font-semibold text-indigo-600 group-hover:gap-2 transition-all">
                    {cta} <ChevronRight size={14} />
                  </span>
                </Link>
              ))}
            </div>

            <div className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-2xl px-6 py-4">
              <p className="text-sm text-gray-500">
                Everything can be set up later — nothing is locked or required to start.
              </p>
              <Link
                href="/dashboard"
                className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors whitespace-nowrap ml-6"
              >
                Go to dashboard <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
