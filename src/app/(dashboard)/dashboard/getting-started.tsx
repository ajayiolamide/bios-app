"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { X, ArrowRight } from "lucide-react";

const TOUR_STEPS = [
  {
    title: "Business Goals",
    body: "This is where you define what your company is trying to achieve. Set a business goal, then break it into product goals with KPIs — Metrik tracks progress toward them automatically.",
    cta: "Set a goal",
    href: "/goals",
  },
  {
    title: "Feature Metrics",
    body: "Log the features your team is building. Describe what you're building and Metrik's AI will suggest the right success metrics, KPIs, and guardrails to track.",
    cta: "Log a feature",
    href: "/feature-metrics",
  },
  {
    title: "Data Sources",
    body: "Connect Mixpanel or Amplitude, or upload a CSV. Once connected, event data powers your KPIs, feature impact scores, and AI insights automatically.",
    cta: "Connect a source",
    href: "/sources",
  },
  {
    title: "Reports",
    body: "Generate AI-powered slide decks for stakeholders — scoped to your goals, features, and data. Share a live link or export to PDF or PPTX.",
    cta: "Generate a report",
    href: "/reports",
  },
  {
    title: "AI Analyst",
    body: "Ask anything about your product data in plain English. The AI has full context of your goals, features, and events — and remembers past conversations.",
    cta: "Ask the AI",
    href: "/ai-analyst",
  },
];

const STORAGE_KEY = "metrik_tour_dismissed";

export function GettingStarted() {
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [step, setStep] = useState(0);

  useEffect(() => {
    setMounted(true);
    setDismissed(localStorage.getItem(STORAGE_KEY) === "true");
    const saved = parseInt(localStorage.getItem(STORAGE_KEY + "_step") ?? "0", 10);
    setStep(isNaN(saved) ? 0 : saved);
  }, []);

  function goTo(i: number) {
    const next = Math.max(0, Math.min(TOUR_STEPS.length - 1, i));
    setStep(next);
    localStorage.setItem(STORAGE_KEY + "_step", String(next));
  }

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "true");
    setDismissed(true);
  }

  if (!mounted || dismissed) return null;

  const current = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-72">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-lg shadow-gray-200/60 overflow-hidden">

        {/* Step dots + close */}
        <div className="flex items-center justify-between px-4 pt-3.5 pb-0">
          <div className="flex items-center gap-1.5">
            {TOUR_STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={`rounded-full transition-all ${
                  i === step
                    ? "w-4 h-1.5 bg-indigo-500"
                    : i < step
                    ? "w-1.5 h-1.5 bg-indigo-200"
                    : "w-1.5 h-1.5 bg-gray-200"
                }`}
              />
            ))}
          </div>
          <button
            onClick={dismiss}
            className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100 transition-colors"
          >
            <X size={12} />
          </button>
        </div>

        {/* Content */}
        <div className="px-4 pt-3 pb-4">
          <p className="text-[13px] font-semibold text-gray-900 mb-1.5">{current.title}</p>
          <p className="text-[12px] text-gray-500 leading-relaxed mb-4">{current.body}</p>

          <div className="flex items-center gap-3">
            {!isLast ? (
              <>
                <button
                  onClick={() => goTo(step + 1)}
                  className="flex items-center gap-1.5 text-[12px] font-medium bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  Next <ArrowRight size={11} />
                </button>
                <Link
                  href={current.href}
                  className="text-[12px] text-indigo-500 hover:text-indigo-700 font-medium transition-colors"
                >
                  {current.cta} →
                </Link>
              </>
            ) : (
              <>
                <button
                  onClick={dismiss}
                  className="flex items-center gap-1.5 text-[12px] font-medium bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  Got it
                </button>
                <Link
                  href={current.href}
                  className="text-[12px] text-indigo-500 hover:text-indigo-700 font-medium transition-colors"
                >
                  {current.cta} →
                </Link>
              </>
            )}
            {step > 0 && (
              <button onClick={() => goTo(step - 1)} className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors ml-auto">← Back</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
