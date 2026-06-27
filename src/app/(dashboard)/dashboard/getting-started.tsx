"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, X, ChevronDown, ChevronUp, Target, Lightbulb, Zap, FileText } from "lucide-react";

type Step = {
  id: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
  cta: string;
  href: string;
  done: boolean;
};

type Props = {
  hasGoal: boolean;
  hasFeature: boolean;
  hasData: boolean;
  hasReport: boolean;
};

const STORAGE_KEY = "metrik_setup_dismissed";

export function GettingStarted({ hasGoal, hasFeature, hasData, hasReport }: Props) {
  const [dismissed, setDismissed] = useState(true); // start hidden to avoid flash
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const wasDismissed = localStorage.getItem(STORAGE_KEY) === "true";
    setDismissed(wasDismissed);
  }, []);

  const steps: Step[] = [
    {
      id: "goal",
      icon: Target,
      iconColor: "text-indigo-500",
      iconBg: "bg-indigo-50",
      title: "Set a business goal",
      description: "Define what your company is trying to achieve. Every feature and KPI will align back to this.",
      cta: "Go to Goals →",
      href: "/goals",
      done: hasGoal,
    },
    {
      id: "feature",
      icon: Lightbulb,
      iconColor: "text-violet-500",
      iconBg: "bg-violet-50",
      title: "Log a feature you're building",
      description: "Describe what you're working on. AI will suggest the right KPIs and success criteria.",
      cta: "Log a feature →",
      href: "/feature-metrics",
      done: hasFeature,
    },
    {
      id: "data",
      icon: Zap,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-50",
      title: "Connect a data source",
      description: "Connect Mixpanel or Amplitude, or upload a CSV. This powers every dashboard and KPI.",
      cta: "Connect source →",
      href: "/sources",
      done: hasData,
    },
    {
      id: "report",
      icon: FileText,
      iconColor: "text-teal-500",
      iconBg: "bg-teal-50",
      title: "Generate your first report",
      description: "Create an AI-powered slide deck for stakeholders from everything you've set up.",
      cta: "Generate report →",
      href: "/reports",
      done: hasReport,
    },
  ];

  const doneCount = steps.filter(s => s.done).length;
  const allDone = doneCount === steps.length;
  const pct = Math.round((doneCount / steps.length) * 100);

  // Don't show if dismissed or all done or not yet mounted
  if (!mounted || dismissed || allDone) return null;

  function handleDismiss() {
    localStorage.setItem(STORAGE_KEY, "true");
    setDismissed(true);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-5 py-4 flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <p className="text-sm font-bold text-gray-900">Get set up</p>
            <span className="text-xs font-semibold text-gray-400">{doneCount}/{steps.length} done</span>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden w-48">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed(v => !v)}
            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button
            onClick={handleDismiss}
            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
            title="Dismiss setup guide"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Steps */}
      {!collapsed && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {steps.map(({ id, icon: Icon, iconColor, iconBg, title, description, cta, href, done }) => (
            <div key={id} className={`px-5 py-3.5 flex items-start gap-4 transition-colors ${done ? "opacity-50" : "hover:bg-gray-50/60"}`}>
              {/* Check */}
              <div className="flex-shrink-0 mt-0.5">
                {done
                  ? <CheckCircle2 size={16} className="text-green-500" />
                  : <Circle size={16} className="text-gray-300" />
                }
              </div>
              {/* Icon */}
              <div className={`w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center flex-shrink-0`}>
                <Icon size={13} className={iconColor} />
              </div>
              {/* Text */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${done ? "line-through text-gray-400" : "text-gray-800"}`}>{title}</p>
                {!done && <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{description}</p>}
              </div>
              {/* CTA */}
              {!done && (
                <Link
                  href={href}
                  className="flex-shrink-0 text-xs font-semibold text-indigo-600 hover:text-indigo-800 whitespace-nowrap transition-colors mt-0.5"
                >
                  {cta}
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
