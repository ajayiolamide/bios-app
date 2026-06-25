import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { ArrowRight, BarChart3, Zap, FileText, Target, TrendingUp, Sparkles } from "lucide-react";

export default async function HomePage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-[#080810] text-white font-sans antialiased">

      {/* ── Ambient glow ─────────────────────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 -left-40 w-[400px] h-[400px] bg-violet-600/8 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 -right-40 w-[400px] h-[400px] bg-blue-600/8 rounded-full blur-[100px]" />
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto border-b border-white/5">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-metrik.svg" alt="Metrik" className="h-6 w-auto brightness-0 invert" />
          <span className="font-bold text-base text-white tracking-tight">Metrik</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-white/40 hover:text-white/80 transition-colors">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="flex items-center gap-1.5 text-sm font-semibold bg-white text-gray-900 px-4 py-2 rounded-lg hover:bg-white/90 transition-colors"
          >
            Request access <ArrowRight size={13} />
          </Link>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pt-24 pb-24 text-center">

        <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 text-white/60 text-xs font-medium px-3.5 py-1.5 rounded-full mb-10">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
          Early access · Limited to select teams
        </div>

        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black leading-[1.03] tracking-tight mb-6">
          <span className="text-white">Know if your features</span>
          <br />
          <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-blue-400 bg-clip-text text-transparent">
            are actually working.
          </span>
        </h1>

        <p className="text-lg text-white/40 max-w-xl mx-auto mb-12 leading-relaxed">
          Connect product releases to real business outcomes. Log a feature, get AI-suggested metrics,
          and know whether it moved the needle — without guessing.
        </p>

        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link
            href="/signup"
            className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-400 text-white font-semibold px-6 py-3 rounded-lg transition-colors text-sm"
          >
            Get early access <ArrowRight size={14} />
          </Link>
          <Link href="/login" className="text-sm text-white/30 hover:text-white/60 transition-colors">
            Sign in →
          </Link>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-24">
        <p className="text-[11px] font-semibold text-white/25 uppercase tracking-[0.15em] text-center mb-12">
          How it works
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: Target,
              step: "01",
              title: "Set a business goal",
              desc: "Define what your company is trying to achieve — growth, retention, revenue. Every feature stays aligned to it.",
            },
            {
              icon: Sparkles,
              step: "02",
              title: "Log a feature",
              desc: "Answer 8 questions. AI suggests the right metrics, KPIs, and guardrails — already named, event-wired, and assigned to a PM.",
            },
            {
              icon: TrendingUp,
              step: "03",
              title: "See the real impact",
              desc: "After launch, Metrik computes whether the feature moved your KPI. One click generates a deck to share with stakeholders.",
            },
          ].map(({ icon: Icon, step, title, desc }) => (
            <div key={step} className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6 hover:border-white/[0.12] transition-colors">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                  <Icon size={15} className="text-indigo-400" />
                </div>
                <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">{step}</span>
              </div>
              <h3 className="font-semibold text-white/90 mb-2 text-sm">{title}</h3>
              <p className="text-sm text-white/35 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-24">
        <p className="text-[11px] font-semibold text-white/25 uppercase tracking-[0.15em] text-center mb-12">
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
            <div key={label} className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3.5 hover:border-white/10 transition-colors">
              <Icon size={14} className="text-indigo-400/70 shrink-0" />
              <span className="text-sm text-white/50">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-24">
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] px-8 py-16 text-center">
          {/* Inner glow */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[600px] h-[200px] bg-indigo-600/10 blur-[80px] rounded-full" />
          </div>
          <div className="relative">
            <h2 className="text-3xl sm:text-4xl font-black text-white mb-3 tracking-tight">
              Built for teams that ship fast<br />and measure what matters.
            </h2>
            <p className="text-white/35 text-sm mb-8">
              Early access is limited. No credit card required.
            </p>
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 bg-white text-gray-900 font-bold px-7 py-3.5 rounded-lg hover:bg-white/90 transition-colors text-sm"
            >
              Get early access <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/5 py-6 px-6 flex items-center justify-between max-w-6xl mx-auto">
        <span className="text-xs text-white/20 font-semibold">Metrik</span>
        <span className="text-xs text-white/15">© 2026 MyCovergenius</span>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-xs text-white/25 hover:text-white/50 transition-colors">Sign in</Link>
          <Link href="/signup" className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors">Request access →</Link>
        </div>
      </footer>

    </div>
  );
}
