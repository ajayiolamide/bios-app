import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { ArrowRight, BarChart3, Zap, FileText, Target, TrendingUp, Sparkles } from "lucide-react";

export default async function HomePage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans antialiased">

      {/* ── Subtle gradient background ───────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(139,92,246,0.08),transparent)]" />
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-5 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-metrik.svg" alt="Metrik" className="h-6 w-auto" />
          <span className="font-bold text-base text-gray-900 tracking-tight">Metrik</span>
        </div>
        <div className="flex items-center gap-5">
          <Link href="/login" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="flex items-center gap-1.5 text-sm font-semibold bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            Get started <ArrowRight size={13} />
          </Link>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-4xl mx-auto px-8 pt-20 pb-20 text-center">

        <div className="inline-flex items-center gap-2 bg-violet-50 border border-violet-100 text-violet-600 text-xs font-medium px-3.5 py-1.5 rounded-full mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
          Early access · Limited spots available
        </div>

        <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-[1.1] tracking-tight mb-5">
          The measurement layer<br />for product teams.
        </h1>

        <p className="text-lg text-gray-500 max-w-xl mx-auto mb-10 leading-relaxed">
          Log a feature, set a business goal, and Metrik tells you whether shipping it
          actually moved the needle — with AI-suggested metrics, KPI tracking, and
          stakeholder-ready reports built in.
        </p>

        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link
            href="/signup"
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors text-sm"
          >
            Get early access <ArrowRight size={14} />
          </Link>
          <Link href="/login" className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
            Already have an account →
          </Link>
        </div>
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
                <div className="w-8 h-8 rounded-lg bg-violet-50 border border-violet-100 flex items-center justify-center">
                  <Icon size={14} className="text-violet-500" />
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
              <Icon size={14} className="text-violet-400 shrink-0" />
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
            href="/signup"
            className="inline-flex items-center gap-2 bg-gray-900 text-white font-semibold px-7 py-3.5 rounded-lg hover:bg-gray-700 transition-colors text-sm"
          >
            Get early access <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-gray-100 py-6 px-8 flex items-center justify-between max-w-6xl mx-auto">
        <span className="text-xs text-gray-400 font-semibold">Metrik</span>
        <span className="text-xs text-gray-300">© 2026 MyCovergenius</span>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Sign in</Link>
          <Link href="/signup" className="text-xs font-semibold text-violet-600 hover:text-violet-700 transition-colors">Get started →</Link>
        </div>
      </footer>

    </div>
  );
}
