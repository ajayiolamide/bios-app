"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  Sparkles, ArrowRight, Loader2, CheckCircle2,
  Zap, Target, Lightbulb,
} from "lucide-react";
import {
  proposeObjectiveFromDescription,
  createCompanyObjective,
} from "@/app/actions/company-objectives";

const PROMPT_CHIPS = [
  "Grow revenue by reducing checkout friction",
  "Improve retention past week 4",
  "Cut claims processing time by 30%",
  "Increase feature adoption for new users",
  "Reduce churn in the first 30 days",
];

const TIMEFRAMES = [
  "Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026",
  "H1 2026", "H2 2026", "Annual 2026",
  "Q1 2027", "Annual 2027",
];

type ProposedGoal = { title: string; target: string; timeframe: string; description: string };
type WizardStep = "goal_describe" | "goal_confirm" | "next_steps";

export default function OnboardingPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStep>("goal_describe");

  // Step 1
  const [description, setDescription] = useState("");
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [proposePending, startPropose] = useTransition();

  // Step 2
  const [editTitle, setEditTitle] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [editTimeframe, setEditTimeframe] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savePending, startSave] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push("/login"); return; }
      const name = user.user_metadata?.full_name?.split(" ")[0] ?? user.email?.split("@")[0] ?? "";
      setFirstName(name);
      const { data: org } = await supabase
        .from("organizations").select("id").eq("owner_id", user.id)
        .order("created_at", { ascending: false }).limit(1).single();
      if (org) setOrgId(org.id);
    });
  }, [router]);

  function handlePropose() {
    if (!description.trim()) return;
    setProposeError(null);
    startPropose(async () => {
      const result = await proposeObjectiveFromDescription(description);
      if (result.error) { setProposeError(result.error); return; }
      setEditTitle(result.title ?? "");
      setEditTarget(result.target ?? "");
      setEditTimeframe(result.timeframe ?? TIMEFRAMES[1]);
      setEditDesc(result.description ?? "");
      setStep("goal_confirm");
    });
  }

  function handleSaveGoal() {
    if (!orgId) { setSaveError("Couldn't find your workspace. Try refreshing."); return; }
    setSaveError(null);
    startSave(async () => {
      const result = await createCompanyObjective(orgId, {
        title: editTitle, target: editTarget,
        timeframe: editTimeframe, description: editDesc,
      });
      if (result.error) { setSaveError(result.error); return; }
      setStep("next_steps");
    });
  }

  const stepIndex = step === "goal_describe" ? 0 : step === "goal_confirm" ? 1 : 2;

  return (
    <div className="min-h-screen bg-[#FAFAFA]">

      {/* Top nav */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-8 h-14 flex items-center justify-between">
          <img src="/logo-metrik.svg" alt="Metrik" className="h-5 w-auto" />
          <Link href="/dashboard" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            Skip setup →
          </Link>
        </div>
      </div>

      {/* Progress stepper */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-8 h-12 flex items-center gap-0">
          {(["Set a goal", "Confirm", "What's next"] as const).map((label, i) => {
            const done = i < stepIndex;
            const active = i === stepIndex;
            return (
              <div key={label} className="flex items-center">
                <div className={`flex items-center gap-2 px-4 h-12 text-xs font-semibold border-b-2 transition-all ${
                  active ? "border-indigo-600 text-indigo-600" :
                  done ? "border-transparent text-gray-400" :
                  "border-transparent text-gray-300"
                }`}>
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] transition-all ${
                    done ? "bg-indigo-100 text-indigo-500" :
                    active ? "bg-indigo-600 text-white" :
                    "bg-gray-100 text-gray-400"
                  }`}>
                    {done ? <CheckCircle2 size={9} /> : i + 1}
                  </div>
                  {label}
                </div>
                {i < 2 && <div className="w-4 h-px bg-gray-100 flex-shrink-0" />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-12">

        {/* ── STEP 1: Describe ─────────────────────────────────────────────── */}
        {step === "goal_describe" && (
          <div className="max-w-xl mx-auto">
            <div className="mb-8 text-center">
              <div className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-600 text-xs font-semibold px-3 py-1.5 rounded-full border border-indigo-100 mb-4">
                <Sparkles size={11} /> Step 1 of 2
              </div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight mb-2">
                {firstName ? `Welcome, ${firstName}.` : "Welcome to Metrik."}
              </h1>
              <p className="text-gray-500 text-sm leading-relaxed">
                What is your team trying to achieve this quarter? Describe it in plain English — AI will structure it into a business goal.
              </p>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm mb-4">
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handlePropose(); }}
                placeholder="e.g. We want to grow premium subscriptions by reducing the time it takes for a claim to get processed and paid out…"
                rows={5}
                className="w-full text-sm text-gray-800 bg-transparent border-0 resize-none focus:outline-none placeholder:text-gray-300 leading-relaxed"
              />
              <div className="border-t border-gray-100 pt-3 mt-1">
                <p className="text-[11px] text-gray-400 mb-2">Try a quick example:</p>
                <div className="flex flex-wrap gap-1.5">
                  {PROMPT_CHIPS.map(chip => (
                    <button
                      key={chip}
                      onClick={() => setDescription(chip)}
                      className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-colors"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {proposeError && (
              <p className="text-xs text-red-500 mb-3">{proposeError}</p>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handlePropose}
                disabled={!description.trim() || proposePending}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
              >
                {proposePending
                  ? <><Loader2 size={13} className="animate-spin" /> Thinking…</>
                  : <><Sparkles size={13} /> Propose with AI</>}
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

        {/* ── STEP 2: Confirm ──────────────────────────────────────────────── */}
        {step === "goal_confirm" && (
          <div className="max-w-xl mx-auto">
            <div className="mb-8 text-center">
              <h2 className="text-2xl font-black text-gray-900 tracking-tight mb-2">
                Does this look right?
              </h2>
              <p className="text-gray-500 text-sm">
                Edit any field before saving — you can always change this later.
              </p>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden mb-4">
              {/* Title */}
              <div className="px-6 pt-5 pb-4 border-b border-gray-100">
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Goal title</label>
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full text-base font-bold text-gray-900 bg-transparent border-0 focus:outline-none focus:ring-0 placeholder:text-gray-300"
                  placeholder="Your business goal title"
                />
              </div>

              {/* Target */}
              <div className="px-6 pt-4 pb-4 border-b border-gray-100">
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Target</label>
                <textarea
                  value={editTarget}
                  onChange={e => setEditTarget(e.target.value)}
                  rows={2}
                  className="w-full text-sm text-gray-700 bg-transparent border-0 resize-none focus:outline-none placeholder:text-gray-300 leading-relaxed"
                  placeholder="e.g. Increase revenue by 20% through faster processing"
                />
              </div>

              {/* Timeframe */}
              <div className="px-6 pt-4 pb-4 border-b border-gray-100">
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Timeframe</label>
                <select
                  value={editTimeframe}
                  onChange={e => setEditTimeframe(e.target.value)}
                  className="text-sm text-gray-700 bg-transparent border-0 focus:outline-none focus:ring-0 -ml-0.5"
                >
                  {TIMEFRAMES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* Why it matters */}
              <div className="px-6 pt-4 pb-5">
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Why it matters</label>
                <textarea
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  rows={3}
                  className="w-full text-sm text-gray-500 bg-transparent border-0 resize-none focus:outline-none leading-relaxed placeholder:text-gray-300"
                  placeholder="One sentence on why this goal matters to the business"
                />
              </div>
            </div>

            {saveError && <p className="text-xs text-red-500 mb-3">{saveError}</p>}

            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveGoal}
                disabled={!editTitle.trim() || savePending}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
              >
                {savePending
                  ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
                  : <><CheckCircle2 size={13} /> Save &amp; continue</>}
              </button>
              <button onClick={() => setStep("goal_describe")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
                ← Back
              </button>
              <button onClick={() => setStep("next_steps")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors ml-auto">
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: What's next ───────────────────────────────────────────── */}
        {step === "next_steps" && (
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-10">
              <div className="w-12 h-12 rounded-full bg-green-50 border border-green-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={22} className="text-green-500" />
              </div>
              <h2 className="text-2xl font-black text-gray-900 tracking-tight mb-2">You&apos;re set up.</h2>
              <p className="text-gray-500 text-sm">Here&apos;s what to do next to get the most out of Metrik.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {[
                {
                  icon: Target,
                  color: "text-indigo-500",
                  bg: "bg-indigo-50",
                  title: "Add KPIs to your goal",
                  body: "Break your business goal into product goals and attach KPIs. Metrik uses these to score feature impact and power your reports.",
                  cta: "Go to Goals",
                  href: "/goals",
                },
                {
                  icon: Lightbulb,
                  color: "text-violet-500",
                  bg: "bg-violet-50",
                  title: "Log what you're building",
                  body: "Describe a feature — AI suggests the right metrics, KPIs, and guardrails. After launch, Metrik measures whether it moved the needle.",
                  cta: "Log a feature",
                  href: "/feature-metrics",
                },
                {
                  icon: Zap,
                  color: "text-blue-500",
                  bg: "bg-blue-50",
                  title: "Connect your data",
                  body: "Connect Mixpanel or Amplitude, or upload a CSV. Event data is what powers every dashboard, KPI, and AI insight in the tool.",
                  cta: "Connect a source",
                  href: "/sources",
                },
              ].map(({ icon: Icon, color, bg, title, body, cta, href }) => (
                <Link
                  key={title}
                  href={href}
                  className="group bg-white border border-gray-200 rounded-2xl p-6 flex flex-col hover:border-indigo-200 hover:shadow-sm transition-all"
                >
                  <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-5`}>
                    <Icon size={18} className={color} />
                  </div>
                  <h3 className="text-sm font-bold text-gray-900 mb-2 leading-snug">{title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed flex-1 mb-5">{body}</p>
                  <span className="flex items-center gap-1 text-xs font-semibold text-indigo-600 group-hover:gap-2 transition-all">
                    {cta} <ArrowRight size={12} />
                  </span>
                </Link>
              ))}
            </div>

            <div className="flex items-center justify-between bg-white border border-gray-200 rounded-2xl px-6 py-4">
              <p className="text-xs text-gray-400">Everything can be set up later from inside the app.</p>
              <Link
                href="/dashboard"
                className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors whitespace-nowrap ml-6"
              >
                Go to dashboard <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
