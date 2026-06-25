import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import {
  ArrowRight, CheckCircle2, BarChart3, Zap, FileText,
  Target, TrendingUp, Sparkles,
} from "lucide-react";

export default async function HomePage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">

      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <nav className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-metrik.svg" alt="Metrik" className="h-7 w-auto" onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }} />
          <span className="font-black text-lg text-gray-900 tracking-tight">Metrik</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="flex items-center gap-1.5 text-sm font-semibold bg-indigo-600 text-white px-4 py-2 rounded-xl hover:bg-indigo-700 transition-colors"
          >
            Get started <ArrowRight size={13} />
          </Link>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-20 text-center">
        <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-600 text-xs font-semibold px-3 py-1.5 rounded-full border border-indigo-100 mb-8">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
          </span>
          Beta — free to try, no credit card
        </div>

        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 leading-[1.05] tracking-tight mb-5">
          Know if your features<br />
          <span className="text-indigo-600">are actually working.</span>
        </h1>
        <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed">
          Metrik connects your product releases to real business outcomes. Log a feature,
          get AI-suggested metrics, and see whether it moved the needle — without guessing.
        </p>

        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link
            href="/signup"
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-7 py-3.5 rounded-xl transition-colors text-sm shadow-sm"
          >
            Start free <ArrowRight size={15} />
          </Link>
          <Link href="/login" className="text-sm text-gray-400 hover:text-gray-700 px-4 py-3.5 transition-colors">
            Already have an account →
          </Link>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <section className="bg-gray-50 border-y border-gray-100 py-16">
        <div className="max-w-6xl mx-auto px-6">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest text-center mb-10">
            How it works
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Target,
                color: "bg-indigo-100 text-indigo-600",
                step: "01",
                title: "Set a business goal",
                desc: "Define what your company is trying to achieve — growth, retention, revenue. Metrik keeps every feature aligned to it.",
              },
              {
                icon: Sparkles,
                color: "bg-violet-100 text-violet-600",
                step: "02",
                title: "Log a feature",
                desc: "Describe what you're building in 8 quick questions. AI suggests the right metrics, KPIs, and guardrails — already named and event-wired.",
              },
              {
                icon: TrendingUp,
                color: "bg-blue-100 text-blue-600",
                step: "03",
                title: "See the real impact",
                desc: "After launch, Metrik computes whether the feature moved your KPI. Generate a one-click deck to share results with stakeholders.",
              },
            ].map(({ icon: Icon, color, step, title, desc }) => (
              <div key={step} className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center mb-4`}>
                  <Icon size={18} />
                </div>
                <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-1">{step}</p>
                <h3 className="font-bold text-gray-900 mb-2">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest text-center mb-10">
          Everything in the beta
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { icon: Sparkles,  color: "text-indigo-500", label: "AI tracking suggestions per feature" },
            { icon: Target,    color: "text-violet-500", label: "Business goal → product goal hierarchy" },
            { icon: TrendingUp,color: "text-blue-500",   label: "Post-launch KPI impact scoring" },
            { icon: FileText,  color: "text-indigo-500", label: "One-click slide deck generation" },
            { icon: Zap,       color: "text-violet-500", label: "Mixpanel & Amplitude integration" },
            { icon: BarChart3, color: "text-blue-500",   label: "Cohort analysis & funnels" },
          ].map(({ icon: Icon, color, label }) => (
            <div key={label} className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3.5">
              <Icon size={15} className={`${color} flex-shrink-0`} />
              <span className="text-sm text-gray-700">{label}</span>
            </div>
          ))}
        </div>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl">
          {[
            "Free during beta",
            "Slack digest (daily / weekly / monthly)",
            "AI business brief on your dashboard",
            "Multi-workspace support",
          ].map(item => (
            <div key={item} className="flex items-center gap-2">
              <CheckCircle2 size={13} className="text-indigo-400 flex-shrink-0" />
              <span className="text-sm text-gray-500">{item}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="bg-indigo-600 rounded-3xl px-8 py-14 text-center">
          <h2 className="text-3xl font-black text-white mb-3 tracking-tight">
            Ready to see what&apos;s actually working?
          </h2>
          <p className="text-indigo-200 text-sm mb-7">
            Free during beta · Takes 2 minutes to set up · No credit card
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 bg-white text-indigo-700 font-bold px-7 py-3.5 rounded-xl hover:bg-indigo-50 transition-colors text-sm shadow-sm"
          >
            Get started free <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 py-6 px-6 flex items-center justify-between max-w-6xl mx-auto">
        <span className="text-xs text-gray-400 font-semibold">Metrik</span>
        <span className="text-xs text-gray-300">Beta 2026 · Built by MyCovergenius</span>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-xs text-gray-400 hover:text-gray-600">Sign in</Link>
          <Link href="/signup" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">Get started →</Link>
        </div>
      </footer>

    </div>
  );
}
