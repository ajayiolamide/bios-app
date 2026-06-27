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
  "Improve user retention past week 4",
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

  const [description, setDescription] = useState("");
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [proposePending, startPropose] = useTransition();

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
  const STEPS = ["Set a goal", "Confirm", "What's next"];

  return (
    <div className="min-h-screen bg-gray-50/60">

      {/* Top bar */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <img src="/logo-metrik.svg" alt="Metrik" className="h-5 w-auto" />

          {/* Stepper */}
          <div className="flex items-center gap-1">
            {STEPS.map((label, i) => {
              const done = i < stepIndex;
              const active = i === stepIndex;
              return (
                <div key={label} className="flex items-center gap-1">
                  <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                    active ? "bg-indigo-600 text-white" :
                    done ? "text-indigo-500" :
                    "text-gray-300"
                  }`}>
                    {done
                      ? <CheckCircle2 size={11} />
                      : <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${active ? "bg-white/20" : "bg-gray-100"}`}>{i + 1}</span>
                    }
                    {label}
                  </div>
                  {i < STEPS.length - 1 && <div className="w-5 h-px bg-gray-200" />}
                </div>
              );
            })}
          </div>

          <Link href="/dashboard" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            Skip setup →
          </Link>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-14">

        {/* ── STEP 1: Describe ─────────────────────────────────────────────── */}
        {step === "goal_describe" && (
          <div className="max-w-lg mx-auto">
            <div className="mb-8">
              <h1 className="text-[28px] font-black text-gray-900 tracking-tight mb-2">
                {firstName ? `Welcome, ${firstName}.` : "Welcome to Metrik."}
              </h1>
              <p className="text-gray-500 text-[15px] leading-relaxed">
                Start with the one thing your team is actually trying to achieve this quarter. Describe it in plain English — AI will turn it into a structured business goal.
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-5">
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handlePropose(); }}
                placeholder="e.g. We want to grow premium subscriptions by reducing the time it takes for a claim to get processed and paid out…"
                rows={5}
                className="w-full px-5 pt-5 pb-3 text-[15px] text-gray-800 bg-transparent border-0 resize-none focus:outline-none placeholder:text-gray-300 leading-relaxed"
              />
              <div className="px-5 pb-4 pt-2 border-t border-gray-100">
                <p className="text-[11px] font-medium text-gray-400 mb-2.5 uppercase tracking-wider">Quick examples</p>
                <div className="flex flex-wrap gap-1.5">
                  {PROMPT_CHIPS.map(chip => (
                    <button
                      key={chip}
                      onClick={() => setDescription(chip)}
                      className="text-[12px] text-gray-500 bg-gray-50 rounded-full px-3 py-1 hover:bg-indigo-50 hover:text-indigo-600 border border-gray-200 hover:border-indigo-200 transition-colors"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {proposeError && <p className="text-xs text-red-500 mb-3">{proposeError}</p>}

            <div className="flex items-center gap-4">
              <button
                onClick={handlePropose}
                disabled={!description.trim() || proposePending}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors shadow-sm"
              >
                {proposePending
                  ? <><Loader2 size={14} className="animate-spin" /> Thinking…</>
                  : <><Sparkles size={14} /> Propose with AI</>}
              </button>
              <button onClick={() => setStep("next_steps")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Confirm ──────────────────────────────────────────────── */}
        {step === "goal_confirm" && (
          <div className="max-w-lg mx-auto">
            <div className="mb-8">
              <h2 className="text-[28px] font-black text-gray-900 tracking-tight mb-2">Does this look right?</h2>
              <p className="text-gray-500 text-[15px]">Edit any field before saving — you can always update this later.</p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-5">
              <div className="px-6 py-5 border-b border-gray-100">
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Goal title</label>
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full text-[17px] font-bold text-gray-900 bg-transparent border-0 focus:outline-none placeholder:text-gray-300"
                  placeholder="Your business goal title"
                />
              </div>
              <div className="px-6 py-5 border-b border-gray-100">
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Target</label>
                <textarea
                  value={editTarget}
                  onChange={e => setEditTarget(e.target.value)}
                  rows={2}
                  className="w-full text-sm text-gray-700 bg-transparent border-0 resize-none focus:outline-none placeholder:text-gray-300 leading-relaxed"
                  placeholder="e.g. Increase revenue by 20% through faster processing"
                />
              </div>
              <div className="px-6 py-5 border-b border-gray-100">
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Timeframe</label>
                <select
                  value={editTimeframe}
                  onChange={e => setEditTimeframe(e.target.value)}
                  className="text-sm text-gray-700 bg-transparent border-0 focus:outline-none -ml-0.5"
                >
                  {TIMEFRAMES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="px-6 py-5">
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Why it matters</label>
                <textarea
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  rows={3}
                  className="w-full text-sm text-gray-500 bg-transparent border-0 resize-none focus:outline-none leading-relaxed placeholder:text-gray-300"
                  placeholder="One sentence on why this matters to the business"
                />
              </div>
            </div>

            {saveError && <p className="text-xs text-red-500 mb-3">{saveError}</p>}

            <div className="flex items-center gap-4">
              <button
                onClick={handleSaveGoal}
                disabled={!editTitle.trim() || savePending}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors shadow-sm"
              >
                {savePending
                  ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                  : <><CheckCircle2 size={14} /> Save &amp; continue</>}
              </button>
              <button onClick={() => setStep("goal_describe")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">← Back</button>
              <button onClick={() => setStep("next_steps")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors ml-auto">Skip for now</button>
            </div>
          </div>
        )}

        {/* ── STEP 3: What's next ───────────────────────────────────────────── */}
        {step === "next_steps" && (
          <div className="max-w-3xl mx-auto">
            <div className="flex flex-col items-center text-center mb-10">
              <div className="w-14 h-14 rounded-full bg-green-50 border-2 border-green-100 flex items-center justify-center mb-5">
                <CheckCircle2 size={26} className="text-green-500" />
              </div>
              <h2 className="text-[28px] font-black text-gray-900 tracking-tight mb-2">You&apos;re set up.</h2>
              <p className="text-gray-500 text-[15px] max-w-md">Here&apos;s what to do next to get the most out of Metrik. You can do all of this from inside the app.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
              {[
                {
                  icon: Target, color: "text-indigo-500", bg: "bg-indigo-50",
                  num: "01",
                  title: "Add KPIs to your goal",
                  body: "Break your business goal into product goals and attach KPIs. These power your reports and feature impact scoring.",
                  cta: "Go to Goals", href: "/goals",
                },
                {
                  icon: Lightbulb, color: "text-violet-500", bg: "bg-violet-50",
                  num: "02",
                  title: "Log what you're building",
                  body: "Describe a feature — AI suggests metrics, KPIs, and guardrails. After launch, Metrik measures whether it moved the needle.",
                  cta: "Log a feature", href: "/feature-metrics",
                },
                {
                  icon: Zap, color: "text-blue-500", bg: "bg-blue-50",
                  num: "03",
                  title: "Connect your data",
                  body: "Connect Mixpanel or Amplitude, or upload a CSV. Event data is what powers every dashboard, KPI, and AI insight.",
                  cta: "Connect a source", href: "/sources",
                },
              ].map(({ icon: Icon, color, bg, num, title, body, cta, href }) => (
                <Link
                  key={title}
                  href={href}
                  className="group bg-white border border-gray-200 rounded-2xl p-6 flex flex-col hover:border-indigo-200 hover:shadow-md transition-all"
                >
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center`}>
                      <Icon size={16} className={color} />
                    </div>
                    <span className="text-[11px] font-bold text-gray-300 tracking-widest">{num}</span>
                  </div>
                  <h3 className="text-sm font-bold text-gray-900 mb-2">{title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed flex-1 mb-4">{body}</p>
                  <span className="flex items-center gap-1 text-xs font-semibold text-indigo-600 group-hover:gap-2 transition-all">
                    {cta} <ArrowRight size={11} />
                  </span>
                </Link>
              ))}
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl px-6 py-4 flex items-center justify-between">
              <p className="text-xs text-gray-400">All of this can be set up any time — nothing is locked or required to start.</p>
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
