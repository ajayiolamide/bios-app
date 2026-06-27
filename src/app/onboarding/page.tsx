"use client";

import { useEffect, useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowRight, Loader2, CheckCircle2, Zap, Target, Lightbulb, Send } from "lucide-react";
import { proposeObjectiveFromDescription, createCompanyObjective } from "@/app/actions/company-objectives";
import { getWaitlistGoalDescription } from "@/app/actions/waitlist";

const PROMPT_CHIPS = [
  "Grow revenue by reducing checkout friction",
  "Improve user retention past week 4",
  "Cut claims processing time by 30%",
  "Increase feature adoption for new users",
  "Reduce churn in the first 30 days",
];

const TIMEFRAMES = [
  "Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026",
  "H1 2026", "H2 2026", "Annual 2026", "Q1 2027", "Annual 2027",
];

type WizardStep = "goal_describe" | "goal_confirm" | "next_steps";

export default function OnboardingPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStep>("goal_describe");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [description, setDescription] = useState("");
  const [focused, setFocused] = useState(false);
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
      // Pre-fill goal from what they typed on the landing page waitlist form
      if (user.email) {
        const saved = await getWaitlistGoalDescription(user.email);
        if (saved) setDescription(saved);
      }
    });
    setTimeout(() => textareaRef.current?.focus(), 150);
  }, [router]);

  function handlePropose() {
    if (!description.trim() || proposePending) return;
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
      const result = await createCompanyObjective(orgId, { title: editTitle, target: editTarget, timeframe: editTimeframe, description: editDesc });
      if (result.error) { setSaveError(result.error); return; }
      setStep("next_steps");
    });
  }

  const stepIndex = step === "goal_describe" ? 0 : step === "goal_confirm" ? 1 : 2;
  const STEPS = ["Set a goal", "Confirm", "What's next"];

  return (
    <div className="min-h-screen bg-[#F7F7F9]">

      {/* Nav */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-8 h-16 flex items-center justify-between">
          {/* Bigger logo */}
          <img src="/logo-metrik.svg" alt="Metrik" className="h-8 w-auto" />

          {/* Softer stepper — dots + labels only */}
          <div className="flex items-center gap-2">
            {STEPS.map((label, i) => {
              const done = i < stepIndex;
              const active = i === stepIndex;
              return (
                <div key={label} className="flex items-center gap-2">
                  <div className={`flex items-center gap-1.5 text-xs transition-all ${
                    active ? "text-indigo-600 font-semibold" :
                    done ? "text-gray-400" : "text-gray-300"
                  }`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                      done ? "bg-indigo-100" :
                      active ? "bg-indigo-600 text-white" :
                      "bg-gray-100"
                    }`}>
                      {done ? <CheckCircle2 size={10} className="text-indigo-500" /> : <span className="text-[10px]">{i + 1}</span>}
                    </div>
                    {label}
                  </div>
                  {i < STEPS.length - 1 && <div className="w-6 h-px bg-gray-200" />}
                </div>
              );
            })}
          </div>

          <Link href="/dashboard" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            Skip →
          </Link>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-16">

        {/* ── STEP 1 ─────────────────────────────────────────────────────── */}
        {step === "goal_describe" && (
          <div className="max-w-xl mx-auto">

            <div className="mb-10">
              <h1 className="text-[26px] font-semibold text-gray-900 mb-3 tracking-tight">
                {firstName ? `Welcome, ${firstName}.` : "Welcome to Metrik."}
              </h1>
              <p className="text-gray-500 text-[15px] leading-[1.7]">
                Start by describing what your company is trying to achieve — in plain English, like you'd explain it to a colleague. Metrik&apos;s AI will turn this into a structured business goal: a title, a measurable target, and a timeframe. You&apos;ll review and edit it before anything is saved.
              </p>
            </div>

            {/* Input card */}
            <div className={`bg-white rounded-2xl transition-all duration-200 ${
              focused
                ? "shadow-md ring-1 ring-indigo-400/40 border border-indigo-200"
                : "shadow-sm border border-gray-200"
            }`}>
              <textarea
                ref={textareaRef}
                value={description}
                onChange={e => setDescription(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handlePropose(); }}
                placeholder="e.g. We want to grow premium subscriptions by reducing the time it takes for a claim to get processed and paid out. Right now it takes 8–10 days and we want to get it under 3."
                rows={6}
                className="w-full px-5 pt-5 pb-3 text-[14px] text-gray-800 bg-transparent border-0 resize-none focus:outline-none placeholder:text-gray-300 leading-relaxed rounded-2xl"
              />
              <div className="px-5 pb-4 flex items-center justify-between border-t border-gray-100 mt-1">
                <p className="text-[11px] text-gray-400">
                  {description.trim() ? "⌘ Enter to generate" : "Be as detailed as you like — the more context, the better the goal"}
                </p>
                <button
                  onClick={handlePropose}
                  disabled={!description.trim() || proposePending}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed text-white text-[13px] font-medium px-4 py-1.5 rounded-lg transition-all"
                >
                  {proposePending
                    ? <><Loader2 size={12} className="animate-spin" /> Thinking…</>
                    : <><Send size={12} /> Generate</>}
                </button>
              </div>
            </div>

            {proposeError && <p className="text-xs text-red-400 mt-3">{proposeError}</p>}

            {/* Chips */}
            <div className="mt-6">
              <p className="text-[11px] text-gray-400 mb-3 text-center">Or pick a quick example to get started</p>
              <div className="flex flex-wrap justify-center gap-2">
                {PROMPT_CHIPS.map(chip => (
                  <button
                    key={chip}
                    onClick={() => { setDescription(chip); setTimeout(() => textareaRef.current?.focus(), 50); }}
                    className="text-[12px] text-gray-500 bg-white border border-gray-200 rounded-full px-3.5 py-1.5 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-all"
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <div className="text-center mt-4">
                <button onClick={() => setStep("next_steps")} className="text-xs text-gray-400 hover:text-gray-500 transition-colors">
                  Skip this step
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2 ─────────────────────────────────────────────────────── */}
        {step === "goal_confirm" && (
          <div className="max-w-xl mx-auto">
            <div className="mb-8">
              <p className="text-[11px] font-medium text-indigo-500 uppercase tracking-widest mb-2">AI structured your input</p>
              <h2 className="text-[26px] font-semibold text-gray-900 tracking-tight mb-2">Does this look right?</h2>
              <p className="text-gray-500 text-[14px] leading-relaxed">
                Edit any field below. This becomes your top-level business goal — everything in Metrik will ladder up to it.
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-100 overflow-hidden mb-5">
              <div className="px-6 py-5">
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Goal title</label>
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full text-[17px] font-semibold text-gray-900 bg-transparent border-0 focus:outline-none placeholder:text-gray-300"
                  placeholder="Your business goal title"
                />
              </div>
              <div className="px-6 py-5">
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Target</label>
                <textarea
                  value={editTarget}
                  onChange={e => setEditTarget(e.target.value)}
                  rows={2}
                  className="w-full text-[14px] text-gray-700 bg-transparent border-0 resize-none focus:outline-none placeholder:text-gray-300 leading-relaxed"
                  placeholder="e.g. Increase revenue by 20% and cut processing time to under 3 days"
                />
              </div>
              <div className="px-6 py-5 flex items-center gap-6">
                <div className="flex-1">
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Timeframe</label>
                  <select
                    value={editTimeframe}
                    onChange={e => setEditTimeframe(e.target.value)}
                    className="text-[14px] text-gray-700 bg-transparent border-0 focus:outline-none"
                  >
                    {TIMEFRAMES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="px-6 py-5">
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Why it matters</label>
                <textarea
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  rows={2}
                  className="w-full text-[14px] text-gray-500 bg-transparent border-0 resize-none focus:outline-none leading-relaxed placeholder:text-gray-300"
                  placeholder="One sentence on why this goal matters to the business"
                />
              </div>
            </div>

            {saveError && <p className="text-xs text-red-400 mb-3">{saveError}</p>}

            <div className="flex items-center gap-4">
              <button
                onClick={handleSaveGoal}
                disabled={!editTitle.trim() || savePending}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-[13px] font-medium px-5 py-2.5 rounded-xl transition-colors"
              >
                {savePending ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : <><CheckCircle2 size={13} /> Save &amp; continue</>}
              </button>
              <button onClick={() => setStep("goal_describe")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">← Back</button>
              <button onClick={() => setStep("next_steps")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors ml-auto">Skip</button>
            </div>
          </div>
        )}

        {/* ── STEP 3 ─────────────────────────────────────────────────────── */}
        {step === "next_steps" && (
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-12">
              <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-5">
                <CheckCircle2 size={24} className="text-green-500" />
              </div>
              <h2 className="text-[26px] font-semibold text-gray-900 tracking-tight mb-2">You&apos;re all set.</h2>
              <p className="text-gray-400 text-[15px] max-w-sm mx-auto leading-relaxed">
                Three things to do next. Each one unlocks more of Metrik.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {[
                {
                  icon: Target, color: "text-indigo-500", bg: "bg-indigo-50",
                  num: "01", title: "Add KPIs to your goal",
                  body: "Break your goal into product goals with measurable KPIs. Metrik uses these to score feature impact and generate accurate reports.",
                  cta: "Go to Goals", href: "/goals",
                },
                {
                  icon: Lightbulb, color: "text-violet-500", bg: "bg-violet-50",
                  num: "02", title: "Log what you're building",
                  body: "Describe a feature you're working on. AI will suggest metrics, KPIs, and guardrails — and after launch, score whether it moved the needle.",
                  cta: "Log a feature", href: "/feature-metrics",
                },
                {
                  icon: Zap, color: "text-blue-500", bg: "bg-blue-50",
                  num: "03", title: "Connect your product data",
                  body: "Connect Mixpanel or Amplitude, or upload a CSV. Without event data Metrik can't measure anything — this is what powers the KPIs.",
                  cta: "Connect a source", href: "/sources",
                },
              ].map(({ icon: Icon, color, bg, num, title, body, cta, href }) => (
                <Link
                  key={title}
                  href={href}
                  className="group bg-white rounded-2xl border border-gray-200 p-6 flex flex-col hover:shadow-md hover:border-gray-300 transition-all"
                >
                  <div className="flex items-center gap-2.5 mb-5">
                    <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center`}>
                      <Icon size={16} className={color} />
                    </div>
                    <span className="text-[11px] font-semibold text-gray-300 tracking-widest">{num}</span>
                  </div>
                  <h3 className="text-[14px] font-semibold text-gray-800 mb-2">{title}</h3>
                  <p className="text-[13px] text-gray-400 leading-relaxed flex-1 mb-5">{body}</p>
                  <span className="flex items-center gap-1 text-[13px] font-medium text-indigo-500 group-hover:gap-2 transition-all">
                    {cta} <ArrowRight size={12} />
                  </span>
                </Link>
              ))}
            </div>

            <div className="flex items-center justify-between bg-white rounded-2xl border border-gray-200 px-6 py-4">
              <p className="text-[13px] text-gray-400">Everything above can be done any time from inside the app.</p>
              <Link
                href="/dashboard"
                className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-[13px] font-medium px-5 py-2.5 rounded-xl transition-colors whitespace-nowrap ml-8"
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
