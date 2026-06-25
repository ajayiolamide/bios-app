"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  Zap, Target, Lightbulb, ArrowRight, CheckCircle2,
  BarChart3, FileText, Sparkles,
} from "lucide-react";

export default function OnboardingPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");

  useEffect(() => {
    createClient().auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push("/login"); return; }
      const name = user.user_metadata?.full_name?.split(" ")[0]
        ?? user.email?.split("@")[0]
        ?? "";
      setFirstName(name);
    });
  }, [router]);

  const pillars = [
    {
      icon: Zap,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-50",
      accentBorder: "border-t-blue-400",
      number: "01",
      title: "Bring your data",
      body: "Metrik needs to see what's happening in your product. Connect Mixpanel or Amplitude, or upload a CSV. Without events data, the tool can measure nothing.",
      note: "You can skip this and add it later from Sources.",
      cta: "Connect a source",
      href: "/sources",
      ctaStyle: "bg-blue-600 hover:bg-blue-700 text-white",
    },
    {
      icon: Target,
      iconColor: "text-indigo-500",
      iconBg: "bg-indigo-50",
      accentBorder: "border-t-indigo-400",
      number: "02",
      title: "Set a business goal",
      body: "Tell Metrik what your company is actually trying to achieve — growth, retention, revenue. Every feature and metric you track will align back to this.",
      note: "Metrik uses this to make AI suggestions relevant to your real priorities.",
      cta: "Set my first goal",
      href: "/goals",
      ctaStyle: "bg-indigo-600 hover:bg-indigo-700 text-white",
    },
    {
      icon: Lightbulb,
      iconColor: "text-violet-500",
      iconBg: "bg-violet-50",
      accentBorder: "border-t-violet-400",
      number: "03",
      title: "Log a feature",
      body: "Describe something you're building. AI will suggest the right metrics, KPIs, and guardrails to track — already named and ready to wire up. After launch, Metrik measures whether it moved the needle.",
      note: "This is where the product gets interesting.",
      cta: "Log my first feature",
      href: "/feature-metrics",
      ctaStyle: "bg-violet-600 hover:bg-violet-700 text-white",
    },
  ];

  return (
    <div className="min-h-screen bg-white">

      {/* Nav */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100 max-w-6xl mx-auto">
        <span className="font-black text-lg text-gray-900 tracking-tight">Metrik</span>
        <Link
          href="/dashboard"
          className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
        >
          Skip setup, explore on my own →
        </Link>
      </div>

      {/* Hero text */}
      <div className="max-w-6xl mx-auto px-8 pt-14 pb-10">
        <div className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-600 text-xs font-semibold px-3 py-1.5 rounded-full border border-indigo-100 mb-5">
          <Sparkles size={11} /> Workspace created
        </div>
        <h1 className="text-4xl font-black text-gray-900 tracking-tight mb-3">
          {firstName ? `Welcome, ${firstName}.` : "Welcome."}{" "}
          <span className="text-gray-400 font-normal">Here&apos;s how to get the most out of Metrik.</span>
        </h1>
        <p className="text-gray-500 text-lg max-w-2xl leading-relaxed">
          Metrik works by connecting your events data, your business goals, and your features. The more of these you set up, the more useful the tool becomes. All three are optional — but each one unlocks something.
        </p>
      </div>

      {/* 3 Pillars */}
      <div className="max-w-6xl mx-auto px-8 pb-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {pillars.map(({ icon: Icon, iconColor, iconBg, accentBorder, number, title, body, note, cta, href, ctaStyle }) => (
            <div
              key={title}
              className={`bg-white border border-gray-100 border-t-4 ${accentBorder} rounded-2xl p-7 flex flex-col shadow-sm`}
            >
              <div className="flex items-center gap-3 mb-5">
                <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
                  <Icon size={18} className={iconColor} />
                </div>
                <span className="text-[11px] font-bold text-gray-300 uppercase tracking-widest">{number}</span>
              </div>

              <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed mb-4 flex-1">{body}</p>

              <p className="text-[11px] text-gray-400 bg-gray-50 rounded-lg px-3 py-2 mb-5 leading-relaxed">
                💡 {note}
              </p>

              <Link
                href={href}
                className={`flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors ${ctaStyle}`}
              >
                {cta} <ArrowRight size={14} />
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* What you get section */}
      <div className="max-w-6xl mx-auto px-8 pb-16">
        <div className="bg-gray-50 border border-gray-100 rounded-2xl px-8 py-8">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-6">Everything that unlocks as you set up</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: BarChart3,    color: "text-blue-400",   label: "Event counts, trends, and raw stream",          dep: "Requires: data source" },
              { icon: Target,      color: "text-indigo-400", label: "Business goal → product goal alignment",         dep: "Requires: a goal" },
              { icon: Sparkles,    color: "text-violet-400", label: "AI metric & KPI suggestions",                   dep: "Requires: a feature + goal" },
              { icon: CheckCircle2,color: "text-green-400",  label: "Post-launch impact scoring",                    dep: "Requires: data + feature + goal" },
              { icon: FileText,    color: "text-indigo-400", label: "Auto-generated slide deck reports",             dep: "Requires: a goal" },
              { icon: Zap,         color: "text-blue-400",   label: "Slack digests (daily / weekly / monthly)",      dep: "Requires: Slack + goal" },
            ].map(({ icon: Icon, color, label, dep }) => (
              <div key={label} className="flex items-start gap-3">
                <Icon size={14} className={`${color} flex-shrink-0 mt-0.5`} />
                <div>
                  <p className="text-sm text-gray-700">{label}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{dep}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200 flex items-center justify-between flex-wrap gap-4">
            <p className="text-sm text-gray-500">
              You can set all of this up later from inside the app. Nothing is locked.
            </p>
            <Link
              href="/dashboard"
              className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold px-6 py-3 rounded-xl transition-colors"
            >
              Take me to the dashboard <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>

    </div>
  );
}
