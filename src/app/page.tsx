"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight, BarChart3, Zap, FileText, Target, TrendingUp,
  Sparkles, CheckCircle2, Send, Loader2,
} from "lucide-react";
import { joinWaitlist } from "@/app/actions/waitlist";

// ── Keyword-based goal preview ───────────────────────────────────────────────

interface GoalPreview {
  title: string;
  target: string;
  timeframe: string;
  kpis: string[];
}

function generatePreview(description: string): GoalPreview {
  const t = description.toLowerCase();
  if (/churn|retain|cancel|los(e|ing)|keep/.test(t))
    return {
      title: "Reduce Customer Churn",
      target: "< 3% monthly churn rate",
      timeframe: "Q3 2026",
      kpis: ["Monthly churn rate", "30-day retention by cohort", "Feature adoption depth"],
    };
  if (/activat|onboard|first.value|time.to.value|sign.?up|get started/.test(t))
    return {
      title: "Improve User Activation",
      target: "60% activation within 7 days",
      timeframe: "Q3 2026",
      kpis: ["7-day activation rate", "Time to first key action", "Onboarding completion rate"],
    };
  if (/engag|dau|mau|daily|weekly|active.user|session|stickin/.test(t))
    return {
      title: "Increase Product Engagement",
      target: "40% DAU / MAU ratio",
      timeframe: "Q3 2026",
      kpis: ["Daily active users", "Feature depth score", "Session frequency per user"],
    };
  if (/convert|trial|paid|upgrade|subscri/.test(t))
    return {
      title: "Grow Trial-to-Paid Conversion",
      target: "25% trial conversion rate",
      timeframe: "Q3 2026",
      kpis: ["Trial-to-paid rate", "Time to upgrade", "Feature engagement pre-conversion"],
    };
  if (/revenue|arr|mrr|sales|grow|scale/.test(t))
    return {
      title: "Accelerate Revenue Growth",
      target: "+40% MRR this quarter",
      timeframe: "Q3 2026",
      kpis: ["New MRR from feature adoption", "Expansion revenue", "Revenue per feature released"],
    };
  return {
    title: "Improve Core Product Outcomes",
    target: "Primary KPI +30%",
    timeframe: "Q3 2026",
    kpis: ["Primary success metric", "Feature impact score", "User satisfaction trend"],
  };
}

// ── Chat widget ──────────────────────────────────────────────────────────────

type ChatStep = "prompt" | "thinking" | "preview" | "email" | "done";

const CHIPS = ["Reduce churn", "Grow MRR", "Improve activation", "Increase engagement"];

function WaitlistChat() {
  const [step, setStep] = useState<ChatStep>("prompt");
  const [description, setDescription] = useState("");
  const [preview, setPreview] = useState<GoalPreview | null>(null);
  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "loading" | "error">("idle");
  const [emailError, setEmailError] = useState("");

  function submitDescription() {
    if (!description.trim()) return;
    setStep("thinking");
    setTimeout(() => {
      setPreview(generatePreview(description));
      setStep("preview");
    }, 1600);
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailStatus("loading");
    const result = await joinWaitlist(email);
    if (result.success) {
      setStep("done");
    } else {
      setEmailStatus("error");
      setEmailError(result.message);
    }
  }

  return (
    <div className="w-full max-w-[480px] mx-auto">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">

        {/* ── Card header ────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100">
          <div className="w-5 h-5 rounded-md bg-indigo-600 flex items-center justify-center shrink-0">
            <Sparkles size={10} className="text-white" />
          </div>
          <span className="text-xs font-semibold text-gray-700">Metrik AI</span>
          <span className="ml-auto text-[10px] text-gray-400 tabular-nums">Early access</span>
        </div>

        {/* ── Step: prompt ───────────────────────────────────── */}
        {step === "prompt" && (
          <div className="px-5 py-5">
            <p className="text-sm text-gray-600 mb-3 leading-relaxed">
              What is your team working toward this quarter?
            </p>
            <textarea
              autoFocus
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitDescription();
                }
              }}
              placeholder="e.g. We want to reduce churn by improving the onboarding experience for new users…"
              className="w-full text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none leading-relaxed"
            />
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
              <div className="flex gap-1.5 flex-wrap">
                {CHIPS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setDescription(c)}
                    className="text-[11px] text-indigo-500 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-full transition-colors"
                  >
                    {c}
                  </button>
                ))}
              </div>
              <button
                onClick={submitDescription}
                disabled={!description.trim()}
                className="flex items-center gap-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors shrink-0 ml-3"
              >
                <Send size={11} /> Send
              </button>
            </div>
          </div>
        )}

        {/* ── Step: thinking ─────────────────────────────────── */}
        {step === "thinking" && (
          <div className="px-5 py-5 flex flex-col gap-3">
            {/* user bubble */}
            <div className="flex justify-end">
              <div className="max-w-[78%] bg-indigo-50 rounded-2xl rounded-tr-sm px-3.5 py-2.5">
                <p className="text-xs text-indigo-800 leading-relaxed">{description}</p>
              </div>
            </div>
            {/* typing dots */}
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-indigo-600 flex items-center justify-center shrink-0">
                <Sparkles size={10} className="text-white" />
              </div>
              <div className="flex gap-1 items-center">
                {[0, 150, 300].map((d) => (
                  <span
                    key={d}
                    className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce"
                    style={{ animationDelay: `${d}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Step: preview ──────────────────────────────────── */}
        {step === "preview" && preview && (
          <div className="px-5 py-5 flex flex-col gap-3">
            {/* user bubble */}
            <div className="flex justify-end">
              <div className="max-w-[78%] bg-indigo-50 rounded-2xl rounded-tr-sm px-3.5 py-2.5">
                <p className="text-xs text-indigo-800 leading-relaxed">{description}</p>
              </div>
            </div>
            {/* AI response */}
            <div className="flex gap-2.5">
              <div className="w-5 h-5 rounded-md bg-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles size={10} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 mb-2.5">Here&apos;s how Metrik would structure this:</p>
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-3">
                  <div>
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Business Goal</span>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">{preview.title}</p>
                  </div>
                  <div className="flex gap-6">
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Target</span>
                      <p className="text-xs text-gray-700 mt-0.5">{preview.target}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Timeframe</span>
                      <p className="text-xs text-gray-700 mt-0.5">{preview.timeframe}</p>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">KPIs to Track</span>
                    <ul className="mt-1.5 space-y-1.5">
                      {preview.kpis.map((k) => (
                        <li key={k} className="flex items-center gap-1.5 text-xs text-gray-600">
                          <CheckCircle2 size={11} className="text-indigo-400 shrink-0" />
                          {k}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <button
                  onClick={() => setStep("email")}
                  className="mt-3 flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                  Get early access to track this <ArrowRight size={11} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step: email ────────────────────────────────────── */}
        {step === "email" && preview && (
          <div className="px-5 py-5 flex flex-col gap-3">
            {/* condensed thread */}
            <div className="flex justify-end">
              <div className="max-w-[78%] bg-indigo-50 rounded-2xl rounded-tr-sm px-3.5 py-2.5">
                <p className="text-xs text-indigo-800 leading-relaxed">{description}</p>
              </div>
            </div>
            <div className="flex gap-2.5">
              <div className="w-5 h-5 rounded-md bg-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles size={10} className="text-white" />
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                <span className="font-medium text-gray-700">{preview.title}</span> is ready.{" "}
                Enter your email and we&apos;ll set this up when your spot opens.
              </p>
            </div>
            <form onSubmit={submitEmail} className="flex gap-2 mt-0.5">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-0"
              />
              <button
                type="submit"
                disabled={emailStatus === "loading"}
                className="flex items-center gap-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-3.5 py-2 rounded-lg transition-colors shrink-0"
              >
                {emailStatus === "loading"
                  ? <Loader2 size={12} className="animate-spin" />
                  : <>Join <ArrowRight size={11} /></>}
              </button>
            </form>
            {emailStatus === "error" && (
              <p className="text-xs text-red-500 -mt-1">{emailError}</p>
            )}
          </div>
        )}

        {/* ── Step: done ─────────────────────────────────────── */}
        {step === "done" && (
          <div className="px-5 py-8 flex flex-col items-center gap-3 text-center">
            <div className="w-10 h-10 rounded-full bg-green-50 border border-green-100 flex items-center justify-center">
              <CheckCircle2 size={20} className="text-green-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">You&apos;re on the list.</p>
              <p className="text-xs text-gray-400 mt-1 max-w-[260px] mx-auto leading-relaxed">
                We&apos;ll reach out when your spot is ready so you can start tracking your goal.
              </p>
            </div>
            <Link
              href="/login"
              className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors mt-1"
            >
              Already have access? Sign in →
            </Link>
          </div>
        )}
      </div>

      {step === "prompt" && (
        <p className="text-xs text-gray-400 mt-3 text-center">
          Already have an account?{" "}
          <Link href="/login" className="text-indigo-500 hover:text-indigo-600">
            Sign in →
          </Link>
        </p>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans antialiased">

      {/* ── Background ───────────────────────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_55%_at_50%_-5%,rgba(99,102,241,0.11),transparent)]" />
        <div className="absolute top-[30%] -left-[10%] w-[500px] h-[400px] bg-[radial-gradient(ellipse,rgba(99,102,241,0.05),transparent_70%)]" />
        <div className="absolute top-[20%] -right-[10%] w-[400px] h-[350px] bg-[radial-gradient(ellipse,rgba(139,92,246,0.04),transparent_70%)]" />
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-5 max-w-6xl mx-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-metrik.svg" alt="Metrik" className="h-6 w-auto" />
        <div className="flex items-center gap-5">
          <Link href="/login" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
            Sign in
          </Link>
          <Link
            href="/login"
            className="flex items-center gap-1.5 text-sm font-semibold bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            Sign in <ArrowRight size={13} />
          </Link>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-4xl mx-auto px-8 pt-16 pb-20 text-center">

        <div className="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-100 text-indigo-600 text-xs font-medium px-3.5 py-1.5 rounded-full mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
          Early access · Limited spots available
        </div>

        <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-[1.1] tracking-tight mb-5">
          Turn feature releases into<br />business outcomes, with AI.
        </h1>

        <p className="text-lg text-gray-500 max-w-xl mx-auto mb-10 leading-relaxed">
          Set a goal. Log a feature. Metrik&apos;s AI suggests the right metrics,
          tracks impact after launch, and tells you exactly what moved the needle.
        </p>

        {/* ── AI chat card ───────────────────────────────────────────────────── */}
        <WaitlistChat />

      </section>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-8 pb-20">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] text-center mb-10">
          How it works
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: Target,
              step: "01",
              title: "Set a business goal",
              desc: "Define what your company is trying to achieve. Every feature your team ships stays tied to that goal.",
            },
            {
              icon: Sparkles,
              step: "02",
              title: "Log a feature",
              desc: "Answer 8 questions. Metrik suggests the right metrics, KPIs, and guardrails — already named and event-wired.",
            },
            {
              icon: TrendingUp,
              step: "03",
              title: "See the real impact",
              desc: "After launch, Metrik computes whether the feature moved your KPI and generates a shareable stakeholder deck.",
            },
          ].map(({ icon: Icon, step, title, desc }) => (
            <div key={step} className="bg-gray-50 border border-gray-100 rounded-2xl p-6 hover:border-gray-200 transition-colors">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                  <Icon size={14} className="text-indigo-500" />
                </div>
                <span className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">{step}</span>
              </div>
              <h3 className="font-semibold text-gray-900 mb-2 text-sm">{title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-8 pb-20">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] text-center mb-10">
          What&apos;s included
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { icon: Sparkles,   label: "AI metric suggestions per feature" },
            { icon: Target,     label: "Business goal → KPI hierarchy" },
            { icon: TrendingUp, label: "Post-launch KPI impact scoring" },
            { icon: FileText,   label: "One-click stakeholder deck" },
            { icon: Zap,        label: "Mixpanel & Amplitude connector" },
            { icon: BarChart3,  label: "Cohort analysis & funnels" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3.5 hover:border-gray-200 transition-colors">
              <Icon size={14} className="text-indigo-400 shrink-0" />
              <span className="text-sm text-gray-600">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-8 pb-24">
        <div className="bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.06),transparent_70%)] border border-gray-100 rounded-2xl px-8 py-16 text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-3 tracking-tight">
            Built for teams that care about outcomes.
          </h2>
          <p className="text-gray-400 text-sm mb-8 max-w-md mx-auto">
            Early access is limited. Takes 2 minutes to set up. No credit card required.
          </p>
          <Link
            href="#"
            onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            className="inline-flex items-center gap-2 bg-gray-900 text-white font-semibold px-7 py-3.5 rounded-lg hover:bg-gray-700 transition-colors text-sm"
          >
            Join the waitlist <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-gray-100 py-6 px-8 flex items-center justify-between max-w-6xl mx-auto">
        <span className="text-xs text-gray-400 font-semibold">Metrik</span>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Sign in</Link>
          <Link href="/login" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors">Sign in →</Link>
        </div>
      </footer>

    </div>
  );
}
