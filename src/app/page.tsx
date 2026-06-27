"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  ArrowRight, BarChart3, Zap, FileText, Target, TrendingUp,
  Sparkles, CheckCircle2, Loader2, ArrowUp,
} from "lucide-react";
import { joinWaitlist } from "@/app/actions/waitlist";

// ── Goal preview ──────────────────────────────────────────────────────────────

interface GoalPreview { title: string; target: string; timeframe: string; kpis: string[] }

function generatePreview(d: string): GoalPreview {
  const t = d.toLowerCase();
  if (/churn|retain|cancel|los(e|ing)|keep/.test(t))
    return { title: "Reduce Customer Churn", target: "< 3% monthly churn rate", timeframe: "Q3 2026", kpis: ["Monthly churn rate", "30-day retention by cohort", "Feature adoption depth"] };
  if (/activat|onboard|first.value|sign.?up|get started/.test(t))
    return { title: "Improve User Activation", target: "60% activation within 7 days", timeframe: "Q3 2026", kpis: ["7-day activation rate", "Time to first key action", "Onboarding completion rate"] };
  if (/engag|dau|mau|daily|weekly|active.user|session/.test(t))
    return { title: "Increase Product Engagement", target: "40% DAU / MAU ratio", timeframe: "Q3 2026", kpis: ["Daily active users", "Feature depth score", "Sessions per user per week"] };
  if (/convert|trial|paid|upgrade|subscri/.test(t))
    return { title: "Grow Trial-to-Paid Conversion", target: "25% trial conversion rate", timeframe: "Q3 2026", kpis: ["Trial-to-paid rate", "Time to upgrade", "Feature engagement before conversion"] };
  if (/revenue|arr|mrr|sales|grow|scale/.test(t))
    return { title: "Accelerate Revenue Growth", target: "+40% MRR this quarter", timeframe: "Q3 2026", kpis: ["New MRR from features", "Expansion revenue", "Revenue per feature released"] };
  return { title: "Improve Core Product Outcomes", target: "Primary KPI +30%", timeframe: "Q3 2026", kpis: ["Primary success metric", "Feature impact score", "User satisfaction trend"] };
}

// ── Chat types ────────────────────────────────────────────────────────────────

type Msg =
  | { id: string; role: "ai"; text: string }
  | { id: string; role: "user"; text: string }
  | { id: string; role: "thinking" }
  | { id: string; role: "goal"; preview: GoalPreview };

type Phase = "describe" | "thinking" | "email" | "done";

const CHIPS = ["Reduce churn", "Grow MRR", "Improve activation", "Increase engagement"];
const uid = () => Math.random().toString(36).slice(2);

// ── Chat widget ───────────────────────────────────────────────────────────────

function WaitlistChat() {
  const [phase, setPhase] = useState<Phase>("describe");
  const [msgs, setMsgs] = useState<Msg[]>([
    { id: "welcome", role: "ai", text: "What is your team working toward this quarter? Describe your goal in plain English — the outcome you want, the problem you're solving." },
  ]);
  const [input, setInput] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [toast, setToast] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const msgsRef = useRef<HTMLDivElement>(null);

  // Scroll the messages DIV — not the page
  useEffect(() => {
    if (msgsRef.current) {
      msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
    }
  }, [msgs]);

  function push(...m: Msg[]) { setMsgs(p => [...p, ...m]); }

  function submitDescription() {
    const text = input.trim();
    if (!text || phase !== "describe") return;
    setDescription(text);
    setInput("");
    if (textareaRef.current) { textareaRef.current.style.height = "24px"; }
    const thinkId = uid();
    push({ id: uid(), role: "user", text }, { id: thinkId, role: "thinking" });
    setPhase("thinking");
    setTimeout(() => {
      const preview = generatePreview(text);
      setMsgs(p => p.filter(m => m.id !== thinkId).concat([
        { id: uid(), role: "goal", preview },
        { id: uid(), role: "ai", text: "Here's your goal structured and ready to track. Drop your work email and I'll hold your spot." },
      ]));
      setPhase("email");
    }, 1700);
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || emailLoading) return;
    setEmailLoading(true);
    const result = await joinWaitlist(email, description);
    setEmailLoading(false);
    if (result.success) {
      setToast(true);
      setTimeout(() => {
        setToast(false);
        setMsgs([{ id: "welcome", role: "ai", text: "What is your team working toward this quarter? Describe your goal in plain English — the outcome you want, the problem you're solving." }]);
        setPhase("describe");
        setDescription("");
        setEmail("");
        setEmailError("");
      }, 2800);
      setPhase("done");
    } else setEmailError(result.message);
  }

  return (
    <div className="relative max-w-[820px] mx-auto mt-10">

      {/* Soft glow sits behind — not on — the card */}
      <div className="absolute -inset-10 -z-10 pointer-events-none"
        style={{ background: "radial-gradient(ellipse 80% 55% at 50% 50%, rgba(99,102,241,0.10), transparent)" }} />

      {/* Card — auto height, subtle engraved feel */}
      <div className="relative bg-white rounded-2xl overflow-hidden flex flex-col"
        style={{ border: "1px solid rgba(0,0,0,0.09)", boxShadow: "0 1px 2px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.9)" }}>

        {/* ── Header ───────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100/80 shrink-0">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0">
            <Sparkles size={14} className="text-white" />
          </div>
          <span className="text-[15px] font-semibold text-gray-800">Metrik AI</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <span className="text-[12px] text-gray-400">Early access</span>
          </div>
        </div>

        {/* ── Messages — scrolls after max-height ──────────── */}
        <div ref={msgsRef} className="overflow-y-auto px-6 py-5 flex flex-col gap-4" style={{ maxHeight: "240px" }}>
          {msgs.map((msg) => (
            <div key={msg.id}>

              {msg.role === "ai" && (
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles size={12} className="text-indigo-500" />
                  </div>
                  <p className="text-[14px] text-gray-600 leading-[1.7] pt-0.5 text-left">{msg.text}</p>
                </div>
              )}

              {msg.role === "user" && (
                <div className="flex justify-end">
                  <div className="bg-gray-100 text-gray-700 text-[13px] rounded-2xl rounded-tr-sm px-4 py-3 max-w-[76%] leading-relaxed">
                    {msg.text}
                  </div>
                </div>
              )}

              {msg.role === "thinking" && (
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                    <Sparkles size={12} className="text-indigo-500" />
                  </div>
                  <div className="flex gap-1.5 items-center">
                    {[0, 130, 260].map((d) => (
                      <span key={d} className="w-2 h-2 rounded-full bg-indigo-200 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </div>
                </div>
              )}

              {msg.role === "goal" && (
                <div className="ml-10">
                  <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3.5">
                    <p className="text-[15px] font-bold text-gray-900 mb-1.5 text-left">{msg.preview.title}</p>
                    <p className="text-[12px] text-gray-400 mb-3 text-left">
                      {msg.preview.target} <span className="mx-1.5 text-gray-300">·</span> {msg.preview.timeframe}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.preview.kpis.map((k) => (
                        <span key={k} className="text-[11px] text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full">
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}


            </div>
          ))}
        </div>

        {/* ── Bottom input area ────────────────────────────── */}
        {phase !== "done" && (
          <div className="border-t border-gray-100 px-5 pt-3.5 pb-4 shrink-0">

            {/* Describe input */}
            {phase === "describe" && (
              <>
                <div className="flex items-end gap-3 mb-3">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={input}
                    autoFocus
                    onChange={(e) => {
                      setInput(e.target.value);
                      e.target.style.height = "24px";
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 96)}px`;
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitDescription(); } }}
                    placeholder="Describe your goal…"
                    className="flex-1 text-[14px] text-gray-700 placeholder:text-gray-300 resize-none focus:outline-none leading-relaxed overflow-hidden"
                    style={{ height: "24px" }}
                  />
                  <button
                    onClick={submitDescription}
                    disabled={!input.trim()}
                    className="w-9 h-9 flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 disabled:opacity-20 text-white rounded-xl transition-all shrink-0"
                  >
                    <ArrowUp size={15} />
                  </button>
                </div>
                {/* Chips below input */}
                <div className="flex gap-2 flex-wrap">
                  {CHIPS.map((c) => (
                    <button
                      key={c}
                      onClick={() => { setInput(c); textareaRef.current?.focus(); }}
                      className="text-[12px] text-gray-500 bg-gray-50 border border-gray-200 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 px-3 py-1.5 rounded-full transition-all"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Thinking */}
            {phase === "thinking" && (
              <div className="flex items-center gap-2 text-[13px] text-gray-400 h-9">
                <Loader2 size={14} className="animate-spin text-indigo-400" />
                Structuring your goal…
              </div>
            )}

            {/* Email input */}
            {phase === "email" && (
              <form onSubmit={submitEmail} className="flex gap-2.5">
                <input
                  autoFocus
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="flex-1 text-[14px] text-gray-700 placeholder:text-gray-300 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={emailLoading}
                  className="flex items-center gap-1.5 text-[13px] font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-5 py-2 rounded-xl transition-colors shrink-0"
                >
                  {emailLoading ? <Loader2 size={13} className="animate-spin" /> : <>Join <ArrowRight size={13} /></>}
                </button>
              </form>
            )}
            {emailError && <p className="text-[11px] text-red-500 mt-1.5">{emailError}</p>}

          </div>
        )}
      </div>

      <p className="text-[12px] text-gray-400 mt-3 text-center">
        Already have an account?{" "}
        <Link href="/login" className="text-indigo-500 hover:text-indigo-600 transition-colors">Sign in →</Link>
      </p>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 bg-gray-900 text-white text-[13px] font-medium px-5 py-3 rounded-full shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-300">
          <CheckCircle2 size={14} className="text-green-400 shrink-0" />
          You&apos;re on the list — we&apos;ll be in touch.
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans antialiased">

      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 90% 50% at 50% -5%, rgba(99,102,241,0.09), transparent)" }} />
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-5 max-w-6xl mx-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-metrik.svg" alt="Metrik" className="h-6 w-auto" />
        <div className="flex items-center gap-5">
          <Link href="/login" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">Sign in</Link>
          <Link href="/login" className="flex items-center gap-1.5 text-sm font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors">
            Sign in <ArrowRight size={13} />
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-4xl mx-auto px-8 pt-14 pb-24 text-center">
        <div className="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-100 text-indigo-600 text-xs font-medium px-3.5 py-1.5 rounded-full mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
          Early access · Limited spots available
        </div>
        <h1 className="text-[44px] sm:text-5xl font-bold text-gray-900 leading-[1.1] tracking-tight mb-5">
          Turn feature releases into<br />business outcomes, with AI.
        </h1>
        <p className="text-[17px] text-gray-400 max-w-lg mx-auto leading-relaxed">
          Set a goal. Log a feature. Metrik&apos;s AI tracks impact after launch
          and tells you exactly what moved the needle.
        </p>
        <WaitlistChat />
      </section>

      {/* How it works */}
      <section className="relative z-10 max-w-5xl mx-auto px-8 pb-20">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] text-center mb-10">How it works</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { icon: Target, step: "01", title: "Set a business goal", desc: "Define what your company is trying to achieve. Every feature your team ships stays tied to that goal." },
            { icon: Sparkles, step: "02", title: "Log a feature", desc: "Answer 8 questions. Metrik suggests the right metrics, KPIs, and guardrails — already named and event-wired." },
            { icon: TrendingUp, step: "03", title: "See the real impact", desc: "After launch, Metrik computes whether the feature moved your KPI and generates a shareable stakeholder deck." },
          ].map(({ icon: Icon, step, title, desc }) => (
            <div key={step} className="bg-gray-50/70 border border-gray-100 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center">
                  <Icon size={14} className="text-indigo-500" />
                </div>
                <span className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">{step}</span>
              </div>
              <h3 className="font-semibold text-gray-800 mb-1.5 text-[14px]">{title}</h3>
              <p className="text-[13px] text-gray-400 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 max-w-5xl mx-auto px-8 pb-20">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] text-center mb-10">What&apos;s included</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
          {[
            { icon: Sparkles, label: "AI metric suggestions per feature" },
            { icon: Target, label: "Business goal → KPI hierarchy" },
            { icon: TrendingUp, label: "Post-launch KPI impact scoring" },
            { icon: FileText, label: "One-click stakeholder deck" },
            { icon: Zap, label: "Mixpanel & Amplitude connector" },
            { icon: BarChart3, label: "Cohort analysis & funnels" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-3 bg-gray-50/70 border border-gray-100 rounded-xl px-4 py-3.5">
              <Icon size={14} className="text-indigo-400 shrink-0" />
              <span className="text-[13px] text-gray-500">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 max-w-5xl mx-auto px-8 pb-24">
        <div className="border border-gray-100 rounded-2xl px-8 py-14 text-center bg-gray-50/50">
          <h2 className="text-[28px] font-bold text-gray-900 mb-3 tracking-tight">Built for teams that care about outcomes.</h2>
          <p className="text-gray-400 text-[14px] mb-8 max-w-sm mx-auto leading-relaxed">Early access is limited. Takes 2 minutes to set up. No credit card required.</p>
          <Link
            href="#"
            onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            className="inline-flex items-center gap-2 bg-gray-900 text-white font-medium px-6 py-3 rounded-xl hover:bg-gray-700 transition-colors text-[14px]"
          >
            Join the waitlist <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-gray-100 py-6 px-8 flex items-center justify-between max-w-5xl mx-auto">
        <span className="text-xs text-gray-400 font-semibold">Metrik</span>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Sign in</Link>
          <Link href="/login" className="text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors">Sign in →</Link>
        </div>
      </footer>
    </div>
  );
}
