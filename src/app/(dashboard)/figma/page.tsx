"use client";

import {
  Figma, Sparkles, Zap, Link2, FileText,
  Eye, Code2, Target, ChevronRight, Lock,
} from "lucide-react";

const STEPS = [
  {
    icon: Figma,
    color: "bg-pink-100 text-pink-600",
    title: "Paste your Figma design URL",
    desc: "Connect a Figma frame or flow. BIOS reads every screen, component, and interaction in the flow.",
  },
  {
    icon: Eye,
    color: "bg-violet-100 text-violet-600",
    title: "AI scans for trackable moments",
    desc: "Every button click, form submission, page view, modal open, and state change is surfaced as a potential event trigger.",
  },
  {
    icon: Zap,
    color: "bg-amber-100 text-amber-700",
    title: "Get suggested event names",
    desc: "BIOS proposes clean, consistent event names following your naming convention — e.g. claim_submitted, payment_flow_started.",
  },
  {
    icon: Code2,
    color: "bg-blue-100 text-blue-600",
    title: "Edit & approve tracking plan",
    desc: "Rename events, set properties, add context. Everything is editable inline before it becomes your source of truth.",
  },
  {
    icon: Target,
    color: "bg-emerald-100 text-emerald-600",
    title: "Link to a Feature Metric",
    desc: "Attach the approved events directly to an existing feature plan — closing the loop between design intent and measurement.",
  },
  {
    icon: FileText,
    color: "bg-indigo-100 text-indigo-600",
    title: "Export Mixpanel documentation",
    desc: "Generate a ready-to-share tracking spec: event names, property schemas, Mixpanel implementation notes, and code snippets.",
  },
];

export default function FigmaPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12 space-y-12">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 bg-pink-50 border border-pink-100 text-pink-600 text-xs font-semibold px-3 py-1.5 rounded-full">
          <Lock size={11} /> Coming soon
        </div>

        <div className="flex items-center justify-center gap-3">
          <div className="w-12 h-12 bg-[#1E1E1E] rounded-2xl flex items-center justify-center shadow-lg">
            <Figma size={24} className="text-white" />
          </div>
          <ChevronRight size={20} className="text-gray-300" />
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
            <Sparkles size={22} className="text-white" />
          </div>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 leading-tight">
          Design → Tracking Plan, automatically
        </h1>
        <p className="text-base text-gray-500 max-w-xl mx-auto leading-relaxed">
          Paste a Figma URL. BIOS reads your flow, identifies every trackable moment, suggests event names,
          and connects it all to your Feature Metrics — with a Mixpanel spec ready to ship.
        </p>
      </div>

      {/* ── Preview card ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 bg-gray-50 overflow-hidden">
        <div className="bg-[#1E1E1E] px-4 py-3 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-400" />
          <div className="w-3 h-3 rounded-full bg-amber-400" />
          <div className="w-3 h-3 rounded-full bg-green-400" />
          <span className="ml-2 text-[11px] text-gray-400 font-mono">figma.com/design/…</span>
        </div>
        <div className="p-6 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Detected events</p>
          {[
            { event: "onboarding_started",       trigger: "CTA button clicked",          props: "source, variant" },
            { event: "claim_form_opened",         trigger: "Start claim modal open",      props: "claim_type" },
            { event: "claim_submitted",           trigger: "Submit button clicked",       props: "claim_type, amount" },
            { event: "payment_method_selected",   trigger: "Payment card tapped",         props: "method, is_new" },
            { event: "dashboard_viewed",          trigger: "Dashboard screen rendered",   props: "tab, user_type" },
          ].map((row, i) => (
            <div key={i} className="flex items-start gap-3 p-3 bg-white rounded-xl border border-gray-100">
              <Zap size={13} className="text-indigo-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <code className="text-xs text-indigo-700 font-mono font-semibold">{row.event}</code>
                <p className="text-[11px] text-gray-400 mt-0.5">{row.trigger}</p>
              </div>
              <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-mono flex-shrink-0">{row.props}</span>
              <span className="text-[10px] text-emerald-500 font-medium flex-shrink-0">✓ Linked</span>
            </div>
          ))}
          <p className="text-[11px] text-gray-400 text-center pt-1">
            + 8 more events detected across 12 screens
          </p>
        </div>
      </div>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-5">How it works</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={i} className="flex gap-3 p-4 bg-white rounded-xl border border-gray-100">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${step.color}`}>
                  <Icon size={15} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800 mb-0.5">{step.title}</p>
                  <p className="text-xs text-gray-500 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <div className="text-center bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 rounded-2xl p-8 space-y-3">
        <div className="flex items-center justify-center gap-2 text-indigo-600 mb-2">
          <Link2 size={16} />
          <span className="text-sm font-semibold">Closes the loop between design and data</span>
        </div>
        <p className="text-gray-500 text-sm max-w-md mx-auto">
          No more hand-off documents that go stale. Your Figma design becomes a living tracking plan,
          tied to features, connected to Mixpanel.
        </p>
        <div className="pt-2">
          <span className="inline-flex items-center gap-1.5 text-sm text-indigo-500 font-medium bg-white border border-indigo-100 px-4 py-2 rounded-xl">
            <Lock size={12} /> We&apos;re building this — stay tuned
          </span>
        </div>
      </div>
    </div>
  );
}
