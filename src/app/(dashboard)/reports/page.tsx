"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useOrg } from "@/contexts/org-context";
import {
  getReportSources, saveReportSource, deleteReportSource,
  fetchSheetData, getCachedSheetData, getReports,
  planReport, buildReportFromPlan, deleteReport,
  updateReportSourceConfig, suggestSourceConfig, uploadSlideImage,
} from "@/app/actions/reports";
import type { BiosSections, DataParameter, SourceConfig, SlideGuide } from "@/app/actions/reports";
import {
  createReviewSession, updateReviewDeck, updateReviewAccess, getReviewComments, resolveComment, replanSlide, getOrgReviewSessions, deleteReviewSession, getReviewSessionForOwner,
  remapCommentSlideIndexes,
} from "@/app/actions/review";
import type { SlideComment } from "@/app/actions/review";
import { getReportTemplates } from "@/app/actions/settings";
import { getCohortConversion, getCohortRetention, type CohortFilter } from "@/app/actions/cohorts";
import type { ReportSource, Report, ReportTemplate, BrandSettings } from "@/types/database";
import type { SlidesDeck, SlideContent, DesignTheme } from "@/app/actions/reports";
import { SlideCard } from "@/components/reports/slide-card";
import {
  FileText, Plus, Trash2, RefreshCw, Download, CheckCircle2, XCircle, Loader2,
  Link, Edit3, Table, LayoutTemplate, History, Zap, ExternalLink, AlertCircle,
  Filter, X, ChevronDown, ChevronLeft, ChevronRight, Eye, Sparkles,
  Coins, MessageSquare, Share2, RotateCcw, Settings2, SlidersHorizontal,
  Target, FlaskConical, ListOrdered, BookOpen, Bookmark, ImagePlus,
} from "lucide-react";
import { getSavedInsights, type SavedInsight } from "@/app/actions/saved-insights";
import { getMyOrgFlags } from "@/app/actions/flags";
import { LockedFeature } from "@/components/locked-feature";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Accept any Google Sheets URL format and return a published CSV URL.
 * Handles:
 *  - Already a published CSV URL → return as-is
 *  - /spreadsheets/d/{id}/edit   → convert to CSV export URL
 *  - /spreadsheets/d/{id}/pub    → ensure output=csv
 *  - Bare spreadsheet ID (no slashes) → build export URL
 */
function normalizeSheetUrl(input: string): string {
  // Already a published CSV URL
  if (input.includes("output=csv") || input.includes("/pub?") || input.includes("export?format=csv")) {
    return input;
  }
  // Extract spreadsheet ID from any Sheets URL
  const idMatch = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (idMatch) {
    const sheetId = idMatch[1];
    // Extract gid if present (specific sheet tab)
    const gidMatch = input.match(/[#?&]gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : "0";
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  }
  // Bare ID (no URL structure) — assume it's a spreadsheet ID
  if (/^[a-zA-Z0-9_-]{25,}$/.test(input)) {
    return `https://docs.google.com/spreadsheets/d/${input}/export?format=csv&gid=0`;
  }
  // Unknown format — return as-is and let the fetch fail with a clear error
  return input;
}

function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusBadge({ status }: { status: Report["status"] }) {
  const map = {
    done: { icon: <CheckCircle2 size={12} />, label: "Done", cls: "bg-green-100 text-green-700" },
    generating: { icon: <Loader2 size={12} className="animate-spin" />, label: "Generating", cls: "bg-blue-100 text-blue-700" },
    failed: { icon: <XCircle size={12} />, label: "Failed", cls: "bg-red-100 text-red-700" },
    pending: { icon: <Loader2 size={12} />, label: "Pending", cls: "bg-gray-100 text-gray-600" },
  };
  const { icon, label, cls } = map[status];
  return <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{icon} {label}</span>;
}

// ─── Slide preview renderer ───────────────────────────────────────────────────
// Moved to src/components/reports/slide-card.tsx so the editor and the
// public review page render decks with the exact same component instead of
// two copies that silently drifted apart (see that file's header comment).

// ─── Preview modal ────────────────────────────────────────────────────────────

const SLIDE_TYPE_OPTIONS: { type: SlideContent["type"]; label: string; icon: string }[] = [
  { type: "title",          label: "Title",         icon: "T" },
  { type: "big_stat",       label: "Big Stat",      icon: "#" },
  { type: "stat_narrative", label: "Stat + Story",  icon: "N" },
  { type: "bar_chart",      label: "Bar Chart",     icon: "▦" },
  { type: "line_chart",     label: "Line Chart",    icon: "↗" },
  { type: "pie_chart",      label: "Pie / Donut",   icon: "◕" },
  { type: "progress_bars",  label: "Progress",      icon: "≡" },
  { type: "kpi_grid",       label: "KPI Grid",      icon: "⊞" },
  { type: "insight",        label: "Insight",       icon: "★" },
  { type: "bullet_list",    label: "Bullet List",   icon: "•" },
  { type: "action_plan",    label: "Action Plan",   icon: "→" },
  { type: "closing",        label: "Closing",       icon: "✓" },
];

// Converts a slide to a new type, preserving the title/headline where possible
function convertToType(slide: SlideContent, newType: SlideContent["type"]): SlideContent {
  const blank = blankSlide(newType);
  // Try to extract a title from the current slide to carry over
  const oldTitle =
    ("headline" in slide ? (slide as { headline?: string }).headline : undefined) ??
    ("title"    in slide ? (slide as { title?:    string }).title    : undefined) ??
    "";
  if (!oldTitle) return blank;
  if (newType === "title" || newType === "closing") {
    return { ...(blank as { type: typeof newType; headline: string; subtitle: string }), headline: oldTitle };
  }
  if ("title" in blank) {
    return { ...blank, title: oldTitle } as SlideContent;
  }
  return blank;
}

function blankSlide(type: SlideContent["type"]): SlideContent {
  if (type === "title")          return { type, headline: "New Slide", subtitle: "Add your subtitle here" };
  if (type === "closing")        return { type, headline: "Thank You", subtitle: "Questions & Discussion" };
  if (type === "big_stat")       return { type, label: "Metric", value: "0", change: "—", change_direction: "flat", context: "Add context" };
  if (type === "stat_narrative") return { type, title: "Key Metric", stat: "0%", stat_label: "of target", change: "—", change_direction: "flat" as const, narrative: "Add the business story behind this number — what's driving it, why it matters, and what happens next.", status: "neutral" as const };
  if (type === "bar_chart")      return { type, title: "New Chart", subtitle: "", orientation: "vertical", series: [{ label: "Item A", value: 10 }, { label: "Item B", value: 20 }] };
  if (type === "line_chart")     return { type, title: "Trend", subtitle: "", series: [{ label: "Jan", value: 10 }, { label: "Feb", value: 20 }, { label: "Mar", value: 15 }] };
  if (type === "pie_chart")      return { type, title: "Breakdown", subtitle: "", style: "pie" as const, segments: [{ label: "Category A", value: 40 }, { label: "Category B", value: 35 }, { label: "Category C", value: 25 }] };
  if (type === "progress_bars")  return { type, title: "Progress", items: [{ label: "Goal", value: 50, target: 100, unit: "%", status: "neutral" as const }] };
  if (type === "kpi_grid")       return { type, title: "KPIs", kpis: [{ label: "Metric", value: "—", target: "—", status: "neutral" }] };
  if (type === "insight")        return { type, title: "Key Insight", stat: "0%", stat_label: "metric", body: "Add your insight here.", status: "neutral", stat_width: "balanced" };
  if (type === "action_plan")    return {
    type, title: "Recommended Next Steps", subtitle: "Based on what this report surfaced",
    items: [{ department: "Product & Growth", recommendation: "Investigate the drop-off step", rationale: "Tied to the funnel decline shown earlier in this deck", priority: "high" }],
  };
  return { type: "bullet_list", title: "New Slide", items: ["Point one", "Point two", "Point three"] };
}

// ─── Chart type converter ─────────────────────────────────────────────────────

const CHART_SWITCH_OPTIONS = [
  { type: "bar_chart",  label: "Bar",   icon: "▦" },
  { type: "line_chart", label: "Line",  icon: "↗" },
  { type: "pie_chart",  label: "Pie",   icon: "◕" },
] as const;

type ChartSlideType = "bar_chart" | "line_chart" | "pie_chart";

function convertChartType(slide: SlideContent, to: ChartSlideType): SlideContent {
  // Extract generic series from current slide
  let labels: string[] = [];
  let values: number[] = [];

  if (slide.type === "bar_chart") {
    labels = slide.series.map(s => s.label);
    values = slide.series.map(s => s.value);
  } else if (slide.type === "line_chart") {
    labels = slide.series.map(s => s.label);
    values = slide.series.map(s => s.value);
  } else if (slide.type === "pie_chart") {
    labels = slide.segments.map(s => s.label);
    values = slide.segments.map(s => s.value);
  }

  const title = (slide as { title?: string }).title ?? "Chart";
  const subtitle = (slide as { subtitle?: string }).subtitle ?? "";

  if (to === "bar_chart") {
    return { type: "bar_chart", title, subtitle, orientation: "vertical", series: labels.map((l, i) => ({ label: l, value: values[i] ?? 0 })) };
  }
  if (to === "line_chart") {
    return { type: "line_chart", title, subtitle, series: labels.map((l, i) => ({ label: l, value: values[i] ?? 0 })) };
  }
  // pie_chart
  return { type: "pie_chart", title, subtitle, style: "pie", segments: labels.map((l, i) => ({ label: l, value: values[i] ?? 0 })) };
}

// ─── Reference image positioner ───────────────────────────────────────────────
// Lets the user drag the attached screenshot around a small 16:9 stand-in for
// the slide, and resize it from the bottom-right handle. Position/size are
// stored as percentages (0-100) of the slide box, so the exact same numbers
// drive the live preview (slide-card.tsx) and the PPTX export (reports.ts) —
// what you see here is what ends up on the actual slide.
function ImagePositioner({
  imageUrl, x, y, w, h, onChange,
}: {
  imageUrl: string;
  x: number; y: number; w: number; h: number;
  onChange: (pos: { x: number; y: number; w: number; h: number }) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: "move" | "resize"; startX: number; startY: number; orig: { x: number; y: number; w: number; h: number } } | null>(null);

  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

  const onPointerMove = (e: PointerEvent) => {
    const ds = dragRef.current;
    const box = boxRef.current;
    if (!ds || !box) return;
    const rect = box.getBoundingClientRect();
    const dxPct = ((e.clientX - ds.startX) / rect.width) * 100;
    const dyPct = ((e.clientY - ds.startY) / rect.height) * 100;
    if (ds.mode === "move") {
      onChange({
        x: clamp(ds.orig.x + dxPct, 0, 100 - ds.orig.w),
        y: clamp(ds.orig.y + dyPct, 0, 100 - ds.orig.h),
        w: ds.orig.w,
        h: ds.orig.h,
      });
    } else {
      onChange({
        x: ds.orig.x,
        y: ds.orig.y,
        w: clamp(ds.orig.w + dxPct, 8, 100 - ds.orig.x),
        h: clamp(ds.orig.h + dyPct, 8, 100 - ds.orig.y),
      });
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  const startDrag = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, orig: { x, y, w, h } };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  return (
    <div
      ref={boxRef}
      className="relative w-full rounded-lg border border-gray-200 bg-gray-50 overflow-hidden select-none"
      style={{ aspectRatio: "16/9", touchAction: "none" }}
    >
      <div
        onPointerDown={startDrag("move")}
        className="absolute cursor-move"
        style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" className="w-full h-full object-cover rounded border-2 border-indigo-400 pointer-events-none" />
        <div
          onPointerDown={startDrag("resize")}
          className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-indigo-500 border-2 border-white shadow cursor-nwse-resize"
        />
      </div>
    </div>
  );
}

// ─── Slide field editor ───────────────────────────────────────────────────────

function SlideEditor({ slide, onChange }: { slide: SlideContent; onChange: (s: SlideContent) => void }) {
  const [showTypePicker, setShowTypePicker] = useState(false);
  // Cache slide content per type so switching back restores the original content
  // instead of blanking it. Keyed by slide.type string.
  const typeHistoryRef = useRef<Map<string, SlideContent>>(new Map());

  const handleTypeChange = (newType: SlideContent["type"]) => {
    // Save the current slide under its current type before switching away
    typeHistoryRef.current.set(slide.type, slide);
    // Restore from cache if we've visited this type before, otherwise convert
    const cached = typeHistoryRef.current.get(newType);
    onChange(cached ?? convertToType(slide, newType));
    setShowTypePicker(false);
  };

  // Full slide-type switcher — converts to any type, preserving title where possible
  const typeSwitcher = (
    <div className="border border-gray-200 rounded-xl p-3">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Slide type</label>
        <button onClick={() => setShowTypePicker(v => !v)}
          className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700 transition-colors">
          {showTypePicker ? "Done" : "Change type"}
        </button>
      </div>
      <p className="text-sm font-medium text-gray-700 capitalize">{slide.type.replace(/_/g, " ")}</p>
      {showTypePicker && (
        <div className="mt-2.5 grid grid-cols-3 gap-1.5">
          {SLIDE_TYPE_OPTIONS.map(opt => (
            <button key={opt.type}
              onClick={() => handleTypeChange(opt.type)}
              className={`flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg border text-xs font-medium transition-colors ${
                slide.type === opt.type
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-gray-500 border-gray-200 hover:border-indigo-300 hover:text-indigo-600"
              }`}>
              <span className="text-sm leading-none">{opt.icon}</span>
              <span className="text-[10px] leading-tight text-center">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const field = (label: string, value: string, key: string, multiline = false) => (
    <div key={key}>
      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</label>
      {multiline
        ? <textarea value={value} rows={3} onChange={e => onChange({ ...slide, [key]: e.target.value } as SlideContent)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
        : <input value={value} onChange={e => onChange({ ...slide, [key]: e.target.value } as SlideContent)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
      }
    </div>
  );

  // Chart series/segment/item values are real numbers used for bar height,
  // line position, pie proportion, etc. — typing a thousands-separator
  // comma straight into one (e.g. "5,923") used to silently wreck it:
  // parseFloat stops at the first non-numeric character, so "5,923" parsed
  // as 5, and since the textarea's displayed text is regenerated from that
  // freshly-parsed (and now wrong) number on every change, it looked like
  // the comma itself was being rejected. Stripping commas before parsing
  // means typing them is harmless either way, and the actual chart now
  // formats values with commas automatically (see slide-card.tsx) so there's
  // no need to type them by hand at all.
  const parseNum = (s: string): number => parseFloat(s.replace(/,/g, "")) || 0;

  const sel = (label: string, value: string, key: string, opts: string[]) => (
    <div key={key}>
      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</label>
      <select value={value} onChange={e => onChange({ ...slide, [key]: e.target.value } as SlideContent)}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300">
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  // Chart type switcher — shown for all chart slide types
  const isChartSlide = ["bar_chart", "line_chart", "pie_chart"].includes(slide.type);
  const chartSwitcher = isChartSlide ? (
    <div>
      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Chart type</label>
      <div className="flex gap-1.5">
        {CHART_SWITCH_OPTIONS.map(opt => (
          <button key={opt.type}
            onClick={() => onChange(convertChartType(slide, opt.type))}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-lg border text-xs font-medium transition-colors ${
              slide.type === opt.type
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600"
            }`}>
            <span className="text-base leading-none">{opt.icon}</span>
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  ) : null;

  if (slide.type === "title" || slide.type === "closing") return (
    <div className="space-y-3">
      {typeSwitcher}
      {field("Headline", slide.headline, "headline")}
      {field("Subtitle", slide.subtitle, "subtitle", true)}
    </div>
  );

  if (slide.type === "big_stat") return (
    <div className="space-y-3">
      {typeSwitcher}
      {field("Label", slide.label, "label")}
      {field("Value", slide.value, "value")}
      {field("Change", slide.change, "change")}
      {sel("Direction", slide.change_direction, "change_direction", ["up", "down", "flat"])}
      {field("Context", slide.context, "context", true)}
      {field("Narrative (optional — adds a story column beside the number)", slide.narrative ?? "", "narrative", true)}
    </div>
  );

  if (slide.type === "insight") return (
    <div className="space-y-3">
      {typeSwitcher}
      {field("Title", slide.title, "title")}
      {field("Stat", slide.stat, "stat")}
      {field("Stat label", slide.stat_label, "stat_label")}
      {field("Body", slide.body, "body", true)}
      {sel("Status", slide.status, "status", ["positive", "negative", "neutral"])}
      {sel("Stat box width", slide.stat_width ?? "balanced", "stat_width", ["narrow", "balanced", "wide"])}
    </div>
  );

  if (slide.type === "bullet_list") return (
    <div className="space-y-3">
      {typeSwitcher}
      {field("Title", slide.title, "title")}
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Bullet points (one per line)</label>
        <textarea rows={6} value={slide.items.join("\n")}
          onChange={e => onChange({ ...slide, items: e.target.value.split("\n") } as SlideContent)}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
      </div>
    </div>
  );

  if (slide.type === "action_plan") return (
    <div className="space-y-3">
      {typeSwitcher}
      {field("Title", slide.title, "title")}
      {field("Subtitle", slide.subtitle ?? "", "subtitle")}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Recommendations (max 4)</label>
          {slide.items.length < 4 && (
            <button
              onClick={() => onChange({ ...slide, items: [...slide.items, { department: "Department", recommendation: "New recommendation", rationale: "Why this team", priority: "medium" }] } as SlideContent)}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700">+ Add item</button>
          )}
        </div>
        <div className="space-y-2.5">
          {slide.items.map((item, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-2.5 space-y-2 relative">
              <button
                onClick={() => onChange({ ...slide, items: slide.items.filter((_, j) => j !== i) } as SlideContent)}
                className="absolute top-2 right-2 text-gray-300 hover:text-red-500 text-xs">✕</button>
              <input value={item.department}
                onChange={e => onChange({ ...slide, items: slide.items.map((it, j) => j === i ? { ...it, department: e.target.value } : it) } as SlideContent)}
                placeholder="Department / role"
                className="w-full text-xs font-semibold border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <input value={item.recommendation}
                onChange={e => onChange({ ...slide, items: slide.items.map((it, j) => j === i ? { ...it, recommendation: e.target.value } : it) } as SlideContent)}
                placeholder="Recommendation"
                className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <input value={item.rationale}
                onChange={e => onChange({ ...slide, items: slide.items.map((it, j) => j === i ? { ...it, rationale: e.target.value } : it) } as SlideContent)}
                placeholder="Rationale — why this department"
                className="w-full text-xs text-gray-500 border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <select value={item.priority}
                onChange={e => onChange({ ...slide, items: slide.items.map((it, j) => j === i ? { ...it, priority: e.target.value as "high" | "medium" | "low" } : it) } as SlideContent)}
                className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <option value="high">High priority</option>
                <option value="medium">Medium priority</option>
                <option value="low">Low priority</option>
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (slide.type === "bar_chart") return (
    <div className="space-y-3">
      {typeSwitcher}
      {chartSwitcher}
      {field("Title", slide.title, "title")}
      {field("Subtitle", slide.subtitle ?? "", "subtitle")}
      {sel("Orientation", slide.orientation, "orientation", ["vertical", "horizontal"])}
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Series (label: value)</label>
        <textarea rows={6}
          value={slide.series.map(s => `${s.label}: ${s.value}${s.target != null ? ` / ${s.target}` : ""}`).join("\n")}
          onChange={e => {
            const series = e.target.value.split("\n").map(line => {
              const [labelPart, ...rest] = line.split(":");
              const [val, tgt] = (rest.join(":")).split("/").map(s => s.trim());
              return { label: labelPart?.trim() ?? "", value: parseNum(val ?? ""), ...(tgt ? { target: parseNum(tgt) } : {}) };
            });
            onChange({ ...slide, series });
          }}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none font-mono" />
        <p className="text-[11px] text-gray-400 mt-1">Format: Label: value / target (target optional)</p>
      </div>
    </div>
  );

  if (slide.type === "line_chart") return (
    <div className="space-y-3">
      {typeSwitcher}
      {chartSwitcher}
      {field("Title", slide.title, "title")}
      {field("Subtitle", slide.subtitle ?? "", "subtitle")}
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Data points (label: value)</label>
        <textarea rows={6}
          value={slide.series.map(s => `${s.label}: ${s.value}`).join("\n")}
          onChange={e => {
            const series = e.target.value.split("\n").map(line => {
              const [labelPart, ...rest] = line.split(":");
              return { label: labelPart?.trim() ?? "", value: parseNum(rest.join(":").trim()) };
            });
            onChange({ ...slide, series });
          }}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none font-mono" />
        <p className="text-[11px] text-gray-400 mt-1">Format: Label: value (use sequential labels like Jan, Feb…)</p>
      </div>
    </div>
  );

  if (slide.type === "pie_chart") return (
    <div className="space-y-3">
      {typeSwitcher}
      {chartSwitcher}
      {field("Title", slide.title, "title")}
      {field("Subtitle", slide.subtitle ?? "", "subtitle")}
      {sel("Style", slide.style, "style", ["pie", "donut"])}
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Segments (label: value)</label>
        <textarea rows={6}
          value={slide.segments.map(s => `${s.label}: ${s.value}`).join("\n")}
          onChange={e => {
            const segments = e.target.value.split("\n").map(line => {
              const [labelPart, ...rest] = line.split(":");
              return { label: labelPart?.trim() ?? "", value: parseNum(rest.join(":").trim()) };
            });
            onChange({ ...slide, segments });
          }}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none font-mono" />
        <p className="text-[11px] text-gray-400 mt-1">Values represent parts of a whole (3–7 segments work best)</p>
      </div>
    </div>
  );

  if (slide.type === "progress_bars") return (
    <div className="space-y-3">
      {typeSwitcher}
      {field("Title", slide.title, "title")}
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Items (label: value / target unit)</label>
        <textarea rows={6}
          value={slide.items.map(it => `${it.label}: ${it.value} / ${it.target} ${it.unit}`).join("\n")}
          onChange={e => {
            const items = e.target.value.split("\n").map(line => {
              const [labelPart, rest] = line.split(":");
              const parts = (rest ?? "").trim().split(/[\s/]+/);
              return { label: labelPart?.trim() ?? "", value: parseNum(parts[0] ?? ""), target: parts[1] ? parseNum(parts[1]) : 100, unit: parts[2] ?? "%", status: "neutral" as const };
            });
            onChange({ ...slide, items });
          }}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none font-mono" />
        <p className="text-[11px] text-gray-400 mt-1">Format: Label: value / target unit</p>
      </div>
    </div>
  );

  if (slide.type === "kpi_grid") return (
    <div className="space-y-3">
      {typeSwitcher}
      {field("Title", slide.title, "title")}
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">KPIs (label: value / target)</label>
        <textarea rows={6}
          value={slide.kpis.map(k => `${k.label}: ${k.value} / ${k.target}`).join("\n")}
          onChange={e => {
            const kpis = e.target.value.split("\n").map(line => {
              const [labelPart, rest] = line.split(":");
              const [val, tgt] = (rest ?? "").split("/").map(s => s.trim());
              return { label: labelPart?.trim() ?? "", value: val ?? "—", target: tgt ?? "—", status: "neutral" as const };
            });
            onChange({ ...slide, kpis });
          }}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none font-mono" />
      </div>
    </div>
  );

  if (slide.type === "stat_narrative") return (
    <div className="space-y-3">
      {typeSwitcher}
      {field("Title", slide.title, "title")}
      {field("Stat (big number)", slide.stat, "stat")}
      {field("Stat label", slide.stat_label, "stat_label")}
      {field("Change vs prior period", slide.change, "change")}
      {sel("Direction", slide.change_direction, "change_direction", ["up", "down", "flat"])}
      {sel("Status", slide.status, "status", ["positive", "negative", "neutral"])}
      {field("Narrative (2–3 sentences)", slide.narrative, "narrative", true)}
    </div>
  );

  return <div className="space-y-3">{typeSwitcher}<p className="text-xs text-gray-400">No additional fields for this slide type.</p></div>;
}

// ─── Present mode ─────────────────────────────────────────────────────────────

const BG_PRESETS = [
  { label: "Navy",    color: "#0F172A" },
  { label: "Black",   color: "#000000" },
  { label: "Indigo",  color: "#1E1B4B" },
  { label: "Onyx",    color: "#111827" },
  { label: "Teal",    color: "#042F2E" },
  { label: "Plum",    color: "#2E1065" },
  { label: "Slate",   color: "#1E293B" },
  { label: "White",   color: "#F8FAFC" },
];

function PresentMode({ slides, brand, deckTitle, startIdx, onExit }: {
  slides: SlideContent[];
  brand: { primary: string; secondary: string; logoUrl?: string | null };
  deckTitle: string;
  startIdx: number;
  onExit: () => void;
}) {
  const [idx, setIdx] = useState(startIdx);
  const [zoom, setZoom] = useState(1);
  const [bgColor, setBgColor] = useState("#0F172A");
  const [showBgPicker, setShowBgPicker] = useState(false);
  const total = slides.length;

  // Derived: filmstrip and bottom bar use slightly darker version of bg
  const isDark = (() => {
    const hex = bgColor.replace("#", "");
    const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
  })();
  const textColor  = isDark ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.6)";
  const borderColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)";
  const hoverBg    = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT") return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") setIdx(i => Math.min(total - 1, i + 1));
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") setIdx(i => Math.max(0, i - 1));
      if (e.key === "Escape") { if (showBgPicker) setShowBgPicker(false); else onExit(); }
      // Zoom shortcuts
      if ((e.key === "=" || e.key === "+") && !e.metaKey && !e.ctrlKey) setZoom(z => Math.min(2, parseFloat((z + 0.1).toFixed(1))));
      if (e.key === "-" && !e.metaKey && !e.ctrlKey) setZoom(z => Math.max(0.4, parseFloat((z - 0.1).toFixed(1))));
      if (e.key === "0" && !e.metaKey && !e.ctrlKey) setZoom(1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [total, onExit, showBgPicker]);

  const slide = slides[idx];

  return (
    <div className="fixed inset-0 z-[100] flex" style={{ background: bgColor, fontFamily: "system-ui, -apple-system, sans-serif", transition: "background 0.3s ease" }}>

      {/* ── Left filmstrip ──────────────────────────────────────────────── */}
      <div className="w-32 flex-shrink-0 overflow-y-auto py-3 px-2 space-y-2"
        style={{ background: isDark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.06)", borderRight: `1px solid ${borderColor}` }}>
        {slides.map((sl, i) => (
          <button key={i} onClick={() => setIdx(i)}
            className="w-full rounded-lg overflow-hidden relative transition-all group"
            style={{
              aspectRatio: "16/9",
              outline: i === idx ? `2px solid ${brand.primary}` : "2px solid transparent",
              outlineOffset: 2,
              opacity: i === idx ? 1 : 0.4,
            }}>
            <div className="pointer-events-none" style={{ width: "200%", height: "200%", transform: "scale(0.5)", transformOrigin: "top left" }}>
              <SlideCard slide={sl} brand={brand} deckTitle={deckTitle} />
            </div>
            <div className="absolute inset-0 transition-opacity group-hover:bg-white/5" />
            <span className="absolute bottom-1 left-1.5 text-[9px] font-bold" style={{ color: textColor, opacity: 0.5 }}>{i + 1}</span>
          </button>
        ))}
      </div>

      {/* ── Main stage ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${borderColor}` }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: brand.primary }} />
            <p className="font-semibold text-sm truncate" style={{ color: textColor }}>{deckTitle}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs hidden sm:inline" style={{ color: textColor, opacity: 0.5 }}>← → navigate · +/- zoom</span>

            {/* Background colour picker */}
            <div className="relative">
              <button
                onClick={() => setShowBgPicker(p => !p)}
                title="Change background colour"
                className="w-7 h-7 rounded-lg border-2 flex-shrink-0 transition-all hover:scale-110"
                style={{ background: bgColor, borderColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)" }} />
              {showBgPicker && (
                <div className="absolute right-0 top-10 z-50 rounded-2xl shadow-2xl p-4 w-56"
                  style={{ background: isDark ? "#1E293B" : "#fff", border: `1px solid ${borderColor}` }}
                  onClick={e => e.stopPropagation()}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: textColor, opacity: 0.6 }}>Background</p>
                  {/* Presets */}
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {BG_PRESETS.map(p => (
                      <button key={p.color} title={p.label} onClick={() => setBgColor(p.color)}
                        className="w-9 h-9 rounded-xl border-2 transition-all hover:scale-110 flex-shrink-0"
                        style={{
                          background: p.color,
                          borderColor: bgColor === p.color ? brand.primary : "transparent",
                          boxShadow: bgColor === p.color ? `0 0 0 2px ${brand.primary}30` : "none",
                        }} />
                    ))}
                  </div>
                  {/* Custom colour */}
                  <div className="flex items-center gap-2">
                    <div className="relative w-9 h-9 rounded-xl overflow-hidden border border-white/10 flex-shrink-0 cursor-pointer">
                      <input
                        type="color"
                        value={bgColor}
                        onChange={e => setBgColor(e.target.value)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        style={{ padding: 0, border: "none" }}
                      />
                      <div className="w-full h-full rounded-xl" style={{ background: bgColor }} />
                      <span className="absolute inset-0 flex items-center justify-center text-[14px]">🎨</span>
                    </div>
                    <input
                      type="text"
                      value={bgColor}
                      onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) setBgColor(e.target.value); }}
                      className="flex-1 text-xs font-mono rounded-lg px-2.5 py-1.5 border focus:outline-none focus:ring-2"
                      style={{
                        background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
                        borderColor: borderColor,
                        color: textColor,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <button onClick={onExit}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              style={{ color: textColor, border: `1px solid ${borderColor}` }}
              onMouseEnter={e => (e.currentTarget.style.background = hoverBg)}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <X size={13} /> Exit
            </button>
          </div>
        </div>

        {/* Slide canvas — click advances, close bg picker */}
        <div
          className="flex-1 flex items-center justify-center overflow-hidden cursor-pointer relative"
          style={{ padding: "32px" }}
          onClick={() => { setShowBgPicker(false); setIdx(i => Math.min(total - 1, i + 1)); }}>
          <div
            className="w-full max-w-4xl rounded-2xl overflow-hidden"
            style={{
              aspectRatio: "16/9",
              transform: `scale(${zoom})`,
              transformOrigin: "center center",
              transition: "transform 0.15s ease",
              boxShadow: isDark
                ? "0 0 0 1px rgba(255,255,255,0.06), 0 24px 80px -12px rgba(0,0,0,0.75)"
                : "0 0 0 1px rgba(0,0,0,0.1), 0 24px 80px -12px rgba(0,0,0,0.25)",
            }}>
            {slide
              ? <SlideCard slide={slide} brand={brand} deckTitle={deckTitle} />
              : <div className="w-full h-full flex items-center justify-center bg-white text-gray-300 text-sm">No slides</div>
            }
          </div>

          {/* Zoom controls — bottom-right of canvas */}
          <div
            className="absolute bottom-5 right-5 flex items-center gap-1 rounded-xl px-2 py-1.5"
            style={{ background: isDark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.8)", backdropFilter: "blur(8px)", border: `1px solid ${borderColor}` }}
            onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setZoom(z => Math.max(0.4, parseFloat((z - 0.1).toFixed(1))))}
              className="w-6 h-6 flex items-center justify-center text-lg font-light transition-opacity hover:opacity-100 opacity-60"
              style={{ color: textColor }}>−</button>
            <button
              onClick={() => setZoom(1)}
              className="text-[11px] font-mono w-10 text-center transition-opacity hover:opacity-100 opacity-60"
              style={{ color: textColor }}>{Math.round(zoom * 100)}%</button>
            <button
              onClick={() => setZoom(z => Math.min(2, parseFloat((z + 0.1).toFixed(1))))}
              className="w-6 h-6 flex items-center justify-center text-lg font-light transition-opacity hover:opacity-100 opacity-60"
              style={{ color: textColor }}>+</button>
          </div>
        </div>

        {/* Bottom nav */}
        <div
          className="flex-shrink-0 px-8 py-4 flex items-center gap-4"
          style={{ borderTop: `1px solid ${borderColor}`, background: isDark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.04)" }}
          onClick={e => { e.stopPropagation(); setShowBgPicker(false); }}>
          <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
            className="p-2 rounded-xl disabled:opacity-20 transition-all"
            style={{ color: textColor }}
            onMouseEnter={e => (e.currentTarget.style.background = hoverBg)}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            <ChevronLeft size={18} />
          </button>

          {/* Dot nav */}
          <div className="flex items-center gap-1.5 flex-1 justify-center flex-wrap">
            {slides.map((_, i) => (
              <button key={i} onClick={() => setIdx(i)}
                className="rounded-full transition-all flex-shrink-0"
                style={{ width: i === idx ? 24 : 8, height: 8, background: i === idx ? brand.primary : isDark ? "#334155" : "#CBD5E1" }} />
            ))}
          </div>

          <span className="text-xs font-mono w-12 text-center" style={{ color: textColor, opacity: 0.5 }}>{idx + 1}/{total}</span>

          <button onClick={() => setIdx(i => Math.min(total - 1, i + 1))} disabled={idx === total - 1}
            className="p-2 rounded-xl disabled:opacity-20 transition-all"
            style={{ color: textColor }}
            onMouseEnter={e => (e.currentTarget.style.background = hoverBg)}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Preview modal ────────────────────────────────────────────────────────────

// A previously-saved expiry might not line up with one of the quick preset
// buttons (7d/30d) — e.g. it was set 5 days ago as "7 days" and is now 2 days
// out. Rather than guess which preset it "was", show it as a custom date set
// to the real saved value — accurate beats tidy here.
function deriveExpiryState(expiresAt: string | null): { preset: "never" | "7d" | "30d" | "custom"; custom: string } {
  if (!expiresAt) return { preset: "never", custom: "" };
  return { preset: "custom", custom: new Date(expiresAt).toISOString().slice(0, 10) };
}

function PreviewModal({
  deck: initialDeck,
  templateName,
  templateId,
  period,
  orgId,
  theme,
  brand,
  tokensUsed,
  slackWebhook,
  initialReviewId,
  initialShareUrl,
  initialAccess,
  onClose,
  onBuilt,
}: {
  deck: SlidesDeck;
  templateName: string;
  templateId: string;
  period: string;
  orgId: string;
  theme: DesignTheme;
  brand: { primary: string; secondary: string; logoUrl?: string | null };
  tokensUsed: number;
  slackWebhook?: string;
  // Present when reopening an already-shared deck (e.g. from History) so the
  // access-control card reflects the link's real, currently-saved settings
  // instead of resetting to "never expires / not private" every time.
  initialReviewId?: string | null;
  initialShareUrl?: string | null;
  initialAccess?: { isPrivate: boolean; expiresAt: string | null } | null;
  onClose: () => void;
  onBuilt: () => void;
}) {
  const [deck, setDeck] = useState<SlidesDeck>(initialDeck);
  const [idx, setIdx] = useState(0);
  const [view, setView] = useState<"summary" | "slides">("summary");
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<{ fileUrl: string | null; error: string | null } | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [slacking, setSlacking] = useState(false);
  const [slackSent, setSlackSent] = useState(false);
  const [slackError, setSlackError] = useState<string | null>(null);
  const [slackMessage, setSlackMessage] = useState("");
  // Access control for share link — hydrated from the saved row when reopening
  const initialExpiry = deriveExpiryState(initialAccess?.expiresAt ?? null);
  const [reviewExpiry, setReviewExpiry] = useState<"never" | "7d" | "30d" | "custom">(initialExpiry.preset);
  const [reviewExpiryCustom, setReviewExpiryCustom] = useState(initialExpiry.custom);  // ISO date string
  const [reviewPrivate, setReviewPrivate] = useState(initialAccess?.isPrivate ?? false);
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessSaved, setAccessSaved] = useState(false);
  // Email invites
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviteExpiry, setInviteExpiry] = useState<"never" | "7d" | "30d" | "custom">("never");
  const [inviteExpiryCustom, setInviteExpiryCustom] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ sent: number; failed: string[] } | null>(null);
  const [noEmailProvider, setNoEmailProvider] = useState(false);
  const slideCanvasRef = useRef<HTMLDivElement>(null);
  // Always-mounted, off-screen render target for PDF export. The visible
  // slideCanvasRef div only exists in "Slides" view — but "Summary" view
  // (the default view when a deck opens) has its own "Export PDF" button
  // that reads slideCanvasRef too. Since that ref is null whenever Summary
  // is showing, handleExportPDF's `if (!ref.current) return;` guard quietly
  // no-opped on every click — no spinner, no error, dead button. This ref
  // is rendered unconditionally regardless of which view tab is active, so
  // export works the same from either button.
  const exportCanvasRef = useRef<HTMLDivElement>(null);
  const [rightPanel, setRightPanel] = useState<"none" | "add" | "edit" | "comments">("none");
  const [presenting, setPresenting] = useState(false);
  // Share / review
  const [shareUrl, setShareUrl] = useState<string | null>(initialShareUrl ?? null);
  const [sharing, setSharing] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [updatingShare, setUpdatingShare] = useState(false);
  const [shareUpdated, setShareUpdated] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(initialReviewId ?? null);
  const [comments, setComments] = useState<SlideComment[]>([]);
  const [replanningSlide, setReplanningSlide] = useState(false);
  // Freeform "ask AI to change this slide" box in the Edit panel — e.g. typing
  // "use a chart here instead of a card" and having the AI actually swap the
  // slide type, which the manual field-by-field SlideEditor below can't do
  // (it only edits values within whatever type the slide already is). This
  // reuses the exact same replanSlide action that "Replan this slide" (under
  // reviewer comments) already calls — same capability, just reachable
  // directly from the editor instead of needing a published review link
  // and a reviewer comment first.
  const [aiEditText, setAiEditText] = useState("");
  // Reference image attached to the current slide (e.g. a Mixpanel trend
  // screenshot) — purely a visual attachment, the AI never sees or analyzes
  // its content, same as the company logo being embedded.
  const [slideImageUploading, setSlideImageUploading] = useState(false);
  const [slideImageError, setSlideImageError] = useState<string | null>(null);

  const slides = deck?.slides ?? [];
  const total = slides.length;
  const slide = slides[idx];

  // keyboard nav (only when not in a text field)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "TEXTAREA" || (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "ArrowRight") setIdx(i => Math.min(total - 1, i + 1));
      if (e.key === "ArrowLeft") setIdx(i => Math.max(0, i - 1));
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [total, onClose]);

  const updateSlide = (updated: SlideContent) => {
    setDeck(d => ({ ...d, slides: d.slides.map((s, i) => i === idx ? updated : s) }));
  };

  const addSlide = (type: SlideContent["type"]) => {
    const insertAt = idx + 1;
    const newSlides = [...slides.slice(0, insertAt), blankSlide(type), ...slides.slice(insertAt)];
    setDeck(d => ({ ...d, slides: newSlides }));
    setIdx(insertAt);
    setRightPanel("edit");
  };

  const removeSlide = () => {
    if (total <= 1) return;
    const newSlides = slides.filter((_, i) => i !== idx);
    setDeck(d => ({ ...d, slides: newSlides }));
    setIdx(Math.min(idx, newSlides.length - 1));
  };

  // ── Drag-to-reorder ────────────────────────────────────────────────────────
  // Comments are stored against a plain slide_index, not a stable per-slide
  // id, so moving a slide has to carry its comments (and the currently
  // selected slide) along with it — otherwise feedback collected before the
  // reorder would silently end up pinned to whatever slide now sits at that
  // old number instead of the slide it was actually left on.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const moveSlide = (from: number, to: number) => {
    if (from === to) return;
    const newSlides = [...slides];
    const [moved] = newSlides.splice(from, 1);
    newSlides.splice(to, 0, moved);
    setDeck(d => ({ ...d, slides: newSlides }));

    const oldToNew: Record<number, number> = {};
    slides.forEach((_, oldI) => {
      let newI = oldI;
      if (oldI === from) newI = to;
      else if (from < to && oldI > from && oldI <= to) newI = oldI - 1;
      else if (from > to && oldI >= to && oldI < from) newI = oldI + 1;
      oldToNew[oldI] = newI;
    });

    setIdx(prev => oldToNew[prev] ?? prev);
    setComments(prev => prev.map(c => ({ ...c, slide_index: oldToNew[c.slide_index] ?? c.slide_index })));
    if (reviewId) remapCommentSlideIndexes(reviewId, oldToNew).catch(() => {});
  };

  const handleBuild = async () => {
    setBuilding(true);
    const res = await buildReportFromPlan(orgId, templateId, templateName, period, deck, theme, tokensUsed);
    setResult({ fileUrl: res.fileUrl, error: res.error });
    setBuilding(false);
    if (!res.error) onBuilt(); // refreshes history tab in background but keeps modal open
  };

  const handleSendSlack = async () => {
    if (!slackWebhook) return;
    setSlacking(true);
    setSlackError(null);
    try {
      // Ensure a review session exists so recipients can view + comment
      let reviewLink = shareUrl;
      if (!reviewLink) {
        const res = await createReviewSession(orgId, deck, period);
        if (res.token && !res.error) {
          reviewLink = `${window.location.origin}/review/${res.token}`;
          setShareUrl(reviewLink);
          setReviewId(res.reviewId ?? null);
        }
      }
      const { sendSlackNotification } = await import("@/app/actions/reports");
      const { error } = await sendSlackNotification(
        slackWebhook,
        deck.title,
        period,
        deck.slides.length,
        result?.fileUrl ?? null,
        slackMessage || undefined,
        reviewLink ?? undefined,
        deck.slides,           // for summary generation
      );
      if (error) setSlackError(error);
      else setSlackSent(true);
    } finally {
      setSlacking(false);
    }
  };

  const handleExportPDF = async () => {
    if (!exportCanvasRef.current) return;
    setPdfExporting(true);
    const savedIdx = idx;
    try {
      const loadScript = (src: string) => new Promise<void>((res, rej) => {
        if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
        const s = document.createElement("script");
        s.src = src; s.onload = () => res(); s.onerror = rej;
        document.head.appendChild(s);
      });
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jsPDF = (window as any).jspdf.jsPDF;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const html2canvas = (window as any).html2canvas;

      const el = exportCanvasRef.current;
      // Standard 16:9 presentation dimensions in points (960 × 540 pt = 13.33 × 7.5 in)
      const PAGE_W = 960;
      const PAGE_H = 540;
      const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: [PAGE_W, PAGE_H], compress: true });

      for (let i = 0; i < slides.length; i++) {
        setIdx(i);
        // Wait for React render + fonts + any CSS transitions to settle
        await new Promise(r => setTimeout(r, 400));

        const canvas = await html2canvas(el, {
          scale: 3,                        // 3× DPI → ~150dpi at 960pt — noticeably sharper
          useCORS: true,
          allowTaint: true,
          logging: false,
          width: el.offsetWidth,
          height: el.offsetHeight,
          // Tell html2canvas the real viewport so clamp()/vw/vh units compute correctly
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight,
          backgroundColor: "#ffffff",      // guarantee white background, never transparent
          scrollX: 0,
          scrollY: 0,
          // Strip visual chrome (border-radius, shadow, border) from the captured element
          // so edges render cleanly without anti-aliased corner bleed
          onclone: (_doc: Document, clonedEl: HTMLElement) => {
            clonedEl.style.borderRadius = "0";
            clonedEl.style.boxShadow = "none";
            clonedEl.style.border = "none";
          },
        });

        if (i > 0) pdf.addPage([PAGE_W, PAGE_H], "landscape");
        // PNG is lossless — critical for sharp text (JPEG creates ringing around text edges)
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, PAGE_W, PAGE_H);
      }

      setIdx(savedIdx);
      const safeName = `${deck.title} — ${period}`.replace(/[/\\?%*:|"<>]/g, "-");
      pdf.save(`${safeName}.pdf`);
    } catch (e) {
      console.error("[exportPDF]", e);
      alert("PDF export failed — check console.");
    } finally {
      setPdfExporting(false);
    }
  };

  const handleShare = async () => {
    setSharing(true);
    setShareError(null);
    const res = await createReviewSession(orgId, deck, period);
    setSharing(false);
    if (res.error || !res.token || !res.reviewId) {
      setShareError(res.error ?? "Failed to create share link. Make sure migration 007_review_sessions.sql has been run.");
      return;
    }
    const url = `${window.location.origin}/review/${res.token}`;
    setShareUrl(url);
    setReviewId(res.reviewId);
    await navigator.clipboard.writeText(url).catch(() => {});
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 3000);
  };

  // Pushes whatever edits have happened since the link was created onto the
  // SAME share_token, instead of leaving reviewers stuck looking at a stale
  // snapshot with no way to refresh it short of deleting the review.
  const handleUpdateShare = async () => {
    if (!reviewId) return;
    setUpdatingShare(true);
    const res = await updateReviewDeck(reviewId, deck, period);
    setUpdatingShare(false);
    if (!res.error) {
      setShareUpdated(true);
      setTimeout(() => setShareUpdated(false), 2500);
    }
  };

  // Compute expires_at ISO string from expiry selection
  const computeExpiresAt = () => {
    if (reviewExpiry === "never") return null;
    if (reviewExpiry === "7d") return new Date(Date.now() + 7 * 864e5).toISOString();
    if (reviewExpiry === "30d") return new Date(Date.now() + 30 * 864e5).toISOString();
    if (reviewExpiry === "custom" && reviewExpiryCustom) return new Date(reviewExpiryCustom).toISOString();
    return null;
  };

  const handleSaveAccess = async () => {
    if (!reviewId) return;
    setAccessSaving(true);
    setAccessSaved(false);
    await updateReviewAccess(reviewId, { expiresAt: computeExpiresAt(), isPrivate: reviewPrivate });
    setAccessSaving(false);
    setAccessSaved(true);
    setTimeout(() => setAccessSaved(false), 2500);
  };

  const computeInviteExpiry = () => {
    if (inviteExpiry === "never") return null;
    if (inviteExpiry === "7d") return new Date(Date.now() + 7 * 864e5).toISOString();
    if (inviteExpiry === "30d") return new Date(Date.now() + 30 * 864e5).toISOString();
    if (inviteExpiry === "custom" && inviteExpiryCustom) return new Date(inviteExpiryCustom).toISOString();
    return null;
  };

  const handleSendInvites = async () => {
    if (!reviewId || !shareUrl || !inviteEmails.trim()) return;
    setInviteSending(true);
    setInviteResult(null);
    setNoEmailProvider(false);
    const emails = inviteEmails.split(",").map(e => e.trim()).filter(Boolean);
    const { sendEmailInvites } = await import("@/app/actions/review");
    const res = await sendEmailInvites(reviewId, shareUrl, deck.title, period, emails, computeInviteExpiry());
    setInviteSending(false);
    // Check if no email provider (all marked sent but RESEND_API_KEY not set)
    if (!process.env.NEXT_PUBLIC_HAS_RESEND && res.sent === emails.length && res.failed.length === 0) {
      setNoEmailProvider(true);
    }
    setInviteResult({ sent: res.sent, failed: res.failed });
    if (res.sent > 0) setInviteEmails("");
  };

  const refreshComments = async () => {
    if (!reviewId) return;
    const fresh = await getReviewComments(reviewId);
    setComments(fresh);
  };

  const handleReplanSlide = async (comment: string) => {
    if (!slide) return;
    setReplanningSlide(true);
    const res = await replanSlide(slide, comment, `${deck.title} — ${period}`);
    setReplanningSlide(false);
    if (res.slide) {
      updateSlide(res.slide);
      setAiEditText("");
    }
  };

  const handleSlideImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !slide) return;
    setSlideImageUploading(true);
    setSlideImageError(null);
    const formData = new FormData();
    formData.append("file", file);
    const res = await uploadSlideImage(orgId, formData);
    setSlideImageUploading(false);
    if (res.error) {
      setSlideImageError(res.error);
    } else if (res.url) {
      // Seed an explicit default position/size on upload (top-right-ish,
      // roughly a quarter of the slide) so the positioner and preview agree
      // from the first frame, rather than relying on each renderer's own
      // fallback default.
      updateSlide({ ...slide, image_url: res.url, image_x: 70, image_y: 6, image_w: 26, image_h: 20 } as SlideContent);
    }
  };

  const handleRemoveSlideImage = () => {
    if (!slide) return;
    const { image_url, image_x, image_y, image_w, image_h, ...rest } = slide as SlideContent & {
      image_url?: string; image_x?: number; image_y?: number; image_w?: number; image_h?: number;
    };
    void image_url; void image_x; void image_y; void image_w; void image_h;
    updateSlide(rest as SlideContent);
  };

  const handleSlideImagePosition = (pos: { x: number; y: number; w: number; h: number }) => {
    if (!slide) return;
    updateSlide({ ...slide, image_x: pos.x, image_y: pos.y, image_w: pos.w, image_h: pos.h } as SlideContent);
  };

  const handleResetSlideImagePosition = () => {
    if (!slide) return;
    updateSlide({ ...slide, image_x: 70, image_y: 6, image_w: 26, image_h: 20 } as SlideContent);
  };

  const handleSlideImageLayout = (layout: "corner" | "overlay" | "right-panel" | "left-panel" | "bottom") => {
    if (!slide) return;
    const base = { ...slide } as Record<string, unknown>;
    if (layout === "corner") {
      // Thumbnail mode — remove position and layout fields
      delete base.image_x; delete base.image_y; delete base.image_w; delete base.image_h; delete base.image_layout;
    } else if (layout === "overlay") {
      // Free-position overlay — ensure position defaults exist
      base.image_layout = "overlay";
      if (base.image_x == null) { base.image_x = 70; base.image_y = 6; base.image_w = 26; base.image_h = 20; }
    } else {
      // Panel layout — remove position data (not needed), set layout
      delete base.image_x; delete base.image_y; delete base.image_w; delete base.image_h;
      base.image_layout = layout;
    }
    updateSlide(base as SlideContent);
  };

  if (presenting) {
    return <PresentMode slides={slides} brand={brand} deckTitle={deck.title} startIdx={idx} onExit={() => setPresenting(false)} />;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      {/* Off-screen, always-mounted — see exportCanvasRef comment above */}
      <div ref={exportCanvasRef} style={{ position: "fixed", top: 0, left: -9999, width: 960, height: 540, pointerEvents: "none" }}>
        {slide ? <SlideCard slide={slide} brand={brand} deckTitle={deck?.title ?? ""} /> : null}
      </div>
      <div className="bg-white rounded-2xl shadow-2xl flex overflow-hidden" style={{ width: "min(96vw, 1520px)", height: "min(94vh, 860px)" }}>

        {/* ── Left: filmstrip ───────────────────────────────────────────── */}
        <div className="w-44 flex-shrink-0 bg-gray-950 flex flex-col overflow-hidden">
          <div className="px-3 pt-4 pb-2 flex-shrink-0">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest">Slides ({total})</p>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
            {slides.map((sl, i) => {
              const cnt = comments.filter(c => c.slide_index === i && !c.resolved).length;
              const isDragOverTarget = dragOverIdx === i && dragIdx !== null && dragIdx !== i;
              return (
                <button key={i} onClick={() => { setIdx(i); }}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => { e.preventDefault(); if (dragOverIdx !== i) setDragOverIdx(i); }}
                  onDragLeave={() => setDragOverIdx(prev => (prev === i ? null : prev))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIdx !== null && dragIdx !== i) moveSlide(dragIdx, i);
                    setDragIdx(null);
                    setDragOverIdx(null);
                  }}
                  onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                  title="Drag to reorder"
                  className={`w-full rounded-lg overflow-hidden border-2 transition-all text-left relative cursor-grab active:cursor-grabbing ${
                    isDragOverTarget ? "border-amber-400" : i === idx ? "border-indigo-500 shadow-lg shadow-indigo-500/20" : "border-transparent opacity-50 hover:opacity-80"
                  }`}
                  style={{ aspectRatio: "16/9", position: "relative", opacity: dragIdx === i ? 0.35 : undefined }}>
                  {/* absolute wrapper prevents the 200% child from inflating button height */}
                  <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
                    <div className="pointer-events-none" style={{ width: "200%", height: "200%", transform: "scale(0.5)", transformOrigin: "top left" }}>
                      <SlideCard slide={sl} brand={brand} deckTitle={deck.title} />
                    </div>
                  </div>
                  <span className="absolute top-1 left-1 w-4 h-4 bg-black/50 rounded text-white text-[9px] font-bold flex items-center justify-center pointer-events-none">{i + 1}</span>
                  {cnt > 0 && (
                    <span className="absolute top-1 right-1 w-4 h-4 bg-amber-500 rounded-full text-white text-[9px] font-bold flex items-center justify-center">{cnt}</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="p-2 border-t border-gray-800 flex-shrink-0 space-y-1.5">
            <button onClick={() => setRightPanel(p => p === "edit" ? "none" : "edit")}
              className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${rightPanel === "edit" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
              <Edit3 size={12} /> Edit Slide
            </button>
            <button onClick={() => setRightPanel(p => p === "add" ? "none" : "add")}
              className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${rightPanel === "add" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
              <Plus size={12} /> Add Slide
            </button>
            {reviewId && (
              <button onClick={() => { setRightPanel(p => p === "comments" ? "none" : "comments"); refreshComments(); }}
                className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors relative ${rightPanel === "comments" ? "bg-amber-500 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
                <MessageSquare size={12} /> Feedback
                {comments.filter(c => !c.resolved).length > 0 && (
                  <span className="absolute top-1 right-2 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {comments.filter(c => !c.resolved).length}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* ── Centre: summary or canvas ───────────────────────────────────── */}
        <div className="flex-1 flex flex-col bg-gray-100 min-w-0">
          {/* Top bar */}
          <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-gray-200 flex-shrink-0">
            <div className="min-w-0 flex items-center gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 text-sm truncate">{deck.title}</p>
                <p className="text-xs text-gray-400">{templateName} · {period} · {total} slides</p>
              </div>
              {/* View toggle */}
              <div className="flex bg-gray-100 rounded-lg p-0.5 flex-shrink-0">
                <button onClick={() => setView("summary")}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${view === "summary" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
                  Overview
                </button>
                <button onClick={() => setView("slides")}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${view === "slides" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
                  Slides
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {tokensUsed > 0 && (
                <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">
                  <Coins size={11} /> {tokensUsed.toLocaleString()} tokens
                </span>
              )}
              {/* Share for review */}
              {shareUrl ? (
                <>
                  <button onClick={() => { navigator.clipboard.writeText(shareUrl); setShareCopied(true); setTimeout(() => setShareCopied(false), 2000); }}
                    className="flex items-center gap-1.5 text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-lg transition-colors">
                    {shareCopied ? <><CheckCircle2 size={12} /> Copied!</> : <><ExternalLink size={12} /> Copy link</>}
                  </button>
                  {/* The link above is a snapshot taken when it was first
                      created — edits since then don't appear there until
                      this is clicked. Same link, refreshed content. */}
                  <button onClick={handleUpdateShare} disabled={updatingShare}
                    title="Push your latest edits to this same share link"
                    className="flex items-center gap-1.5 text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                    {updatingShare ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {updatingShare ? "Updating…" : shareUpdated ? "Updated!" : "Update link"}
                  </button>
                </>
              ) : (
                <button onClick={handleShare} disabled={sharing}
                  className="flex items-center gap-1.5 text-xs font-medium bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  {sharing ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />}
                  {sharing ? "Creating…" : "Share for review"}
                </button>
              )}
              {shareError && (
                <span className="text-xs text-red-500 max-w-[200px] truncate" title={shareError}>❌ {shareError}</span>
              )}
              {reviewId && (
                <button onClick={() => { setRightPanel(p => p === "comments" ? "none" : "comments"); refreshComments(); }}
                  className={`relative flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${rightPanel === "comments" ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                  <MessageSquare size={12} />
                  Feedback
                  {comments.filter(c => !c.resolved).length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                      {comments.filter(c => !c.resolved).length}
                    </span>
                  )}
                </button>
              )}
              <button onClick={() => setPresenting(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors">
                <Eye size={12} /> Present
              </button>
              <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                <X size={17} />
              </button>
            </div>
          </div>

          {view === "summary" ? (
            <>
              {/* ── Summary view ─────────────────────────────────────────── */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-2xl mx-auto space-y-5">
                  {/* Deck header card */}
                  <div className="bg-white rounded-2xl border border-gray-100 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-lg font-bold text-gray-900">{deck.title}</h2>
                        <p className="text-sm text-gray-500 mt-0.5">{templateName} · {period}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-2xl font-bold text-gray-900">{total}</span>
                        <span className="text-xs text-gray-400">slides</span>
                      </div>
                    </div>
                    {result?.fileUrl && (
                      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
                        <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                        <span className="text-xs text-green-600 font-medium">PPTX ready to download</span>
                      </div>
                    )}
                  </div>

                  {/* Slide overview */}
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Slide overview</p>
                    <div className="space-y-1.5">
                      {slides.map((sl, i) => {
                        const typeEmoji: Record<string, string> = {
                          title: "🎯", big_stat: "📊", bar_chart: "📊", line_chart: "📈",
                          pie_chart: "🥧", bullet_list: "📋", image: "🖼️", closing: "🏁",
                          action_plan: "🧭",
                        };
                        const title = (sl as { title?: string; headline?: string; label?: string }).title
                          ?? (sl as { headline?: string }).headline
                          ?? (sl as { label?: string }).label
                          ?? sl.type.replace(/_/g, " ");
                        return (
                          <button key={i}
                            onClick={() => { setIdx(i); setView("slides"); }}
                            className="w-full flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50 cursor-pointer transition-colors text-left">
                            <span className="text-base flex-shrink-0">{typeEmoji[sl.type] ?? "📄"}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-gray-400 capitalize">{sl.type.replace(/_/g, " ")}</p>
                              <p className="text-sm font-medium text-gray-800 truncate">{title}</p>
                            </div>
                            <span className="text-xs text-gray-300 flex-shrink-0 font-mono">#{i + 1}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Share link access control — shown once a review session exists */}
                  {reviewId && (() => {
                    // Plain-English summary of what's selected right now — including
                    // changes not yet saved, so the user can see what they're about
                    // to set before committing, not just what's already live.
                    const expiryLabel =
                      reviewExpiry === "never" ? "no expiry date" :
                      reviewExpiry === "7d" ? "in 7 days" :
                      reviewExpiry === "30d" ? "in 30 days" :
                      reviewExpiryCustom ? `on ${new Date(reviewExpiryCustom).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}` :
                      "no expiry date set yet";
                    const summary = reviewPrivate
                      ? "Private — nobody can open this link until you turn this off."
                      : `Anyone with the link can view it, ${expiryLabel}.`;
                    return (
                    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">Link access</p>
                          <p className="text-xs text-gray-400 mt-0.5">Control who can view this report, and for how long</p>
                        </div>
                        {/* Private toggle */}
                        <button
                          onClick={() => { setReviewPrivate(v => !v); }}
                          title={reviewPrivate ? "Private — click to make viewable again" : "Viewable — click to make private"}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${reviewPrivate ? "bg-red-500" : "bg-green-400"}`}>
                          <span className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
                            style={{ transform: reviewPrivate ? "translateX(18px)" : "translateX(2px)" }} />
                        </button>
                      </div>

                      {/* Current-state summary, plain English */}
                      <p className={`text-xs rounded-lg px-3 py-2 ${reviewPrivate ? "text-red-600 bg-red-50" : "text-gray-600 bg-gray-50"}`}>
                        {summary}
                      </p>

                      {/* Expiry */}
                      <div className={reviewPrivate ? "opacity-40 pointer-events-none" : ""}>
                        <p className="text-xs font-medium text-gray-600 mb-2">Link expiry</p>
                        <div className="flex gap-2 flex-wrap">
                          {(["never", "7d", "30d", "custom"] as const).map(opt => (
                            <button key={opt}
                              onClick={() => setReviewExpiry(opt)}
                              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${reviewExpiry === opt ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-200 text-gray-600 hover:border-indigo-300"}`}>
                              {opt === "never" ? "Open forever" : opt === "7d" ? "7 days" : opt === "30d" ? "30 days" : "Custom date"}
                            </button>
                          ))}
                        </div>
                        {reviewExpiry === "custom" && (
                          <input type="date" value={reviewExpiryCustom} onChange={e => setReviewExpiryCustom(e.target.value)}
                            min={new Date().toISOString().slice(0, 10)}
                            className="mt-2 text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                        )}
                      </div>

                      <button onClick={handleSaveAccess} disabled={accessSaving}
                        className={`w-full flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg disabled:opacity-50 transition-colors ${
                          accessSaved ? "bg-green-600 text-white" : "bg-gray-900 hover:bg-gray-800 text-white"
                        }`}>
                        {accessSaving
                          ? <><Loader2 size={11} className="animate-spin" /> Saving…</>
                          : accessSaved
                            ? <><CheckCircle2 size={12} /> Saved — link updated</>
                            : "Save access settings"}
                      </button>
                    </div>
                    );
                  })()}

                  {/* Email invite card — shown once review session exists */}
                  {reviewId && shareUrl && (
                    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Invite by email</p>
                        <p className="text-xs text-gray-400 mt-0.5">Recipients get a link to view slides and leave comments.</p>
                      </div>
                      <textarea
                        value={inviteEmails}
                        onChange={e => setInviteEmails(e.target.value)}
                        placeholder="alice@company.com, bob@company.com"
                        rows={2}
                        className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                      />
                      {/* Invite expiry */}
                      <div>
                        <p className="text-xs font-medium text-gray-600 mb-2">Access expires</p>
                        <div className="flex gap-2 flex-wrap">
                          {(["never", "7d", "30d", "custom"] as const).map(opt => (
                            <button key={opt} onClick={() => setInviteExpiry(opt)}
                              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${inviteExpiry === opt ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-200 text-gray-600 hover:border-indigo-300"}`}>
                              {opt === "never" ? "Open forever" : opt === "7d" ? "7 days" : opt === "30d" ? "30 days" : "Custom date"}
                            </button>
                          ))}
                        </div>
                        {inviteExpiry === "custom" && (
                          <input type="date" value={inviteExpiryCustom} onChange={e => setInviteExpiryCustom(e.target.value)}
                            min={new Date().toISOString().slice(0, 10)}
                            className="mt-2 text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                        )}
                      </div>
                      <button onClick={handleSendInvites} disabled={inviteSending || !inviteEmails.trim()}
                        className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2.5 rounded-xl disabled:opacity-50 transition-colors">
                        {inviteSending ? <><Loader2 size={11} className="animate-spin" /> Sending…</> : "Send invites"}
                      </button>
                      {inviteResult && (
                        <div className="space-y-1">
                          {inviteResult.sent > 0 && !noEmailProvider && (
                            <p className="text-xs text-green-600">✅ Sent to {inviteResult.sent} {inviteResult.sent === 1 ? "person" : "people"}</p>
                          )}
                          {noEmailProvider && (
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                              <p className="text-xs font-semibold text-amber-800">No email provider configured</p>
                              <p className="text-xs text-amber-700">Add <code className="bg-amber-100 px-1 rounded">RESEND_API_KEY</code> to your .env to send real emails. For now, copy the link and share manually:</p>
                              <div className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2">
                                <span className="text-xs text-gray-600 truncate flex-1">{shareUrl}</span>
                                <button onClick={() => navigator.clipboard.writeText(shareUrl ?? "")}
                                  className="text-xs font-medium text-indigo-600 flex-shrink-0">Copy</button>
                              </div>
                            </div>
                          )}
                          {inviteResult.failed.length > 0 && (
                            <p className="text-xs text-red-500">❌ Failed: {inviteResult.failed.join(", ")}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Slack message (only when webhook is configured) */}
                  {slackWebhook && (
                    <div>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                        Slack message <span className="normal-case font-normal text-gray-300">(optional)</span>
                      </p>
                      <textarea
                        value={slackMessage}
                        onChange={e => setSlackMessage(e.target.value)}
                        placeholder="Add a personal note to share alongside this report…"
                        rows={2}
                        className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Summary bottom bar */}
              <div className="flex-shrink-0 bg-white border-t border-gray-200 px-5 py-3 flex items-center gap-3 justify-end">
                <button onClick={handleExportPDF} disabled={pdfExporting}
                  className="flex items-center gap-1.5 text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 px-3 py-2 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap">
                  {pdfExporting ? <><Loader2 size={12} className="animate-spin" /> Exporting…</> : <><Download size={12} /> Export PDF</>}
                </button>
                {result ? (
                  result.error
                    ? <p className="text-xs text-red-600 max-w-xs truncate">❌ {result.error}</p>
                    : result.fileUrl
                      ? <>
                          <a href={result.fileUrl} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1.5 text-xs font-semibold bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors">
                            <Download size={13} /> Download PPTX
                          </a>
                          {slackSent
                            ? <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600">✅ Sent to Slack</span>
                            : slackWebhook
                              ? <button onClick={handleSendSlack} disabled={slacking}
                                  className="flex items-center gap-1.5 text-xs font-semibold bg-[#4A154B] text-white px-4 py-2 rounded-lg hover:bg-[#611f64] disabled:opacity-50 transition-colors">
                                  {slacking
                                    ? <><Loader2 size={12} className="animate-spin" /> Sending…</>
                                    : <>
                                        <svg viewBox="0 0 24 24" width={13} height={13} fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zm2.521-10.123a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>
                                        Send to Slack
                                      </>
                                  }
                                </button>
                              : <span className="text-xs text-gray-400 border border-dashed border-gray-300 px-3 py-1.5 rounded-lg">
                                  Add Slack webhook in Settings → Brand
                                </span>
                          }
                          {slackError && <p className="text-xs text-red-500 max-w-xs truncate">{slackError}</p>}
                        </>
                      : <p className="text-xs text-green-600 font-semibold">✅ Built!</p>
                ) : (
                  <button onClick={handleBuild} disabled={building}
                    className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-50 transition-colors whitespace-nowrap">
                    {building ? <><Loader2 size={13} className="animate-spin" /> Building…</> : <><Zap size={13} /> Build PPTX</>}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              {/* ── Slides view ──────────────────────────────────────────── */}
              <div className="flex-1 flex items-center justify-center p-6 overflow-hidden">
                <div ref={slideCanvasRef} className="w-full max-w-3xl rounded-xl overflow-hidden shadow-2xl border border-gray-200" style={{ aspectRatio: "16/9" }}>
                  {slide
                    ? <SlideCard slide={slide} brand={brand} deckTitle={deck?.title ?? ""} />
                    : <div className="w-full h-full flex items-center justify-center bg-white text-gray-300 text-sm">No slides</div>
                  }
                </div>
              </div>

              {/* Slides bottom bar */}
              <div className="flex-shrink-0 bg-white border-t border-gray-200 px-5 py-3 flex items-center gap-3">
                <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-30 transition-colors">
                  <ChevronLeft size={18} />
                </button>
                <p className="text-xs text-gray-400 font-medium w-16 text-center">{idx + 1} / {total}</p>
                <button onClick={() => setIdx(i => Math.min(total - 1, i + 1))} disabled={idx === total - 1}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-30 transition-colors">
                  <ChevronRight size={18} />
                </button>
                <div className="flex-1 flex items-center justify-center gap-1 overflow-hidden">
                  {slides.slice(0, 24).map((_, i) => (
                    <button key={i} onClick={() => setIdx(i)} className="rounded-full transition-all flex-shrink-0"
                      style={{ width: i === idx ? 20 : 6, height: 6, background: i === idx ? brand.primary : "#D1D5DB" }} />
                  ))}
                </div>
                <button onClick={removeSlide} disabled={total <= 1} title="Remove this slide"
                  className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-20 transition-colors">
                  <Trash2 size={14} />
                </button>
                <button onClick={handleExportPDF} disabled={pdfExporting}
                  className="flex items-center gap-1.5 text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 px-3 py-2 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap">
                  {pdfExporting ? <><Loader2 size={12} className="animate-spin" /> Exporting…</> : <><Download size={12} /> PDF</>}
                </button>
                {result ? (
                  result.error
                    ? <p className="text-xs text-red-600 max-w-xs truncate">❌ {result.error}</p>
                    : result.fileUrl
                      ? <>
                          <a href={result.fileUrl} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1.5 text-xs font-semibold bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors">
                            <Download size={13} /> Download PPTX
                          </a>
                          <button onClick={() => setView("summary")}
                            className="flex items-center gap-1.5 text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 px-3 py-2 rounded-lg transition-colors">
                            Overview →
                          </button>
                        </>
                      : <p className="text-xs text-green-600 font-semibold">✅ Built!</p>
                ) : (
                  <button onClick={handleBuild} disabled={building}
                    className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-50 transition-colors whitespace-nowrap">
                    {building ? <><Loader2 size={13} className="animate-spin" /> Building…</> : <><Zap size={13} /> Build PPTX</>}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Right: edit / add / comments panel ────────────────────────── */}
        {rightPanel !== "none" && (
          <div className="w-96 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
            {rightPanel === "edit" && slide ? (
              <>
                <div className="px-4 pt-4 pb-3 border-b border-gray-100 flex-shrink-0">
                  <p className="text-xs font-semibold text-gray-800">Edit Slide {idx + 1}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Click <span className="font-medium text-indigo-500">Change type</span> in the editor below to switch layouts.
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div className="border border-indigo-100 bg-indigo-50/60 rounded-xl p-3">
                    <p className="text-xs font-semibold text-indigo-800 flex items-center gap-1.5">
                      <Sparkles size={12} /> Ask AI to change this slide
                    </p>
                    <p className="text-[11px] text-indigo-400 mt-0.5 mb-2">
                      e.g. &quot;use a chart here instead of a card&quot; — it can swap the slide type, not just edit text.
                    </p>
                    <textarea
                      value={aiEditText}
                      onChange={e => setAiEditText(e.target.value)}
                      placeholder="Type what you want changed…"
                      rows={3}
                      className="w-full border border-indigo-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white resize-y"
                    />
                    <button
                      onClick={() => handleReplanSlide(aiEditText)}
                      disabled={replanningSlide || !aiEditText.trim()}
                      className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                      {replanningSlide ? <><Loader2 size={11} className="animate-spin" /> Applying…</> : <><RotateCcw size={11} /> Apply</>}
                    </button>
                  </div>
                  <SlideEditor key={`slide-editor-${idx}`} slide={slide} onChange={updateSlide} />

                  {/* Reference image — e.g. a Mixpanel trend screenshot.
                      Purely a visual attachment embedded into the slide
                      (same as the company logo); the AI does not see or
                      analyze its content. */}
                  <div className="border border-gray-200 rounded-xl p-3">
                    <p className="text-xs font-semibold text-gray-700 mb-1">Reference image</p>
                    <p className="text-[11px] text-gray-400 mb-2">
                      Attach a screenshot (e.g. a Mixpanel chart) as a visual on this slide. Not analyzed by AI — just embedded.
                    </p>
                    {(slide as { image_url?: string }).image_url ? (
                      slide.type === "title" || slide.type === "closing" ? (
                        // Title/closing slides use the image as a full-bleed
                        // cover panel already — no positioning to offer there.
                        <div className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={(slide as { image_url?: string }).image_url} alt="" className="w-full h-24 object-cover rounded-lg border border-gray-200" />
                          <button onClick={handleRemoveSlideImage}
                            title="Remove image"
                            className="absolute top-1.5 right-1.5 p-1 rounded-full bg-white/90 text-gray-500 hover:text-red-500 hover:bg-white shadow-sm transition-colors">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ) : (() => {
                        // Determine which layout preset is currently active
                        const curLayout = (slide as { image_layout?: string }).image_layout as "overlay" | "right-panel" | "left-panel" | "bottom" | undefined;
                        const hasPos = (slide as { image_x?: number }).image_x != null;
                        const activePreset: "corner" | "overlay" | "right-panel" | "left-panel" | "bottom" =
                          curLayout === "right-panel" ? "right-panel"
                          : curLayout === "left-panel" ? "left-panel"
                          : curLayout === "bottom"    ? "bottom"
                          : (curLayout === "overlay" || hasPos) ? "overlay"
                          : "corner";
                        const PRESETS = [
                          { key: "corner",      label: "Corner",  icon: "⌜", desc: "Thumbnail in header" },
                          { key: "overlay",     label: "Overlay", icon: "⧉", desc: "Drag to position" },
                          { key: "right-panel", label: "Right",   icon: "▐", desc: "Right 40% panel" },
                          { key: "left-panel",  label: "Left",    icon: "▌", desc: "Left 40% panel" },
                          { key: "bottom",      label: "Bottom",  icon: "▄", desc: "Bottom 35% strip" },
                        ] as const;
                        return (
                          <div>
                            {/* Layout preset picker */}
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Image layout</p>
                            <div className="grid grid-cols-5 gap-1 mb-2.5">
                              {PRESETS.map(preset => (
                                <button key={preset.key}
                                  onClick={() => handleSlideImageLayout(preset.key)}
                                  title={preset.desc}
                                  className={`flex flex-col items-center gap-0.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                                    activePreset === preset.key
                                      ? "bg-indigo-600 text-white border-indigo-600"
                                      : "bg-white text-gray-500 border-gray-200 hover:border-indigo-300 hover:text-indigo-600"
                                  }`}>
                                  <span className="text-sm leading-none">{preset.icon}</span>
                                  <span className="text-[9px] leading-tight">{preset.label}</span>
                                </button>
                              ))}
                            </div>
                            {/* Only show fine-grained positioner for overlay mode */}
                            {activePreset === "overlay" && (
                              <>
                                <ImagePositioner
                                  imageUrl={(slide as { image_url?: string }).image_url!}
                                  x={(slide as { image_x?: number }).image_x ?? 70}
                                  y={(slide as { image_y?: number }).image_y ?? 6}
                                  w={(slide as { image_w?: number }).image_w ?? 26}
                                  h={(slide as { image_h?: number }).image_h ?? 20}
                                  onChange={handleSlideImagePosition}
                                />
                                <div className="flex items-center justify-between mt-1">
                                  <p className="text-[10px] text-gray-400">Drag to move · drag dot to resize</p>
                                  <button onClick={handleResetSlideImagePosition}
                                    className="text-[11px] font-medium text-gray-400 hover:text-indigo-600 transition-colors">
                                    Reset
                                  </button>
                                </div>
                              </>
                            )}
                            <div className="flex justify-end mt-1.5">
                              <button onClick={handleRemoveSlideImage}
                                title="Remove image"
                                className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-red-500 transition-colors">
                                <Trash2 size={11} /> Remove image
                              </button>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <label className="flex items-center justify-center gap-1.5 text-xs font-medium text-gray-500 border border-dashed border-gray-300 rounded-lg py-3 cursor-pointer hover:border-indigo-300 hover:text-indigo-600 transition-colors">
                        {slideImageUploading ? <><Loader2 size={12} className="animate-spin" /> Uploading…</> : <><ImagePlus size={12} /> Upload image</>}
                        <input type="file" accept="image/*" className="hidden" disabled={slideImageUploading} onChange={handleSlideImageUpload} />
                      </label>
                    )}
                    {slideImageError && <p className="text-[11px] text-red-500 mt-1.5">{slideImageError}</p>}
                  </div>
                </div>
              </>
            ) : rightPanel === "comments" ? (
              <>
                <div className="px-4 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                  <div>
                    <p className="text-xs font-semibold text-gray-800">Reviewer feedback</p>
                    <p className="text-xs text-gray-400 mt-0.5">Slide {idx + 1} · {comments.filter(c => c.slide_index === idx && !c.resolved).length} open</p>
                  </div>
                  <button onClick={refreshComments} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors" title="Refresh">
                    <RefreshCw size={13} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {comments.filter(c => c.slide_index === idx && !c.resolved).length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-8">No feedback on this slide yet.</p>
                  ) : (
                    comments.filter(c => c.slide_index === idx && !c.resolved).map(c => (
                      <div key={c.id} className="border border-amber-200 bg-amber-50 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-xs font-semibold text-amber-800">{c.reviewer_name}</p>
                          <p className="text-[10px] text-amber-400">{new Date(c.created_at).toLocaleDateString()}</p>
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed mb-3">{c.comment_text}</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleReplanSlide(c.comment_text)}
                            disabled={replanningSlide}
                            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                            {replanningSlide ? <><Loader2 size={11} className="animate-spin" /> Replanning…</> : <><RotateCcw size={11} /> Replan this slide</>}
                          </button>
                          <button
                            onClick={async () => { await resolveComment(c.id); await refreshComments(); }}
                            className="flex items-center gap-1.5 text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors">
                            <CheckCircle2 size={11} /> Done
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                  {/* Cross-slide overview */}
                  {comments.filter(c => c.slide_index !== idx && !c.resolved).length > 0 && (
                    <div className="pt-3 border-t border-gray-100">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">Other slides</p>
                      {[...new Set(comments.filter(c => c.slide_index !== idx && !c.resolved).map(c => c.slide_index))].map(si => (
                        <button key={si} onClick={() => setIdx(si)}
                          className="w-full text-left flex items-center gap-2 text-xs text-gray-500 hover:text-indigo-600 py-1 transition-colors">
                          <MessageSquare size={11} className="text-amber-400" />
                          Slide {si + 1} — {comments.filter(c => c.slide_index === si && !c.resolved).length} comment(s)
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="px-4 pt-4 pb-3 border-b border-gray-100 flex-shrink-0">
                  <p className="text-xs font-semibold text-gray-800">Insert after slide {idx + 1}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Choose a type</p>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                  {SLIDE_TYPE_OPTIONS.map(opt => (
                    <button key={opt.type} onClick={() => addSlide(opt.type)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-indigo-50 text-gray-700 hover:text-indigo-700 transition-colors group">
                      <span className="w-7 h-7 rounded-lg bg-gray-100 group-hover:bg-indigo-100 flex items-center justify-center text-sm font-bold flex-shrink-0">{opt.icon}</span>
                      <p className="text-xs font-medium">{opt.label}</p>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sheet viewer with filters ────────────────────────────────────────────────

type FilterMap = Record<string, string>;

// Month range helpers
const MONTH_NAMES_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_NAMES_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseMonthEntry(val: string): { sortKey: number; display: string } | null {
  if (!val) return null;
  const v = val.trim();

  // "May 2025" or "June 2025"
  const nameYear = v.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (nameYear) {
    const mFull = MONTH_NAMES_FULL.findIndex(m => m.toLowerCase() === nameYear[1].toLowerCase());
    const mAbbr = MONTH_NAMES_ABBR.findIndex(m => m.toLowerCase() === nameYear[1].toLowerCase().slice(0, 3));
    const idx = mFull >= 0 ? mFull : mAbbr;
    if (idx >= 0) return { sortKey: parseInt(nameYear[2]) * 12 + idx, display: v };
  }

  // "2025-05"
  const ymMatch = v.match(/^(\d{4})-(\d{2})$/);
  if (ymMatch) {
    const idx = parseInt(ymMatch[2]) - 1;
    if (idx >= 0 && idx <= 11)
      return { sortKey: parseInt(ymMatch[1]) * 12 + idx, display: `${MONTH_NAMES_FULL[idx]} ${ymMatch[1]}` };
  }

  // Full month name "January"
  const fullIdx = MONTH_NAMES_FULL.findIndex(m => m.toLowerCase() === v.toLowerCase());
  if (fullIdx >= 0) return { sortKey: fullIdx, display: v };

  // 3-char abbreviation "Jan"
  if (v.length <= 4) {
    const abbrIdx = MONTH_NAMES_ABBR.findIndex(m => m.toLowerCase() === v.toLowerCase().slice(0, 3));
    if (abbrIdx >= 0) return { sortKey: abbrIdx, display: MONTH_NAMES_FULL[abbrIdx] };
  }

  return null;
}

// Detect month columns in "wide" format: headers like "May - Value", "June vs Target"
// Returns a Map<monthDisplay, colHeaders[]> sorted by month index, or null if not wide format
function detectWideMonthColumns(headers: string[]): Map<string, string[]> | null {
  const monthMap = new Map<string, { sortKey: number; cols: string[] }>();
  headers.forEach(h => {
    // Try the first word of the header as a month name
    const firstWord = h.trim().split(/[\s\-_\/]+/)[0];
    const entry = parseMonthEntry(firstWord);
    if (entry) {
      const key = entry.display;
      if (!monthMap.has(key)) monthMap.set(key, { sortKey: entry.sortKey, cols: [] });
      monthMap.get(key)!.cols.push(h);
    }
  });
  if (monthMap.size < 2) return null; // need at least 2 months to make a range picker useful
  // Return sorted map
  const sorted = new Map([...monthMap.entries()].sort((a, b) => a[1].sortKey - b[1].sortKey));
  const result = new Map<string, string[]>();
  sorted.forEach((v, k) => result.set(k, v.cols));
  return result;
}

// Detect month column in "long" format: a single column whose VALUES are month names
function detectLongMonthColumn(headers: string[], rows: Record<string, string>[]): string | null {
  const sample = rows.slice(0, 30);
  // Prefer columns named month/period/date
  const namePriority = headers.filter(h => /month|period|date/i.test(h));
  for (const h of namePriority) {
    const vals = sample.map(r => r[h] ?? "").filter(Boolean);
    if (vals.length > 0 && vals.filter(v => parseMonthEntry(v) !== null).length >= vals.length * 0.5)
      return h;
  }
  // Scan remaining columns
  for (const h of headers) {
    if (namePriority.includes(h)) continue;
    const vals = sample.map(r => r[h] ?? "").filter(Boolean);
    if (vals.length > 0 && vals.filter(v => parseMonthEntry(v) !== null).length >= vals.length * 0.7)
      return h;
  }
  return null;
}

function SheetViewer({
  rows, headers, onFilteredChange,
}: {
  rows: Record<string, string>[];
  headers: string[];
  onFilteredChange: (f: Record<string, string>[]) => void;
}) {
  const [filters, setFilters] = useState<FilterMap>({});
  const [monthFrom, setMonthFrom] = useState("");
  const [monthTo, setMonthTo] = useState("");
  const [editCell, setEditCell] = useState<{ row: number; col: string } | null>(null);
  const [tableData, setTableData] = useState(rows);
  useEffect(() => { setTableData(rows); setMonthFrom(""); setMonthTo(""); }, [rows]);

  // Detect layout: wide = months in column names ("May - Value"), long = months in row values
  const wideMonthMap = useMemo(() => detectWideMonthColumns(headers), [headers]);
  const longMonthCol = useMemo(
    () => wideMonthMap ? null : detectLongMonthColumn(headers, tableData),
    [wideMonthMap, headers, tableData]
  );

  // Month options list (sorted)
  const monthOptions: string[] = useMemo(() => {
    if (wideMonthMap) return [...wideMonthMap.keys()];
    if (longMonthCol) {
      const seen = new Map<string, number>();
      tableData.forEach(r => {
        const raw = r[longMonthCol] ?? "";
        const entry = parseMonthEntry(raw);
        if (entry && !seen.has(raw)) seen.set(raw, entry.sortKey);
      });
      return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([v]) => v);
    }
    return [];
  }, [wideMonthMap, longMonthCol, tableData]);

  // Columns to exclude from the generic column-filter bar
  const monthHeaderSet = useMemo((): Set<string> => {
    if (wideMonthMap) {
      const s = new Set<string>();
      wideMonthMap.forEach(cols => cols.forEach(c => s.add(c)));
      return s;
    }
    if (longMonthCol) return new Set([longMonthCol]);
    return new Set();
  }, [wideMonthMap, longMonthCol]);

  const colValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    headers.forEach(h => {
      if (monthHeaderSet.has(h)) return;
      const vals = [...new Set(tableData.map(r => r[h] ?? "").filter(Boolean))].sort();
      if (vals.length > 1 && vals.length <= 60) map[h] = vals;
    });
    return map;
  }, [tableData, headers, monthHeaderSet]);

  // Compute visible headers (wide mode: hide out-of-range month columns)
  const visibleHeaders = useMemo(() => {
    if (!wideMonthMap || (!monthFrom && !monthTo)) return headers;
    const fromKey = monthFrom ? (parseMonthEntry(monthFrom)?.sortKey ?? -Infinity) : -Infinity;
    const toKey = monthTo ? (parseMonthEntry(monthTo)?.sortKey ?? Infinity) : Infinity;
    return headers.filter(h => {
      if (!monthHeaderSet.has(h)) return true; // non-month columns always shown
      const firstWord = h.trim().split(/[\s\-_\/]+/)[0];
      const entry = parseMonthEntry(firstWord);
      return entry && entry.sortKey >= fromKey && entry.sortKey <= toKey;
    });
  }, [wideMonthMap, headers, monthHeaderSet, monthFrom, monthTo]);

  const filtered = useMemo(() => {
    // Start with column-filter (applies to both modes)
    let result = tableData.filter(row =>
      Object.entries(filters).every(([col, val]) => !val || row[col] === val)
    );

    if (wideMonthMap && (monthFrom || monthTo)) {
      // Wide mode: strip out-of-range month columns from each row
      const keepCols = new Set(visibleHeaders);
      result = result.map(row =>
        Object.fromEntries(Object.entries(row).filter(([k]) => keepCols.has(k)))
      );
    } else if (longMonthCol && (monthFrom || monthTo)) {
      // Long mode: filter rows by month value
      const fromKey = monthFrom ? (parseMonthEntry(monthFrom)?.sortKey ?? -Infinity) : -Infinity;
      const toKey = monthTo ? (parseMonthEntry(monthTo)?.sortKey ?? Infinity) : Infinity;
      result = result.filter(row => {
        const entry = parseMonthEntry(row[longMonthCol] ?? "");
        if (!entry) return false;
        return entry.sortKey >= fromKey && entry.sortKey <= toKey;
      });
    }
    return result;
  }, [tableData, filters, wideMonthMap, longMonthCol, monthFrom, monthTo, visibleHeaders]);

  const onFilteredChangeRef = useRef(onFilteredChange);
  useEffect(() => { onFilteredChangeRef.current = onFilteredChange; });
  useEffect(() => { onFilteredChangeRef.current(filtered); }, [filtered]);

  const activeFilters = Object.entries(filters).filter(([, v]) => v !== "");
  const hasMonthFilter = !!(monthFrom || monthTo);
  const hasAnyFilter = activeFilters.length > 0 || hasMonthFilter;
  const showMonthPicker = monthOptions.length >= 2;

  // Column stats — computed from the currently visible/filtered data
  const [statsCol, setStatsCol] = useState<string | null>(null);
  const colStats = useMemo(() => {
    const displayRows = wideMonthMap ? tableData : filtered;
    const stats: Record<string, { min: number; max: number; avg: number; sum: number; count: number; trend: "up" | "down" | "flat" | null }> = {};
    for (const h of visibleHeaders) {
      const nums = displayRows.map(r => parseFloat(r[h])).filter(n => !isNaN(n));
      if (nums.length < 2) continue;
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      const sum = nums.reduce((a, b) => a + b, 0);
      const avg = sum / nums.length;
      // Simple trend: compare first half avg vs second half avg
      const mid = Math.floor(nums.length / 2);
      const firstHalf = nums.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
      const secondHalf = nums.slice(mid).reduce((a, b) => a + b, 0) / (nums.length - mid);
      const trend = secondHalf > firstHalf * 1.02 ? "up" : secondHalf < firstHalf * 0.98 ? "down" : "flat";
      stats[h] = { min, max, avg, sum, count: nums.length, trend };
    }
    return stats;
  }, [visibleHeaders, filtered, tableData, wideMonthMap]);

  const numericCols = Object.keys(colStats);
  const [showStats, setShowStats] = useState(true);

  return (
    <div className="space-y-3">
      {/* Month / period range picker */}
      {showMonthPicker && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-indigo-50 rounded-xl border border-indigo-100">
          <span className="text-xs font-semibold text-indigo-700 flex items-center gap-1.5">
            📅 Period:
          </span>
          <div className="relative">
            <select value={monthFrom} onChange={e => setMonthFrom(e.target.value)}
              className="appearance-none text-xs border border-indigo-200 rounded-lg pl-2.5 pr-6 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 text-gray-700 cursor-pointer">
              <option value="">From (all)</option>
              {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <ChevronDown size={9} className="absolute right-1.5 top-2.5 text-indigo-400 pointer-events-none" />
          </div>
          <span className="text-xs text-indigo-300 font-bold">→</span>
          <div className="relative">
            <select value={monthTo} onChange={e => setMonthTo(e.target.value)}
              className="appearance-none text-xs border border-indigo-200 rounded-lg pl-2.5 pr-6 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 text-gray-700 cursor-pointer">
              <option value="">To (all)</option>
              {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <ChevronDown size={9} className="absolute right-1.5 top-2.5 text-indigo-400 pointer-events-none" />
          </div>
          {hasMonthFilter && (
            <>
              <span className="text-xs font-semibold text-indigo-600 px-2 py-1 bg-indigo-100 rounded-lg">
                {monthFrom || "start"} — {monthTo || "end"}
              </span>
              <button onClick={() => { setMonthFrom(""); setMonthTo(""); }}
                className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-700 transition-colors ml-1">
                <X size={10} /> Clear
              </button>
            </>
          )}
          {wideMonthMap && (
            <span className="ml-auto text-[10px] text-indigo-400">
              {hasMonthFilter ? `${visibleHeaders.filter(h => monthHeaderSet.has(h)).length} month columns selected` : `${wideMonthMap.size} months in sheet`}
            </span>
          )}
        </div>
      )}

      {/* Column filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 flex items-center gap-1"><Filter size={11} /> Filter:</span>
        {Object.entries(colValues).map(([col, vals]) => (
          <div key={col} className="relative">
            <select value={filters[col] ?? ""} onChange={e => setFilters(f => ({ ...f, [col]: e.target.value }))}
              className="appearance-none text-xs border border-gray-200 rounded-lg pl-2.5 pr-6 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 text-gray-700 cursor-pointer">
              <option value="">All {col}</option>
              {vals.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <ChevronDown size={9} className="absolute right-1.5 top-2.5 text-gray-400 pointer-events-none" />
          </div>
        ))}
        {activeFilters.length > 0 && (
          <button onClick={() => setFilters({})} className="flex items-center gap-1 text-xs text-red-500 bg-red-50 px-2 py-1.5 rounded-lg">
            <X size={10} /> Clear
          </button>
        )}
      </div>

      {/* Active chips + count */}
      {hasAnyFilter && (
        <div className="flex flex-wrap gap-1.5 items-center">
          {activeFilters.map(([col, val]) => (
            <span key={col} className="inline-flex items-center gap-1 text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full">
              {col}: <strong>{val}</strong>
              <button onClick={() => setFilters(f => ({ ...f, [col]: "" }))}><X size={9} /></button>
            </span>
          ))}
          {hasMonthFilter && (
            <span className="inline-flex items-center gap-1 text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full">
              Period: <strong>{monthFrom || "start"} — {monthTo || "end"}</strong>
              <button onClick={() => { setMonthFrom(""); setMonthTo(""); }}><X size={9} /></button>
            </span>
          )}
          <span className="text-xs text-gray-400">
            {wideMonthMap && hasMonthFilter
              ? `${tableData.length} rows · ${visibleHeaders.length} of ${headers.length} columns`
              : `${filtered.length} of ${tableData.length} rows`}
          </span>
        </div>
      )}

      {/* Column stats strip */}
      {numericCols.length > 0 && (
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          <button
            onClick={() => setShowStats(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              📊 Column Stats <span className="text-gray-400 font-normal normal-case tracking-normal">({numericCols.length} numeric columns)</span>
            </span>
            <ChevronDown size={12} className={`text-gray-400 transition-transform ${showStats ? "rotate-180" : ""}`} />
          </button>
          {showStats && (
            <div className="overflow-x-auto">
              <div className="flex gap-2 px-3 py-2.5 min-w-max">
                {numericCols.map(col => {
                  const s = colStats[col];
                  const isSelected = statsCol === col;
                  const trendIcon = s.trend === "up" ? "↑" : s.trend === "down" ? "↓" : "→";
                  const trendColor = s.trend === "up" ? "#16A34A" : s.trend === "down" ? "#DC2626" : "#9CA3AF";
                  return (
                    <button
                      key={col}
                      onClick={() => setStatsCol(isSelected ? null : col)}
                      className={`flex-shrink-0 text-left rounded-xl px-3 py-2 border transition-all ${
                        isSelected ? "border-indigo-300 bg-indigo-50" : "border-gray-100 bg-white hover:border-indigo-200"
                      }`}
                      style={{ minWidth: 120 }}>
                      <p className="text-[10px] font-semibold text-gray-500 truncate mb-1" style={{ maxWidth: 110 }}>{col}</p>
                      <div className="flex items-baseline gap-1 mb-1">
                        <span className="text-sm font-black text-gray-900">{s.avg % 1 === 0 ? s.avg.toLocaleString() : s.avg.toFixed(1)}</span>
                        <span className="text-[10px] font-semibold" style={{ color: trendColor }}>{trendIcon}</span>
                      </div>
                      <div className="flex gap-2 text-[9px] text-gray-400">
                        <span>↓{s.min % 1 === 0 ? s.min.toLocaleString() : s.min.toFixed(1)}</span>
                        <span>↑{s.max % 1 === 0 ? s.max.toLocaleString() : s.max.toFixed(1)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
          <span className="text-xs text-gray-500 font-medium">
            {wideMonthMap && hasMonthFilter
              ? `${tableData.length} rows · ${visibleHeaders.length} of ${headers.length} columns shown`
              : `${filtered.length} rows · ${visibleHeaders.length} columns`}
          </span>
          <span className="text-xs text-gray-400 flex items-center gap-1"><Edit3 size={10} /> Click cell to edit</span>
        </div>
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr>{visibleHeaders.map(h => (
                <th key={h}
                  onClick={() => colStats[h] && setStatsCol(statsCol === h ? null : h)}
                  className={`px-3 py-2 text-left font-medium border-b border-gray-100 whitespace-nowrap ${
                    statsCol === h ? "bg-indigo-100 text-indigo-700" :
                    monthHeaderSet.has(h) ? "bg-gray-50 text-indigo-600" : "bg-gray-50 text-gray-600"
                  } ${colStats[h] ? "cursor-pointer hover:bg-indigo-50" : ""}`}
                  title={colStats[h] ? `Avg: ${colStats[h].avg.toFixed(1)} · Min: ${colStats[h].min} · Max: ${colStats[h].max}` : undefined}>
                  {h}{colStats[h] && <span className="ml-1 text-[9px] opacity-50">#</span>}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {(wideMonthMap ? tableData : filtered).slice(0, 100).map((row, ri) => (
                <tr key={ri} className="hover:bg-indigo-50/30 border-b border-gray-50">
                  {visibleHeaders.map(col => (
                    <td key={col} className={`px-3 py-2 text-gray-700 max-w-[180px] ${statsCol === col ? "bg-indigo-50/60" : ""}`}>
                      {editCell?.row === ri && editCell?.col === col ? (
                        <input autoFocus defaultValue={row[col]}
                          onBlur={e => {
                            const updated = [...tableData];
                            const realIdx = tableData.indexOf(row);
                            updated[realIdx] = { ...updated[realIdx], [col]: e.target.value };
                            setTableData(updated); setEditCell(null);
                          }}
                          className="w-full border border-indigo-300 rounded px-1 py-0.5 outline-none" />
                      ) : (
                        <span onClick={() => setEditCell({ row: ri, col })}
                          className="cursor-pointer hover:text-indigo-600 truncate block" title={row[col]}>
                          {row[col] || <span className="text-gray-300">—</span>}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {(wideMonthMap ? tableData : filtered).length > 100 && (
            <p className="text-center text-xs text-gray-400 py-2">
              Showing first 100 of {(wideMonthMap ? tableData : filtered).length} rows
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Source data type ──────────────────────────────────────────────────────────

export type SourceWithData = {
  source: ReportSource;
  rows: Record<string, string>[];
  headers: string[];
  filteredRows: Record<string, string>[];
};

// ─── Data tab ─────────────────────────────────────────────────────────────────

const POLL_INTERVALS = [
  { label: "30s", ms: 30_000 },
  { label: "1m",  ms: 60_000 },
  { label: "5m",  ms: 300_000 },
];

function rowHash(rows: Record<string, string>[]): string {
  // Cheap change-detection — stringify row count + first+last row values
  if (!rows.length) return "0";
  const sample = [rows[0], rows[rows.length - 1]].map(r => Object.values(r).join("|")).join("||");
  return `${rows.length}::${sample}`;
}

function LiveBadge() {
  const [tick, setTick] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setTick(v => !v), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
      <span className={`w-1.5 h-1.5 rounded-full bg-green-500 transition-opacity ${tick ? "opacity-100" : "opacity-30"}`} />
      LIVE
    </span>
  );
}

// ─── Data Source Configure Panel ──────────────────────────────────────────────

const AGGREGATIONS = ["sum","avg","count","min","max","ratio","custom"] as const;

function ConfigurePanel({ source, headers, sampleRows, onSaved, onClose }: {
  source: ReportSource; headers: string[]; sampleRows: Record<string, string>[];
  onSaved: () => void; onClose: () => void;
}) {
  const params = (source.parameters as DataParameter[] | null) ?? [];
  const insights = (source.expected_insights as string[] | null) ?? [];

  const [dataType, setDataType] = useState(source.data_type ?? "");
  const [parameters, setParameters] = useState<DataParameter[]>(params);
  const [expectedInsights, setExpectedInsights] = useState<string[]>(insights.length > 0 ? insights : [""]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState("");

  // Animate in on mount, out on close
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(t); }, []);
  const handleClose = () => { setVisible(false); setTimeout(onClose, 280); };

  const addParam = () => setParameters(p => [...p, {
    id: crypto.randomUUID(), name: "", description: "", aggregation: "sum",
  }]);

  const updateParam = (id: string, patch: Partial<DataParameter>) =>
    setParameters(p => p.map(x => x.id === id ? { ...x, ...patch } : x));

  const removeParam = (id: string) => setParameters(p => p.filter(x => x.id !== id));

  const updateInsight = (i: number, v: string) =>
    setExpectedInsights(prev => prev.map((x, j) => j === i ? v : x));

  const addInsight = () => setExpectedInsights(p => [...p, ""]);
  const removeInsight = (i: number) => setExpectedInsights(p => p.filter((_, j) => j !== i));

  // Reads the actual connected sheet (real headers + real sample rows,
  // passed in from DataSourcesTab) and proposes a data type + parameters
  // grounded in what's really there — replacing the old fixed preset list,
  // which had no relationship to the sheet at all. This only fills the form;
  // nothing is saved until "Save changes" below.
  const handleSuggest = async () => {
    if (headers.length === 0) {
      setSuggestError("Sync this sheet first — there's no real data to read yet.");
      return;
    }
    setSuggesting(true);
    setSuggestError("");
    const result = await suggestSourceConfig(source.name, headers, sampleRows);
    setSuggesting(false);
    if (result.error) { setSuggestError(result.error); return; }
    if (result.dataType) setDataType(result.dataType);
    if (result.parameters && result.parameters.length > 0) setParameters(result.parameters);
    if (result.expectedInsights && result.expectedInsights.length > 0) setExpectedInsights(result.expectedInsights);
  };

  const handleSave = async () => {
    setSaving(true);
    await updateReportSourceConfig(source.id, {
      data_type: dataType || undefined,
      parameters: parameters.filter(p => p.name.trim()),
      expected_insights: expectedInsights.filter(s => s.trim()),
    });
    setSaving(false);
    setSaved(true);
    onSaved();
    setTimeout(() => { setSaved(false); handleClose(); }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch">
      {/* Backdrop */}
      <div
        onClick={handleClose}
        className="flex-1 transition-opacity duration-300 ease-out"
        style={{ background: "rgba(0,0,0,0.45)", opacity: visible ? 1 : 0 }}
      />

      {/* Drawer */}
      <div
        className="w-[80vw] bg-white h-full flex flex-col transition-transform duration-300 ease-out"
        style={{
          transform: visible ? "translateX(0)" : "translateX(100%)",
          boxShadow: "-8px 0 40px rgba(0,0,0,0.12)",
        }}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-8 py-5 flex-shrink-0 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-slate-900 flex items-center justify-center">
              <SlidersHorizontal size={14} className="text-white" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-gray-900 leading-tight">Source configuration</h2>
              <p className="text-xs text-gray-400 mt-0.5">{source.name}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── How it works strip ───────────────────────────────── */}
        <div className="flex-shrink-0 border-b border-gray-100 bg-slate-50 px-8 py-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">How it works</p>
          <div className="grid grid-cols-3 gap-6">
            {[
              { n: "01", icon: <FlaskConical size={12} />, label: "Data type", text: "Name the kind of data in this sheet. The AI uses this to interpret numbers in context — Claims data is read very differently from Revenue data." },
              { n: "02", icon: <SlidersHorizontal size={12} />, label: "Parameters", text: "Define the exact metrics to track — their name, how they are computed, and which column holds the raw value. Every generated deck must include these." },
              { n: "03", icon: <Target size={12} />, label: "Expected insights", text: "Write the business questions this data should answer. These become hard requirements — the AI will not produce a deck without addressing each one." },
            ].map(({ n, icon, label, text }) => (
              <div key={n} className="flex gap-3">
                <span className="text-[11px] font-bold text-gray-300 mt-0.5 w-5 flex-shrink-0">{n}</span>
                <div>
                  <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5 mb-1">{icon}{label}</p>
                  <p className="text-[11px] text-gray-400 leading-relaxed">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Scrollable body ──────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-8 py-7 space-y-10">

          {/* ── 01 Data type ── */}
          <section>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">01</span>
                <h3 className="text-sm font-semibold text-gray-800">Data Type</h3>
              </div>
              <button onClick={handleSuggest} disabled={suggesting}
                title={headers.length === 0 ? "Sync this sheet first" : "Read the real columns and sample rows in this sheet"}
                className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors bg-white disabled:opacity-40">
                {suggesting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {suggesting ? "Reading sheet…" : "Suggest from sheet"}
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-4 pl-6">
              Write your own, or click &quot;Suggest from sheet&quot; to have the AI read this sheet&apos;s real columns and sample rows and propose a data type plus a first draft of parameters below — nothing is saved until you click Save.
            </p>
            {suggestError && <p className="text-xs text-red-500 mb-3 pl-6">{suggestError}</p>}
            <input
              value={dataType}
              onChange={e => setDataType(e.target.value)}
              placeholder="e.g. Motor Insurance Policies, SaaS Subscriptions…"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-transparent transition-shadow"
            />
          </section>

          {/* ── 02 Parameters ── */}
          <section>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">02</span>
                <h3 className="text-sm font-semibold text-gray-800">Tracked Parameters</h3>
              </div>
              <button onClick={addParam}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-200 hover:border-gray-400 hover:text-gray-900 px-3 py-1.5 rounded-lg transition-colors bg-white">
                <Plus size={12} /> Add parameter
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-5 pl-6">Define exact metrics the AI must compute and surface in every deck.</p>

            {parameters.length === 0 ? (
              <div className="border border-dashed border-gray-200 rounded-2xl py-12 flex flex-col items-center text-center bg-gray-50/50">
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                  <SlidersHorizontal size={18} className="text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-500 mb-1">No parameters yet</p>
                <p className="text-xs text-gray-400 max-w-xs mb-4">Add the metrics you track — e.g. Claims Ratio, Settlement TAT, Net Promoter Score</p>
                <button onClick={addParam}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 border border-gray-300 hover:border-gray-500 px-4 py-2 rounded-lg transition-colors bg-white">
                  <Plus size={12} /> Add first parameter
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {parameters.map((param, idx) => (
                  <div key={param.id} className="rounded-2xl border border-gray-150 bg-white overflow-hidden" style={{ borderColor: "#EBEBEB" }}>
                    <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b" style={{ borderColor: "#EBEBEB" }}>
                      <span className="text-[11px] font-semibold text-gray-400 tracking-wide">PARAMETER {idx + 1}</span>
                      <button onClick={() => removeParam(param.id)}
                        className="text-[11px] text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors">
                        <Trash2 size={11} /> Remove
                      </button>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="grid grid-cols-5 gap-3">
                        <div className="col-span-3">
                          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Name</label>
                          <input value={param.name} onChange={e => updateParam(param.id, { name: e.target.value })}
                            placeholder="e.g. Claims Ratio"
                            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-200 transition-shadow" />
                        </div>
                        <div className="col-span-2">
                          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Aggregation</label>
                          <select value={param.aggregation} onChange={e => updateParam(param.id, { aggregation: e.target.value as DataParameter["aggregation"] })}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200 bg-white transition-shadow">
                            {AGGREGATIONS.map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Description</label>
                        <input value={param.description} onChange={e => updateParam(param.id, { description: e.target.value })}
                          placeholder="e.g. % of claims approved out of total filed, used to gauge underwriting quality"
                          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-200 transition-shadow" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Sheet column <span className="normal-case font-normal">(optional)</span></label>
                          {headers.length > 0 ? (
                            <select value={param.column ?? ""} onChange={e => updateParam(param.id, { column: e.target.value || undefined })}
                              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200 bg-white transition-shadow">
                              <option value="">— none, combines multiple columns —</option>
                              {headers.map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                          ) : (
                            <>
                              <input value={param.column ?? ""} onChange={e => updateParam(param.id, { column: e.target.value || undefined })}
                                placeholder="Sync this sheet first to pick from real columns"
                                disabled
                                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm placeholder-gray-300 bg-gray-50 text-gray-400" />
                            </>
                          )}
                        </div>
                        {(param.aggregation === "ratio" || param.aggregation === "custom") && (
                          <div>
                            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Formula</label>
                            <input value={param.formula ?? ""} onChange={e => updateParam(param.id, { formula: e.target.value || undefined })}
                              placeholder="e.g. approved / total * 100"
                              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-200 transition-shadow" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── 03 Expected insights ── */}
          <section>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">03</span>
                <h3 className="text-sm font-semibold text-gray-800">Expected Insights</h3>
              </div>
              <button onClick={addInsight}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-200 hover:border-gray-400 hover:text-gray-900 px-3 py-1.5 rounded-lg transition-colors bg-white">
                <Plus size={12} /> Add insight
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-5 pl-6">Business questions the AI must answer in every deck. Be specific — vague questions produce vague slides.</p>
            <div className="space-y-2">
              {expectedInsights.map((ins, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[11px] font-bold text-gray-300 w-5 flex-shrink-0 text-right">{i + 1}</span>
                  <input
                    value={ins}
                    onChange={e => updateInsight(i, e.target.value)}
                    placeholder={[
                      "What is the trend in claims ratio over this period?",
                      "Which product line has the highest settlement cost?",
                      "Are we on track to hit our revenue target?",
                      "What drove the spike in rejections in Month 3?",
                    ][i % 4]}
                    className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-200 transition-shadow"
                  />
                  {expectedInsights.length > 1 && (
                    <button onClick={() => removeInsight(i)} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0">
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

        </div>

        {/* ── Footer ──────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-gray-100 px-8 py-4 flex items-center justify-between bg-white">
          <p className="text-xs text-gray-400 max-w-sm">Saved configuration is injected into every AI report generated from <span className="font-medium text-gray-600">{source.name}</span>.</p>
          <div className="flex items-center gap-2">
            <button onClick={handleClose}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl px-5 py-2 text-sm font-medium disabled:opacity-40 transition-colors">
              {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <CheckCircle2 size={13} /> : null}
              {saved ? "Saved" : saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

function DataSourcesTab({ orgId, onDataReady }: { orgId: string; onDataReady: (s: SourceWithData[]) => void }) {
  const [sources, setSources] = useState<ReportSource[]>([]);
  const [sourceData, setSourceData] = useState<Record<string, { rows: Record<string, string>[]; headers: string[]; filteredRows: Record<string, string>[]; hash: string; lastSynced: string }>>({});
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configureOpen, setConfigureOpen] = useState<string | null>(null);
  // Live sync
  const [liveSync, setLiveSync] = useState(false);
  const [pollInterval, setPollInterval] = useState(POLL_INTERVALS[0].ms);
  const [changed, setChanged] = useState<Record<string, boolean>>({});
  const sourcesRef = useRef(sources);
  useEffect(() => { sourcesRef.current = sources; }, [sources]);

  const load = useCallback(async () => {
    const data = await getReportSources(orgId);
    setSources(data);
    for (const s of data) {
      if (s.cached_data) {
        const rows = s.cached_data as Record<string, string>[];
        const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
        setSourceData(prev => ({
          ...prev,
          [s.id]: prev[s.id]
            ? { ...prev[s.id], rows, headers }  // keep filteredRows
            : { rows, headers, filteredRows: rows, hash: rowHash(rows), lastSynced: s.last_fetched_at ?? "" },
        }));
      }
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  // Notify parent
  const onDataReadyRef = useRef(onDataReady);
  useEffect(() => { onDataReadyRef.current = onDataReady; });
  useEffect(() => {
    onDataReadyRef.current(sources.map(s => ({
      source: s,
      rows: sourceData[s.id]?.rows ?? [],
      headers: sourceData[s.id]?.headers ?? [],
      filteredRows: sourceData[s.id]?.filteredRows ?? [],
    })));
  }, [sources, sourceData]);

  // Silent background sync — only updates state if content changed
  const silentSync = useCallback(async (sourceId: string) => {
    const { rows, headers, error: err } = await fetchSheetData(sourceId);
    if (err || !rows.length) return;
    const newHash = rowHash(rows);
    setSourceData(prev => {
      const existing = prev[sourceId];
      if (existing?.hash === newHash) return prev; // no change
      setChanged(c => ({ ...c, [sourceId]: true }));
      return {
        ...prev,
        [sourceId]: { rows, headers, filteredRows: rows, hash: newHash, lastSynced: new Date().toISOString() },
      };
    });
    await load();
  }, [load]);

  // Auto-poll
  useEffect(() => {
    if (!liveSync || sourcesRef.current.length === 0) return;
    const tick = async () => {
      for (const s of sourcesRef.current) await silentSync(s.id);
    };
    const id = setInterval(tick, pollInterval);
    return () => clearInterval(id);
  }, [liveSync, pollInterval, silentSync]);

  const handleSync = async (sourceId: string, silent = false) => {
    if (!silent) setSyncing(sourceId);
    setError(null);
    const { rows, headers, error: err } = await fetchSheetData(sourceId);
    if (!silent) setSyncing(null);
    if (err) { if (!silent) setError(err); return; }
    const newHash = rowHash(rows);
    setSourceData(prev => {
      const existing = prev[sourceId];
      const didChange = existing && existing.hash !== newHash;
      if (didChange) setChanged(c => ({ ...c, [sourceId]: true }));
      return {
        ...prev,
        [sourceId]: {
          rows,
          headers,
          filteredRows: existing?.filteredRows ?? rows,
          hash: newHash,
          lastSynced: new Date().toISOString(),
        },
      };
    });
    await load();
  };

  const handleAdd = async () => {
    if (!name.trim() || !url.trim()) return;
    setAdding(true); setError(null);
    // Accept any Google Sheets URL and auto-convert to published CSV URL
    const normalizedUrl = normalizeSheetUrl(url.trim());
    const { id, error: err } = await saveReportSource(orgId, name, normalizedUrl);
    if (err) { setError(err); setAdding(false); return; }
    setName(""); setUrl("");
    await load();
    if (id) await handleSync(id);
    setAdding(false);
  };

  const handleFilteredChange = useCallback((sourceId: string, filtered: Record<string, string>[]) => {
    setSourceData(prev => prev[sourceId] ? { ...prev, [sourceId]: { ...prev[sourceId], filteredRows: filtered } } : prev);
  }, []);

  return (
    <div className="space-y-5">
      {/* Connect */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <Link size={14} className="text-indigo-500" /> Connect a Google Sheet
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Source name"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          <input value={url} onChange={e => setUrl(e.target.value)}
            placeholder="Paste any Google Sheets URL or spreadsheet ID"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          <button onClick={handleAdd} disabled={adding || !name.trim() || !url.trim()}
            className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 transition-colors">
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add & Sync
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Paste the Google Sheets sharing URL, edit URL, or just the spreadsheet ID — we'll auto-convert it. Make sure the sheet is set to &quot;Anyone with the link can view&quot;.
        </p>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>

      {/* Live sync controls */}
      {sources.length > 0 && (
        <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-5 py-3">
          <button
            onClick={() => setLiveSync(v => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${liveSync ? "bg-green-500" : "bg-gray-200"}`}>
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${liveSync ? "translate-x-6" : "translate-x-1"}`} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-700">Live sync</p>
              {liveSync && <LiveBadge />}
            </div>
            <p className="text-xs text-gray-400">
              {liveSync ? "Sheet will auto-refresh in the background. Any changes in your Google Sheet appear here automatically." : "Enable to auto-refresh when your Google Sheet changes."}
            </p>
          </div>
          {liveSync && (
            <div className="flex items-center gap-1 flex-shrink-0">
              {POLL_INTERVALS.map(pi => (
                <button key={pi.ms} onClick={() => setPollInterval(pi.ms)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${pollInterval === pi.ms ? "bg-green-100 text-green-700 font-semibold" : "text-gray-500 hover:bg-gray-100"}`}>
                  {pi.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {sources.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Table size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No data sources yet.</p>
        </div>
      ) : sources.map(source => {
        const sd = sourceData[source.id];
        const hasChanged = changed[source.id];
        const lastSynced = sd?.lastSynced || source.last_fetched_at;
        return (
          <div key={source.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {/* Changed banner */}
            {hasChanged && (
              <div className="flex items-center justify-between px-5 py-2.5 bg-green-50 border-b border-green-100">
                <p className="text-xs text-green-700 font-medium flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-green-500" /> Sheet updated — new data loaded
                </p>
                <button onClick={() => setChanged(c => ({ ...c, [source.id]: false }))} className="text-green-500 hover:text-green-700">
                  <X size={13} />
                </button>
              </div>
            )}

            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Table size={14} className="text-green-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-800">{source.name}</p>
                    {liveSync && <LiveBadge />}
                    {((source.parameters as DataParameter[] | null)?.length ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-100">
                        <SlidersHorizontal size={9} /> {(source.parameters as DataParameter[]).length} param{(source.parameters as DataParameter[]).length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">
                    {lastSynced ? `Synced ${timeAgo(lastSynced)}` : "Not synced"}
                    {sd?.rows.length ? ` · ${sd.rows.length} rows` : ""}
                    {liveSync ? ` · polling every ${POLL_INTERVALS.find(p => p.ms === pollInterval)?.label}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Configure AI context — prominent labeled button */}
                {(() => {
                  const hasConfig = !!(source.data_type || (source.parameters as DataParameter[] | null)?.length || (source.expected_insights as string[] | null)?.length);
                  return (
                    <button
                      onClick={() => setConfigureOpen(configureOpen === source.id ? null : source.id)}
                      className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
                        hasConfig
                          ? "bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100"
                          : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                      }`}>
                      <SlidersHorizontal size={12} />
                      {hasConfig ? "AI context" : "Set up AI context"}
                    </button>
                  );
                })()}
                <div className="flex items-center gap-0.5 bg-gray-50 rounded-lg p-0.5">
                  <a href={source.sheet_url} target="_blank" rel="noreferrer"
                    className="p-1.5 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-white transition-colors" title="Open sheet">
                    <ExternalLink size={13} />
                  </a>
                  <button onClick={() => handleSync(source.id)} disabled={syncing === source.id}
                    className="p-1.5 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-white transition-colors" title="Sync now">
                    <RefreshCw size={13} className={syncing === source.id ? "animate-spin text-indigo-500" : ""} />
                  </button>
                  <button onClick={async () => { await deleteReportSource(source.id); await load(); }}
                    className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-white transition-colors" title="Delete source">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>

            <div className="p-5">
              {syncing === source.id ? (
                <div className="flex items-center justify-center py-8 gap-2 text-indigo-500 text-sm">
                  <Loader2 size={16} className="animate-spin" /> Fetching…
                </div>
              ) : !sd || sd.rows.length === 0 ? (
                <div className="text-center py-8 text-sm text-gray-400">
                  No data. <button onClick={() => handleSync(source.id)} className="text-indigo-600 underline">Sync now</button>
                </div>
              ) : (
                <SheetViewer rows={sd.rows} headers={sd.headers} onFilteredChange={f => handleFilteredChange(source.id, f)} />
              )}
            </div>
            {configureOpen === source.id && (
              <ConfigurePanel
                source={source}
                headers={sd?.headers ?? []}
                sampleRows={(sd?.rows ?? []).slice(0, 5)}
                onSaved={load}
                onClose={() => setConfigureOpen(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Generate tab helpers ─────────────────────────────────────────────────────

const SLIDE_FOCUS_DEFAULTS = [
  "Overview & key highlights",
  "Performance metrics & KPIs",
  "Trends & period comparison",
  "Breakdown by category",
  "Top performers & standouts",
  "Issues & outliers",
  "Root cause analysis",
  "Insights & recommendations",
  "Action plan & next steps",
];

function getDefaultFocus(slideIndex: number, totalSlides: number): string {
  const pos = slideIndex - 2; // 0-indexed among inner slides
  return SLIDE_FOCUS_DEFAULTS[pos % SLIDE_FOCUS_DEFAULTS.length];
}

const CHART_CONFIGS = [
  {
    id: "auto", label: "Auto",
    preview: (
      <svg viewBox="0 0 120 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="38" width="14" height="18" fill="#c7d2fe" rx="2"/>
        <polyline points="15,38 38,23 62,28 86,10 108,17" stroke="#6366f1" strokeWidth="2" fill="none" strokeLinejoin="round"/>
        <circle cx="38" cy="23" r="2.5" fill="#6366f1"/><circle cx="62" cy="28" r="2.5" fill="#6366f1"/>
        <circle cx="86" cy="10" r="2.5" fill="#6366f1"/><circle cx="108" cy="17" r="2.5" fill="#6366f1"/>
        <line x1="8" y1="56" x2="114" y2="56" stroke="#e5e7eb" strokeWidth="1"/>
        <text x="90" y="62" fill="#a5b4fc" fontSize="11">✦</text>
      </svg>
    ),
    desc: "AI picks the best chart type for your data",
  },
  {
    id: "bar", label: "Bar chart",
    preview: (
      <svg viewBox="0 0 120 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <line x1="14" y1="6" x2="14" y2="54" stroke="#e5e7eb" strokeWidth="1"/>
        <line x1="14" y1="54" x2="114" y2="54" stroke="#e5e7eb" strokeWidth="1"/>
        <rect x="20" y="33" width="14" height="21" fill="#c7d2fe" rx="2"/>
        <rect x="40" y="16" width="14" height="38" fill="#6366f1" rx="2"/>
        <rect x="60" y="26" width="14" height="28" fill="#818cf8" rx="2"/>
        <rect x="80" y="8" width="14" height="46" fill="#6366f1" rx="2"/>
        <rect x="100" y="20" width="14" height="34" fill="#c7d2fe" rx="2"/>
      </svg>
    ),
    desc: "Compare values across categories",
  },
  {
    id: "line", label: "Line chart",
    preview: (
      <svg viewBox="0 0 120 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <line x1="10" y1="54" x2="114" y2="54" stroke="#e5e7eb" strokeWidth="1"/>
        <line x1="10" y1="38" x2="114" y2="38" stroke="#f3f4f6" strokeWidth="1" strokeDasharray="3,2"/>
        <line x1="10" y1="22" x2="114" y2="22" stroke="#f3f4f6" strokeWidth="1" strokeDasharray="3,2"/>
        <polyline points="14,46 34,32 54,38 74,16 94,24 114,12" stroke="#6366f1" strokeWidth="2.5" fill="none" strokeLinejoin="round"/>
        <circle cx="14" cy="46" r="3" fill="#6366f1"/><circle cx="34" cy="32" r="3" fill="#6366f1"/>
        <circle cx="54" cy="38" r="3" fill="#6366f1"/><circle cx="74" cy="16" r="3" fill="#6366f1"/>
        <circle cx="94" cy="24" r="3" fill="#6366f1"/><circle cx="114" cy="12" r="3" fill="#6366f1"/>
      </svg>
    ),
    desc: "Show trends and changes over time",
  },
  {
    id: "area", label: "Area chart",
    preview: (
      <svg viewBox="0 0 120 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <line x1="10" y1="54" x2="114" y2="54" stroke="#e5e7eb" strokeWidth="1"/>
        <path d="M14,46 L34,32 L54,38 L74,16 L94,24 L114,12 L114,54 L14,54 Z" fill="#e0e7ff" opacity="0.85"/>
        <polyline points="14,46 34,32 54,38 74,16 94,24 114,12" stroke="#6366f1" strokeWidth="2.5" fill="none" strokeLinejoin="round"/>
        <circle cx="14" cy="46" r="2.5" fill="#6366f1"/><circle cx="74" cy="16" r="2.5" fill="#6366f1"/>
        <circle cx="114" cy="12" r="2.5" fill="#6366f1"/>
      </svg>
    ),
    desc: "Filled area — great for cumulative trends",
  },
  {
    id: "pie", label: "Pie chart",
    preview: (
      <svg viewBox="0 0 120 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M60,32 L60,6 A26,26 0 0,1 75.3,55.5 Z" fill="#6366f1"/>
        <path d="M60,32 L75.3,55.5 A26,26 0 0,1 34.3,47.5 Z" fill="#818cf8"/>
        <path d="M60,32 L34.3,47.5 A26,26 0 0,1 60,6 Z" fill="#c7d2fe"/>
        <text x="65" y="27" fill="white" fontSize="7" fontWeight="bold">42%</text>
        <text x="62" y="52" fill="white" fontSize="7" fontWeight="bold">30%</text>
        <text x="35" y="36" fill="#4f46e5" fontSize="7" fontWeight="bold">28%</text>
      </svg>
    ),
    desc: "Part-of-whole — best for 3-5 categories",
  },
  {
    id: "donut", label: "Donut chart",
    preview: (
      <svg viewBox="0 0 120 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M60,32 L60,6 A26,26 0 0,1 75.3,55.5 Z" fill="#6366f1"/>
        <path d="M60,32 L75.3,55.5 A26,26 0 0,1 34.3,47.5 Z" fill="#818cf8"/>
        <path d="M60,32 L34.3,47.5 A26,26 0 0,1 60,6 Z" fill="#c7d2fe"/>
        <circle cx="60" cy="32" r="13" fill="white"/>
        <text x="60" y="36" fill="#6366f1" fontSize="8" fontWeight="bold" textAnchor="middle">42%</text>
      </svg>
    ),
    desc: "Like pie but highlights a central metric",
  },
  {
    id: "table", label: "Data table",
    preview: (
      <svg viewBox="0 0 120 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="8" width="104" height="13" fill="#e0e7ff" rx="2"/>
        <rect x="8" y="23" width="104" height="11" fill="#f9fafb"/>
        <rect x="8" y="36" width="104" height="11" fill="white"/>
        <rect x="8" y="49" width="104" height="11" fill="#f9fafb"/>
        <line x1="42" y1="8" x2="42" y2="60" stroke="#e5e7eb" strokeWidth="1"/>
        <line x1="76" y1="8" x2="76" y2="60" stroke="#e5e7eb" strokeWidth="1"/>
        <rect x="12" y="12" width="22" height="4" fill="#a5b4fc" rx="1"/>
        <rect x="46" y="12" width="22" height="4" fill="#a5b4fc" rx="1"/>
        <rect x="80" y="12" width="22" height="4" fill="#a5b4fc" rx="1"/>
        <rect x="12" y="27" width="16" height="3" fill="#d1d5db" rx="1"/>
        <rect x="46" y="27" width="20" height="3" fill="#d1d5db" rx="1"/>
        <rect x="80" y="27" width="14" height="3" fill="#d1d5db" rx="1"/>
        <rect x="12" y="40" width="20" height="3" fill="#e5e7eb" rx="1"/>
        <rect x="46" y="40" width="12" height="3" fill="#e5e7eb" rx="1"/>
        <rect x="80" y="40" width="18" height="3" fill="#e5e7eb" rx="1"/>
        <rect x="8" y="8" width="104" height="52" rx="2" stroke="#e5e7eb" strokeWidth="1"/>
      </svg>
    ),
    desc: "Raw numbers — precise comparison",
  },
];

// ─── Generate tab ─────────────────────────────────────────────────────────────

const THEMES: { id: DesignTheme; label: string; desc: string; preview: string }[] = [
  { id: "brand", label: "Brand", desc: "Your brand color cover, white content slides", preview: "bg-indigo-600" },
  { id: "midnight", label: "Midnight", desc: "Dark navy throughout — premium executive feel", preview: "bg-slate-900" },
  { id: "clean", label: "Clean", desc: "All-white, minimal — typography-first", preview: "bg-white border border-gray-200" },
];

// Numbered step wrapper — turns the generate flow from a wall of disconnected
// cards into a clear "do this, then this" sequence the user can follow top
// to bottom without guessing what order things matter in.
//
// Optionally collapsible: the setup step's fields are all quick one-time
// choices that default to something reasonable, so showing every field's
// full UI on every visit (a dropdown, a checkbox row) made the page read
// as long even after consolidating four cards into one.
// Collapsed by default with a one-line summary, it expands back to the full
// editable form on click — nothing is hidden permanently, it's just not
// taking up space until someone actually wants to change it.
function StepCard({
  step, title, hint, badge, children, collapsible, summary,
}: { step: number; title: string; hint?: string; badge?: React.ReactNode; children: React.ReactNode; collapsible?: boolean; summary?: string }) {
  const [open, setOpen] = useState(!collapsible);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div
        className={`flex items-start justify-between gap-3 ${open ? "mb-3" : ""} ${collapsible ? "cursor-pointer" : ""}`}
        onClick={collapsible ? () => setOpen(v => !v) : undefined}
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
            {step}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800">{title}</p>
            {open
              ? hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>
              : summary && <p className="text-xs text-gray-400 mt-0.5 truncate">{summary}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {badge}
          {collapsible && <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />}
        </div>
      </div>
      {open && <div className="pl-9">{children}</div>}
    </div>
  );
}

// Mirrors the exact shape Cohort Builder saves under `bios_cohorts_<orgId>` —
// saved cohorts live only in this browser's local storage (never written to
// the database), so this is the only way a report can see them at all.
type SavedCohort = { id: string; name: string; filter: CohortFilter; createdAt: string };
function loadSavedCohorts(orgId: string): SavedCohort[] {
  try { return JSON.parse(localStorage.getItem(`bios_cohorts_${orgId}`) ?? "[]"); }
  catch { return []; }
}

function GenerateTab({ orgId, sourcesWithData, onGenerated }: { orgId: string; sourcesWithData: SourceWithData[]; onGenerated: () => void }) {
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.toLocaleString("default", { month: "long" })} ${d.getFullYear()}`;
  });
  const [customPeriod, setCustomPeriod] = useState(false);
  const [theme, setTheme] = useState<DesignTheme>("brand");
  const [brandColors, setBrandColors] = useState<{ primary: string; secondary: string; logoUrl?: string | null }>({ primary: "#6366f1", secondary: "#a5b4fc", logoUrl: null });
  const [slackWebhook, setSlackWebhook] = useState("");

  // BIOS data sections
  const [biosSections, setBiosSections] = useState<BiosSections>({ goals: true, features: true, funnelsKpis: true });
  const anyBiosSection = biosSections.goals || biosSections.features || biosSections.funnelsKpis || biosSections.funnels;

  // Explicit sheet include toggle — user controls it, but we auto-default:
  // ON when 0 or 2+ sections selected (broad / full review), OFF when exactly
  // 1 section (focused mode — sheet data is usually irrelevant there).
  const [includeSheet, setIncludeSheet] = useState(true);
  const activeSectionCount = [biosSections.goals, biosSections.features, biosSections.funnelsKpis, biosSections.funnels].filter(Boolean).length;
  useEffect(() => {
    setIncludeSheet(activeSectionCount !== 1);
  }, [activeSectionCount]);

  // Per-template planning state
  type PlanState = { status: "idle" | "planning" | "ready" | "error"; deck?: SlidesDeck; tokensUsed?: number; error?: string };
  const [planStates, setPlanStates] = useState<Record<string, PlanState>>({});
  const [activePreview, setActivePreview] = useState<{ templateId: string; templateName: string } | null>(null);
  const [totalTokens, setTotalTokens] = useState(0);
  const [extraNotes, setExtraNotes] = useState<Record<string, string>>({});
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
  // Saved AI insights — pinned earlier from Cohorts / AI Analyst / Business
  // Brief — selectable per-template and folded into the AI's briefing notes.
  const [savedInsights, setSavedInsights] = useState<SavedInsight[]>([]);
  const [selectedInsightIds, setSelectedInsightIds] = useState<Record<string, string[]>>({});
  const [expandedInsights, setExpandedInsights] = useState<Record<string, boolean>>({});
  // Saved cohorts (Cohort Builder, local-storage only — see loadSavedCohorts above)
  const [savedCohorts, setSavedCohorts] = useState<SavedCohort[]>([]);
  const [selectedCohortIds, setSelectedCohortIds] = useState<string[]>([]);
  // Guided deck: per-template, per-slide guide
  const [slideGuides, setSlideGuides] = useState<Record<string, SlideGuide[]>>({});
  const [expandedGuides, setExpandedGuides] = useState<Record<string, boolean>>({});
  // Selected template tab
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  useEffect(() => {
    getReportTemplates(orgId).then(t => { setTemplates(t); if (t.length > 0) setSelectedTemplateId(t[0].id); });
    getSavedInsights(orgId).then(setSavedInsights);
    setSavedCohorts(loadSavedCohorts(orgId));
    // Get brand colors
    import("@/app/actions/settings").then(({ getBrandSettings }) =>
      getBrandSettings(orgId).then(b => {
        if (b) {
          setBrandColors({ primary: b.primary_color, secondary: b.secondary_color, logoUrl: b.logo_url ?? null });
          setSlackWebhook(b.slack_webhook ?? "");
          // Theme now lives in Settings → Brand, not picked per-report here.
          setTheme(((b as BrandSettings & { design_theme?: string }).design_theme as DesignTheme) ?? "brand");
        }
      })
    );
  }, [orgId]);

  useEffect(() => {
    if (sourcesWithData.length > 0 && !selectedSourceId) setSelectedSourceId(sourcesWithData[0].source.id);
  }, [sourcesWithData, selectedSourceId]);

  const selected = sourcesWithData.find(s => s.source.id === selectedSourceId);
  const allSheetRows = selected?.rows ?? [];
  const sheetHeaders = selected?.headers ?? [];

  // Generate-tab-owned sheet month filter. Uses the same detection logic as
  // SheetViewer so the user can control exactly what data the AI sees, right
  // here, without going to the Data tab.
  const [sheetMonthFilter, setSheetMonthFilter] = useState<string>("");

  // Detect what months exist in the sheet (long or wide format)
  const sheetMonthOptions = useMemo((): string[] => {
    if (!allSheetRows.length || !sheetHeaders.length) return [];
    const wideMap = detectWideMonthColumns(sheetHeaders);
    if (wideMap) return [...wideMap.keys()];
    const longCol = detectLongMonthColumn(sheetHeaders, allSheetRows);
    if (longCol) {
      const seen = new Map<string, number>();
      allSheetRows.forEach(r => {
        const raw = r[longCol] ?? "";
        const entry = parseMonthEntry(raw);
        if (entry && !seen.has(raw)) seen.set(raw, entry.sortKey);
      });
      return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([v]) => v);
    }
    return [];
  }, [allSheetRows, sheetHeaders]);

  // Auto-default: when period or sheet options change, try to match period → sheet month
  useEffect(() => {
    if (!sheetMonthOptions.length) return;
    // Try to find a sheet month that matches the selected period string
    const periodLower = period.toLowerCase();
    const match = sheetMonthOptions.find(m => periodLower.includes(m.toLowerCase()) || m.toLowerCase().includes(periodLower.split(" ")[0]?.toLowerCase() ?? ""));
    setSheetMonthFilter(match ?? "");
  }, [period, sheetMonthOptions]);

  // Apply the month filter to produce effectiveRows for the AI
  const filteredRows = useMemo((): Record<string, string>[] => {
    if (!allSheetRows.length) return [];
    if (!sheetMonthFilter) return allSheetRows;
    const wideMap = detectWideMonthColumns(sheetHeaders);
    if (wideMap) {
      // Wide: keep only columns for the selected month
      const keepCols = new Set<string>();
      sheetHeaders.forEach(h => { if (!wideMap.has(h)) keepCols.add(h); }); // non-month cols always kept
      const monthCols = wideMap.get(sheetMonthFilter) ?? [];
      monthCols.forEach(c => keepCols.add(c));
      return allSheetRows.map(row => Object.fromEntries(Object.entries(row).filter(([k]) => keepCols.has(k))));
    }
    const longCol = detectLongMonthColumn(sheetHeaders, allSheetRows);
    if (longCol) {
      const filterKey = parseMonthEntry(sheetMonthFilter)?.sortKey;
      if (filterKey === undefined) return allSheetRows;
      return allSheetRows.filter(row => parseMonthEntry(row[longCol] ?? "")?.sortKey === filterKey);
    }
    return allSheetRows;
  }, [allSheetRows, sheetHeaders, sheetMonthFilter]);

  const totalRows = allSheetRows.length;
  const isFiltered = sheetMonthFilter !== "" && filteredRows.length !== totalRows;

  // A report can now be built from a saved cohort alone (no Goals/Features/
  // Funnels toggled and no sheet rows) — without this, picking only a cohort
  // would silently hit the same "nothing to report" gate that's meant for
  // when truly nothing is selected.
  const hasAnyDataSource = anyBiosSection || allSheetRows.length > 0 || selectedCohortIds.length > 0;

  const handlePlan = async (template: ReportTemplate) => {
    if (!hasAnyDataSource) return;
    setPlanStates(prev => ({ ...prev, [template.id]: { status: "planning" } }));
    try {
      // Build source config from ONLY the currently selected source — not
      // every source the org has ever configured. Previously this pulled in
      // every connected source with any saved config, so old/unrelated
      // sources' parameters and expected insights silently leaked into every
      // report's AI context regardless of what was actually picked above.
      const configs: SourceConfig[] = (() => {
        if (!selected) return [];
        const params = (selected.source.parameters as DataParameter[] | null) ?? [];
        const insights = (selected.source.expected_insights as string[] | null) ?? [];
        if (!selected.source.data_type && params.length === 0 && insights.length === 0) return [];
        return [{
          sourceId: selected.source.id,
          sourceName: selected.source.name,
          data_type: selected.source.data_type,
          parameters: params,
          expected_insights: insights,
        }];
      })();

      const templateGuides = (slideGuides[template.id] ?? []).filter(
        g => g.focus || (g.mustInclude && g.mustInclude.length > 0) || (g.chartType && g.chartType !== "auto")
      );

      // Fold any selected saved insights into the same free-text channel the
      // AI briefing notes already use — no need for planReport to know about
      // a separate "insights" concept.
      const pickedIds = selectedInsightIds[template.id] ?? [];
      const pickedInsights = savedInsights.filter(i => pickedIds.includes(i.id));
      const insightsBlock = pickedInsights.length > 0
        ? "Specifically include these previously-saved insights:\n" +
          pickedInsights.map(i => `- ${i.content}${i.context ? ` (${i.context})` : ""}`).join("\n")
        : "";

      // Saved cohorts only exist in this browser's local storage, so they
      // have to be computed here (client-side, where localStorage is
      // reachable) rather than inside planReport itself. Computed fresh on
      // every plan — this is the cohort's CURRENT state, not a stale snapshot
      // from whenever it was saved. Folded into the same free-text channel as
      // insights above, so planReport doesn't need to know cohorts exist.
      const pickedCohorts = savedCohorts.filter(c => selectedCohortIds.includes(c.id));
      const cohortLines = await Promise.all(pickedCohorts.map(async (c) => {
        const f = c.filter;
        if (f.eventName && f.secondEventName) {
          const res = await getCohortConversion(orgId, f);
          if (res.error) return `- "${c.name}": ${res.error}`;
          return `- "${c.name}": of ${res.firstEventUsers} users who did ${res.eventName}, ${res.convertedPct}% also did ${res.secondEventName} within ${res.withinDays} days.`;
        }
        if (f.eventName) {
          const data = await getCohortRetention(orgId, { eventName: f.eventName });
          const latest = data.rows[data.rows.length - 1];
          if (!latest) return `- "${c.name}": no current data for "${f.eventName}".`;
          const week1 = latest.retained[1] ?? 0;
          const pct = latest.totalUsers > 0 ? Math.round((week1 / latest.totalUsers) * 1000) / 10 : 0;
          return `- "${c.name}" (users who did "${f.eventName}"): most recent cohort week ${latest.cohortWeek}, ${latest.totalUsers} users, ${pct}% still active 1 week later.`;
        }
        return `- "${c.name}": ${f.description}`;
      }));
      const cohortsBlock = cohortLines.length > 0
        ? "Current state of these saved cohorts (real computed data, not a guess):\n" + cohortLines.join("\n")
        : "";

      const combinedNotes = [extraNotes[template.id], insightsBlock, cohortsBlock].filter(Boolean).join("\n\n");

      const res = await planReport(
        orgId,
        template.id,
        includeSheet ? filteredRows : [],
        period,
        combinedNotes || undefined,
        anyBiosSection ? biosSections : undefined,
        configs.length > 0 ? configs : undefined,
        templateGuides.length > 0 ? templateGuides : undefined
      );
      if (!res || res.error || !res.deck) {
        setPlanStates(prev => ({ ...prev, [template.id]: { status: "error", error: res?.error ?? "Planning failed — check console for details" } }));
      } else {
        setPlanStates(prev => ({ ...prev, [template.id]: { status: "ready", deck: res.deck!, tokensUsed: res.tokensUsed } }));
        setTotalTokens(t => t + res.tokensUsed);
      }
    } catch (err) {
      console.error("[handlePlan]", err);
      setPlanStates(prev => ({ ...prev, [template.id]: { status: "error", error: (err as Error)?.message ?? "Unexpected error" } }));
    }
  };

  const previewState = activePreview ? planStates[activePreview.templateId] : null;


  // Build period options list (shared by the period picker below)
  const periodOptions = (() => {
    const now = new Date();
    const month = (offset: number) => {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      return { name: d.toLocaleString("default", { month: "long" }), year: d.getFullYear() };
    };
    const months = Array.from({ length: 13 }, (_, i) => month(-i));
    const fmt = (m: ReturnType<typeof month>) => `${m.name} ${m.year}`;
    const opts: { label: string; value: string }[] = [];
    months.slice(0, 7).forEach(m => opts.push({ label: fmt(m), value: fmt(m) }));
    opts.push({ label: "──────────", value: "" });
    for (let i = 0; i < 6; i++) {
      const end = months[i], start = months[i + 1];
      opts.push({ label: start.year === end.year ? `${start.name} – ${end.name} ${end.year}` : `${start.name} ${start.year} – ${end.name} ${end.year}`, value: start.year === end.year ? `${start.name} – ${end.name} ${end.year}` : `${start.name} ${start.year} – ${end.name} ${end.year}` });
    }
    opts.push({ label: "──────────", value: "" });
    for (let i = 0; i < 4; i++) {
      const end = months[i], start = months[i + 2];
      opts.push({ label: start.year === end.year ? `${start.name} – ${end.name} ${end.year}` : `${start.name} ${start.year} – ${end.name} ${end.year}`, value: start.year === end.year ? `${start.name} – ${end.name} ${end.year}` : `${start.name} ${start.year} – ${end.name} ${end.year}` });
    }
    opts.push({ label: "──────────", value: "" });
    const curQ = Math.floor(now.getMonth() / 3) + 1;
    for (let q = curQ; q >= 1; q--) opts.push({ label: `Q${q} ${now.getFullYear()}`, value: `Q${q} ${now.getFullYear()}` });
    for (let q = 4; q >= 1; q--) opts.push({ label: `Q${q} ${now.getFullYear() - 1}`, value: `Q${q} ${now.getFullYear() - 1}` });
    opts.push({ label: "──────────", value: "" });
    opts.push({ label: "Custom…", value: "__custom__" });
    return opts;
  })();

  // Each section pill maps to one key — they're individually toggleable.
  // "Full Review" is a convenience shortcut that selects/deselects all four.
  const SCOPE_PILLS = [
    { label: "Goals",           key: "goals"       as keyof BiosSections },
    { label: "Feature Metrics", key: "features"    as keyof BiosSections },
    { label: "Insights & KPIs", key: "funnelsKpis" as keyof BiosSections },
    { label: "User Journeys",   key: "funnels"     as keyof BiosSections },
  ];
  const allSelected = SCOPE_PILLS.every(p => biosSections[p.key]);

  // Derived from selectedTemplateId — used by the Step 3 CTA so the Plan button
  // doesn't have to live buried inside the template panel.
  const activeTemplate = selectedTemplateId ? (templates.find(t => t.id === selectedTemplateId) ?? null) : null;
  const activePs: PlanState = selectedTemplateId ? (planStates[selectedTemplateId] ?? { status: "idle" }) : { status: "idle" };

  return (
    <div className="space-y-6 max-w-2xl">

      {/* ── Step 1: Setup ──────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2.5 mb-2.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">1</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Setup</span>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">

        {/* Period */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap w-14 flex-shrink-0">Period</span>
          {customPeriod ? (
            <div className="flex items-center gap-1.5 flex-1">
              <input
                autoFocus
                value={period}
                onChange={e => setPeriod(e.target.value)}
                placeholder="e.g. H1 2026"
                className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <button onClick={() => setCustomPeriod(false)} className="text-xs text-gray-400 hover:text-gray-600 whitespace-nowrap">← Back</button>
            </div>
          ) : (
            <select
              value={periodOptions.find(o => o.value === period) ? period : "__custom__"}
              onChange={e => { if (e.target.value === "__custom__") { setCustomPeriod(true); return; } if (!e.target.value) return; setPeriod(e.target.value); }}
              className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
            >
              {periodOptions.map((o, i) => <option key={i} value={o.value} disabled={!o.value}>{o.label}</option>)}
            </select>
          )}
          {totalTokens > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 px-2 py-1 rounded-full whitespace-nowrap flex-shrink-0">
              <Coins size={10} />{totalTokens.toLocaleString()} tokens
            </span>
          )}
        </div>

        {/* Sheet data — toggle + source picker + month filter */}
        {sourcesWithData.length > 0 && (
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap w-14 flex-shrink-0">Sheet</span>
              {/* Include toggle */}
              <button
                type="button"
                onClick={() => setIncludeSheet(v => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${includeSheet ? "bg-indigo-500" : "bg-gray-300"}`}>
                <span className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
                  style={{ transform: includeSheet ? "translateX(18px)" : "translateX(2px)" }} />
              </button>
              {/* Source picker */}
              <select value={selectedSourceId} onChange={e => setSelectedSourceId(e.target.value)}
                disabled={!includeSheet}
                className={`flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white transition-opacity ${!includeSheet ? "opacity-40 cursor-not-allowed" : ""}`}>
                <option value="">— None —</option>
                {sourcesWithData.map(s => <option key={s.source.id} value={s.source.id}>{s.source.name}</option>)}
              </select>
              {/* Month filter — only show when sheet has month data */}
              {includeSheet && selectedSourceId && sheetMonthOptions.length >= 2 && (
                <select value={sheetMonthFilter} onChange={e => setSheetMonthFilter(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white flex-shrink-0">
                  <option value="">All months</option>
                  {sheetMonthOptions.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
              {/* Row count */}
              {selectedSourceId && includeSheet && (
                <span className={`text-[10px] whitespace-nowrap flex-shrink-0 flex items-center gap-1 ${isFiltered ? "text-indigo-600 font-medium" : "text-gray-400"}`}>
                  <Filter size={9} />{filteredRows.length} / {totalRows} rows
                </span>
              )}
            </div>
            {/* Context line */}
            <p className="mt-1.5 ml-[4.25rem] text-[10px] leading-snug text-gray-400">
              {includeSheet
                ? sheetMonthFilter
                  ? `Sending ${filteredRows.length} rows for ${sheetMonthFilter} to AI. Change the month filter above to control what data the AI sees.`
                  : `Sending all ${totalRows} rows to AI. Use the month filter above to narrow to a specific period.`
                : "Sheet data won't be sent to the AI — report will draw only from your Goals, Features & KPI data."}
            </p>
          </div>
        )}

        {/* Scope pills — multi-select, each toggles its own section */}
        <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap mr-1">Scope</span>
          {/* "All" shortcut */}
          <button type="button"
            onClick={() => setBiosSections({ goals: !allSelected, features: !allSelected, funnelsKpis: !allSelected, funnels: !allSelected })}
            className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
              allSelected ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-600"
            }`}>
            All
          </button>
          <span className="w-px h-4 bg-gray-200 flex-shrink-0" />
          {SCOPE_PILLS.map(({ label, key }) => {
            const isActive = !!biosSections[key];
            return (
              <button key={key} type="button"
                onClick={() => setBiosSections(prev => ({ ...prev, [key]: !prev[key] }))}
                className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
                  isActive ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-600"
                }`}>
                {label}
              </button>
            );
          })}
          {!hasAnyDataSource && (
            <span className="text-[11px] text-red-500 font-medium ml-auto">Select at least one</span>
          )}
        </div>

        {/* Cohorts — only shown when any are saved */}
        {savedCohorts.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 border-t border-gray-100 flex-wrap">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap w-14 flex-shrink-0">Cohorts</span>
            {savedCohorts.map(c => {
              const checked = selectedCohortIds.includes(c.id);
              return (
                <button key={c.id} type="button" title={c.filter.description}
                  onClick={() => setSelectedCohortIds(prev => checked ? prev.filter(id => id !== c.id) : [...prev, c.id])}
                  className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors max-w-[180px] truncate ${
                    checked ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}>
                  {checked ? <CheckCircle2 size={11} /> : <Bookmark size={10} />}
                  <span className="truncate">{c.name}</span>
                </button>
              );
            })}
          </div>
        )}
        </div>{/* end Setup card */}
      </div>{/* end Step 1 */}

      {/* ── Step 2: Template ───────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2.5 mb-2.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">2</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Template</span>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {templates.length === 0 ? (
            <p className="text-sm text-gray-400 p-4">No templates. Add some in Settings.</p>
          ) : (
            <>
              {/* Template pill tabs */}
              <div className="flex flex-wrap gap-2 p-4 border-b border-gray-100">
                {templates.map(t => {
                  const ps = planStates[t.id] ?? { status: "idle" };
                  const isSelected = selectedTemplateId === t.id;
                  return (
                    <button key={t.id} onClick={() => setSelectedTemplateId(t.id)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                        isSelected
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-700 bg-white"
                      }`}>
                      {t.name}
                      {ps.status === "ready" && <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />}
                      {ps.status === "planning" && <Loader2 size={10} className="animate-spin flex-shrink-0" />}
                      {ps.status === "error" && <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {/* Selected template panel — description + optional extras. CTA moved to Step 3. */}
              {activeTemplate && (() => {
                const t = activeTemplate;
                return (
                  <div>
                    {/* Description strip */}
                    <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">
                      <p className="text-xs text-gray-500 leading-relaxed flex-1">{t.instructions.slice(0, 130)}…</p>
                      <span className="text-[11px] text-gray-400 flex-shrink-0">{t.slide_hint} slides</span>
                    </div>

                  {/* AI Briefing Notes */}
                  <div className="border-t border-gray-100">
                    <button
                      onClick={() => setExpandedNotes(prev => ({ ...prev, [t.id]: !prev[t.id] }))}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-indigo-50/60 transition-colors group">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-lg bg-indigo-100 group-hover:bg-indigo-200 flex items-center justify-center flex-shrink-0 transition-colors">
                          <BookOpen size={13} className="text-indigo-600" />
                        </div>
                        <div className="text-left">
                          <p className="text-xs font-semibold text-gray-700">AI Briefing Notes</p>
                          <p className="text-[11px] text-gray-400 leading-tight">Context, audience, and focus to send to the AI</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {extraNotes[t.id]
                          ? <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">Notes added</span>
                          : <span className="text-[10px] text-gray-400">Optional</span>}
                        <ChevronDown size={13} className={`text-gray-400 transition-transform ${expandedNotes[t.id] ? "rotate-180" : ""}`} />
                      </div>
                    </button>
                    {expandedNotes[t.id] && (
                      <div className="px-4 pb-4 border-t border-gray-100">
                        <textarea
                          value={extraNotes[t.id] ?? ""}
                          onChange={e => setExtraNotes(prev => ({ ...prev, [t.id]: e.target.value }))}
                          placeholder={`E.g. "Focus on Q2 churn drivers. Include a slide on new feature adoption. Highlight the 40% DAU drop in Week 3. Executive audience — no jargon."`}
                          rows={3}
                          className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2.5 mt-3 text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none leading-relaxed"
                        />
                        <p className="text-[11px] text-gray-400 mt-1.5">Sent to the AI alongside your data — does not affect build cost.</p>
                      </div>
                    )}
                  </div>

                  {/* Saved insights picker */}
                  <div className="border-t border-gray-100">
                    <button
                      onClick={() => setExpandedInsights(prev => ({ ...prev, [t.id]: !prev[t.id] }))}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-50/60 transition-colors group">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-lg bg-amber-100 group-hover:bg-amber-200 flex items-center justify-center flex-shrink-0 transition-colors">
                          <Bookmark size={13} className="text-amber-600" />
                        </div>
                        <div className="text-left">
                          <p className="text-xs font-semibold text-gray-700">Saved Insights</p>
                          <p className="text-[11px] text-gray-400 leading-tight">Pick from insights you've saved across the app</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {(selectedInsightIds[t.id]?.length ?? 0) > 0
                          ? <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">{selectedInsightIds[t.id]!.length} selected</span>
                          : savedInsights.length > 0
                            ? <span className="text-[10px] text-gray-400">Optional</span>
                            : <span className="text-[10px] text-gray-400">None saved yet</span>}
                        <ChevronDown size={13} className={`text-gray-400 transition-transform ${expandedInsights[t.id] ? "rotate-180" : ""}`} />
                      </div>
                    </button>
                    {expandedInsights[t.id] && (
                      <div className="px-4 pb-4 border-t border-gray-100 mt-3 space-y-1.5 max-h-64 overflow-y-auto">
                        {savedInsights.length === 0 ? (
                          <p className="text-xs text-gray-400 leading-relaxed py-2">
                            Nothing saved yet. Look for the "Save for report" button under any AI insight — on Cohorts, AI Analyst, or your dashboard's Business Brief — to pin it here.
                          </p>
                        ) : (
                          savedInsights.map(ins => {
                            const checked = (selectedInsightIds[t.id] ?? []).includes(ins.id);
                            const sourceLabel = ins.source === "ai_analyst" ? "AI Analyst" : ins.source === "business_brief" ? "Business Brief" : ins.source === "cohort" ? "Cohort" : ins.source === "funnel" ? "Funnel" : ins.source;
                            return (
                              <label key={ins.id} className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${checked ? "border-amber-300 bg-amber-50/60" : "border-gray-100 hover:bg-gray-50"}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => setSelectedInsightIds(prev => {
                                    const current = prev[t.id] ?? [];
                                    return { ...prev, [t.id]: checked ? current.filter(id => id !== ins.id) : [...current, ins.id] };
                                  })}
                                  className="mt-0.5 accent-amber-600"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full flex-shrink-0">{sourceLabel}</span>
                                    {ins.context && <span className="text-[10px] text-gray-400 truncate">{ins.context}</span>}
                                  </div>
                                  {/* Strip any leftover markdown emphasis/heading/list syntax — this is a
                                      plain-text preview, not a markdown renderer, so raw "**"/"#"/"-" would
                                      otherwise show up as literal characters. */}
                                  <p className="text-xs text-gray-700 leading-relaxed mt-1 line-clamp-3">{ins.content.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").replace(/^[-*]\s+/gm, "")}</p>
                                </div>
                              </label>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>

                  {/* Slide Guide */}
                  {(() => {
                    const guides = slideGuides[t.id] ?? [];
                    const hasGuides = guides.some(g => g.focus || (g.mustInclude && g.mustInclude.length > 0) || (g.chartType && g.chartType !== "auto"));
                    const paramOptions = (selected?.source.parameters as DataParameter[] | null ?? []).map(p => p.name);
                    const insightOptions = (selected?.source.expected_insights as string[] | null ?? []);
                    const allOptions = [...paramOptions, ...insightOptions];
                    const innerSlides = Math.max(0, t.slide_hint - 2);

                    const setGuide = (slideIndex: number, patch: Partial<SlideGuide>) => {
                      setSlideGuides(prev => {
                        const existing = prev[t.id] ?? [];
                        const idx = existing.findIndex(g => g.slideIndex === slideIndex);
                        if (idx >= 0) {
                          const updated = [...existing];
                          updated[idx] = { ...updated[idx], ...patch };
                          return { ...prev, [t.id]: updated };
                        }
                        return { ...prev, [t.id]: [...existing, { slideIndex, ...patch }] };
                      });
                    };

                    const toggleMustInclude = (slideIndex: number, item: string) => {
                      const guide = guides.find(g => g.slideIndex === slideIndex);
                      const current = guide?.mustInclude ?? [];
                      const next = current.includes(item) ? current.filter(x => x !== item) : [...current, item];
                      setGuide(slideIndex, { mustInclude: next });
                    };

                    // Pre-fill defaults for all inner slides when expanding
                    const handleToggleGuide = () => {
                      const opening = !expandedGuides[t.id];
                      setExpandedGuides(prev => ({ ...prev, [t.id]: opening }));
                      if (opening && innerSlides > 0) {
                        setSlideGuides(prev => {
                          const existing = prev[t.id] ?? [];
                          let changed = false;
                          const next = [...existing];
                          for (let si = 2; si <= t.slide_hint - 1; si++) {
                            const has = existing.find(g => g.slideIndex === si);
                            if (!has) {
                              next.push({ slideIndex: si, focus: getDefaultFocus(si, t.slide_hint) });
                              changed = true;
                            } else if (!has.focus) {
                              const idx2 = next.findIndex(g => g.slideIndex === si);
                              next[idx2] = { ...next[idx2], focus: getDefaultFocus(si, t.slide_hint) };
                              changed = true;
                            }
                          }
                          return changed ? { ...prev, [t.id]: next } : prev;
                        });
                      }
                    };

                    return (
                      <div className="border-t border-gray-100">
                        <button
                          onClick={handleToggleGuide}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-violet-50/60 transition-colors group">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-lg bg-violet-100 group-hover:bg-violet-200 flex items-center justify-center flex-shrink-0 transition-colors">
                              <ListOrdered size={13} className="text-violet-600" />
                            </div>
                            <div className="text-left">
                              <p className="text-xs font-semibold text-gray-700">Slide Guide</p>
                              <p className="text-[11px] text-gray-400 leading-tight">Set what each slide covers and which chart type to use</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {hasGuides
                              ? <span className="text-[10px] font-semibold text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full">Guide active</span>
                              : <span className="text-[10px] text-gray-400">Optional</span>}
                            <ChevronDown size={13} className={`text-gray-400 transition-transform ${expandedGuides[t.id] ? "rotate-180" : ""}`} />
                          </div>
                        </button>

                        {expandedGuides[t.id] && (
                          <div className="px-4 pb-3 border-t border-gray-100">
                            {innerSlides === 0 ? (
                              <p className="text-xs text-gray-400 italic">This template only has {t.slide_hint} slides — cover and closing are fixed.</p>
                            ) : (
                              Array.from({ length: innerSlides }, (_, i) => {
                                const slideIndex = i + 2;
                                const guide = guides.find(g => g.slideIndex === slideIndex);
                                const mustInclude = guide?.mustInclude ?? [];
                                const selectedChart = guide?.chartType ?? "auto";
                                const chartConfig = CHART_CONFIGS.find(c => c.id === selectedChart) ?? CHART_CONFIGS[0];

                                return (
                                  <div key={slideIndex} className={`py-3.5 space-y-2.5 ${i > 0 ? "border-t border-gray-100" : ""}`}>
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Slide {slideIndex}</span>

                                    {/* Focus text — pre-filled, editable */}
                                    <input
                                      type="text"
                                      value={guide?.focus ?? ""}
                                      onChange={e => setGuide(slideIndex, { slideIndex, focus: e.target.value })}
                                      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 text-gray-700"
                                    />

                                    {/* Chart type + preview side by side */}
                                    <div className="flex gap-3">
                                      {/* Type buttons */}
                                      <div className="flex-1">
                                        <p className="text-[10px] text-gray-400 mb-2 font-semibold uppercase tracking-wider">Chart type</p>
                                        <div className="flex flex-wrap gap-1.5">
                                          {CHART_CONFIGS.map(ct => {
                                            const isSel = selectedChart === ct.id;
                                            return (
                                              <button
                                                key={ct.id}
                                                onClick={() => setGuide(slideIndex, { slideIndex, chartType: ct.id })}
                                                className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all ${
                                                  isSel
                                                    ? "border-violet-500 bg-violet-600 text-white font-semibold shadow-sm"
                                                    : "border-gray-200 text-gray-500 hover:border-violet-300 hover:text-violet-600 bg-white"
                                                }`}>
                                                {ct.label}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                      {/* Preview panel */}
                                      <div className="w-32 flex-shrink-0">
                                        <p className="text-[10px] text-gray-400 mb-2 font-semibold uppercase tracking-wider">Preview</p>
                                        <div className="border border-violet-100 bg-violet-50/60 rounded-lg p-1.5">
                                          <div className="w-full">{chartConfig.preview}</div>
                                          <p className="text-[9px] text-violet-500 text-center mt-1 leading-tight">{chartConfig.desc}</p>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Must include pills */}
                                    {allOptions.length > 0 && (
                                      <div>
                                        <p className="text-[10px] text-gray-400 mb-1.5 font-semibold uppercase tracking-wider">Must include</p>
                                        <div className="flex flex-wrap gap-1.5">
                                          {allOptions.map(opt => {
                                            const isParam = paramOptions.includes(opt);
                                            const sel = mustInclude.includes(opt);
                                            return (
                                              <button
                                                key={opt}
                                                onClick={() => toggleMustInclude(slideIndex, opt)}
                                                className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border transition-all ${
                                                  sel
                                                    ? "border-violet-400 bg-violet-50 text-violet-700 font-medium"
                                                    : "border-gray-200 text-gray-500 hover:border-violet-300 hover:text-violet-600"
                                                }`}>
                                                {isParam ? <SlidersHorizontal size={9} /> : <Target size={9} />}
                                                {opt.length > 26 ? opt.slice(0, 26) + "…" : opt}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                </div>
              );
            })()}
          </>
        )}
        </div>
      </div>{/* end Step 2 */}

      {/* ── Step 3: Generate ───────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2.5 mb-2.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">3</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Generate</span>
        </div>

        <div className="space-y-2.5">
          {/* Result banner — shown when planning has completed */}
          {activePs.status === "ready" && activePs.deck && (
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
              <span className="text-sm text-green-700 flex-1">
                {activePs.deck.slides.length} slides ready · {activePs.tokensUsed?.toLocaleString()} tokens used
              </span>
              <button
                onClick={() => activeTemplate && setActivePreview({ templateId: activeTemplate.id, templateName: activeTemplate.name })}
                className="flex items-center gap-1.5 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 px-4 py-1.5 rounded-lg transition-colors flex-shrink-0"
              >
                <Eye size={13} /> Preview &amp; Share
              </button>
            </div>
          )}
          {activePs.status === "error" && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <XCircle size={14} className="text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-600 truncate">{activePs.error}</p>
            </div>
          )}

          {/* Primary CTA */}
          <button
            onClick={() => activeTemplate && handlePlan(activeTemplate)}
            disabled={!hasAnyDataSource || activePs.status === "planning" || !activeTemplate}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
          >
            {activePs.status === "planning"
              ? <><Loader2 size={15} className="animate-spin" /> Planning deck…</>
              : activePs.status === "ready"
              ? <><RefreshCw size={15} /> Re-plan with AI</>
              : <><Sparkles size={15} /> Plan Deck with AI</>}
          </button>
        </div>
      </div>{/* end Step 3 */}

      {/* Preview modal */}
      {activePreview && previewState?.status === "ready" && previewState.deck && (
        <PreviewModal
          deck={previewState.deck}
          templateName={activePreview.templateName}
          templateId={activePreview.templateId}
          period={period}
          orgId={orgId}
          theme={theme}
          brand={brandColors}
          slackWebhook={slackWebhook}
          tokensUsed={previewState.tokensUsed ?? 0}
          onClose={() => setActivePreview(null)}
          onBuilt={() => { onGenerated(); }}
        />
      )}
    </div>
  );
}

// ─── History tab ──────────────────────────────────────────────────────────────

function CopyLinkButton({ url, label = "Copy Link" }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };
  return (
    <button onClick={handleCopy}
      className="flex items-center gap-1.5 text-xs font-medium text-gray-500 bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-lg transition-colors">
      {copied ? <><CheckCircle2 size={12} className="text-green-500" /> Copied!</> : <><ExternalLink size={12} /> {label}</>}
    </button>
  );
}

function HistoryTab({ orgId, refresh }: { orgId: string; refresh: number }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [reviews, setReviews] = useState<Awaited<ReturnType<typeof getOrgReviewSessions>>>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [historyPreview, setHistoryPreview] = useState<{
    deck: SlidesDeck; templateName: string; templateId: string; period: string;
    brand: { primary: string; secondary: string; logoUrl?: string | null };
    // Only set when reopening an already-shared deck — lets the access-control
    // card in PreviewModal show the link's real saved settings instead of
    // resetting to "never expires / not private".
    reviewId?: string; shareUrl?: string;
    initialAccess?: { isPrivate: boolean; expiresAt: string | null };
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
  const [brand, setBrand] = useState<{ primary: string; secondary: string; logoUrl?: string | null }>({ primary: "#6366f1", secondary: "#a5b4fc", logoUrl: null });
  const [slackWebhookHistory, setSlackWebhookHistory] = useState("");

  useEffect(() => {
    import("@/app/actions/settings").then(({ getBrandSettings }) =>
      getBrandSettings(orgId).then(b => {
        if (b) {
          setBrand({ primary: b.primary_color, secondary: b.secondary_color, logoUrl: b.logo_url ?? null });
          setSlackWebhookHistory(b.slack_webhook ?? "");
        }
      })
    );
  }, [orgId]);

  const openReportPreview = (r: Report) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deck = (r as any).deck_json as SlidesDeck | null;
    if (!deck) return;
    setHistoryPreview({ deck, templateName: r.template_name, templateId: r.template_id ?? "", period: r.period, brand });
  };

  // Reopening a previously-shared deck — uses the owner-authenticated lookup
  // (not the public, access-gated one used by the /review/[token] page
  // itself) so a private or expired link can still be reopened and its
  // settings changed, rather than silently failing to load anything.
  const openReviewPreview = async (rv: { id: string; share_token: string; deck_title: string; period: string }) => {
    setLoadingPreview(rv.share_token);
    const { review } = await getReviewSessionForOwner(rv.id);
    setLoadingPreview(null);
    if (!review) return;
    setHistoryPreview({
      deck: review.deck,
      templateName: rv.deck_title,
      templateId: "",
      period: rv.period,
      brand: review.brand,
      reviewId: review.id,
      shareUrl: `${window.location.origin}/review/${review.share_token}`,
      initialAccess: { isPrivate: review.is_private, expiresAt: review.expires_at },
    });
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getReports(orgId),
      getOrgReviewSessions(orgId),
    ]).then(([r, rv]) => { setReports(r); setReviews(rv); setLoading(false); });
  }, [orgId, refresh]);

  const handleDeleteReport = async (id: string) => {
    if (!confirm("Delete this report? This cannot be undone.")) return;
    setDeleting(id);
    await deleteReport(id);
    setReports(prev => prev.filter(r => r.id !== id));
    setDeleting(null);
  };

  const handleDeleteReview = async (id: string) => {
    if (!confirm("Delete this shared preview and all its comments? This cannot be undone.")) return;
    setDeleting(id);
    await deleteReviewSession(id);
    setReviews(prev => prev.filter(r => r.id !== id));
    setDeleting(null);
  };

  const totalTokens = reports.reduce((s, r) => s + (r.tokens_used ?? 0), 0);
  const estimatedCost = (totalTokens / 1_000_000) * 0.25;

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-indigo-400" /></div>;

  const hasAnything = reports.length > 0 || reviews.length > 0;
  if (!hasAnything) return (
    <div className="text-center py-16 text-gray-400">
      <History size={32} className="mx-auto mb-3 opacity-40" />
      <p className="text-sm">No reports yet. Plan &amp; preview on the Generate tab.</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Credit summary */}
      {reports.length > 0 && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-5 py-3 flex items-center gap-6 flex-wrap">
          <div>
            <p className="text-xs text-indigo-400 mb-0.5">Total tokens used</p>
            <p className="text-lg font-bold text-indigo-700">{totalTokens.toLocaleString()}</p>
          </div>
          <div className="w-px h-8 bg-indigo-200" />
          <div>
            <p className="text-xs text-indigo-400 mb-0.5">Estimated AI cost</p>
            <p className="text-lg font-bold text-indigo-700">${estimatedCost < 0.01 ? "<$0.01" : estimatedCost.toFixed(3)}</p>
          </div>
          <div className="w-px h-8 bg-indigo-200" />
          <div>
            <p className="text-xs text-indigo-400 mb-0.5">Reports generated</p>
            <p className="text-lg font-bold text-indigo-700">{reports.filter(r => r.status === "done").length}</p>
          </div>
          {reviews.length > 0 && <>
            <div className="w-px h-8 bg-indigo-200" />
            <div>
              <p className="text-xs text-indigo-400 mb-0.5">Shared for review</p>
              <p className="text-lg font-bold text-indigo-700">{reviews.length}</p>
            </div>
          </>}
        </div>
      )}

      {/* Generated PPTX reports */}
      {reports.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">Generated Reports</p>
          {reports.map(r => (
            <div key={r.id} className="bg-white border border-gray-200 rounded-xl px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <FileText size={16} className="text-indigo-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-800">{r.template_name}</p>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{r.period} · {timeAgo(r.created_at)}</p>
                    {r.error && <p className="text-xs text-red-400 mt-0.5">{r.error}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {(r as any).deck_json && (
                    <button onClick={() => openReportPreview(r)}
                      className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors">
                      <Eye size={12} /> Preview
                    </button>
                  )}
                  {r.file_url && r.status === "done" && <CopyLinkButton url={r.file_url} />}
                  {r.file_url && r.status === "done" && (
                    <a href={r.file_url} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-lg transition-colors">
                      <Download size={13} /> PPTX
                    </a>
                  )}
                  <button onClick={() => handleDeleteReport(r.id)} disabled={deleting === r.id}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors">
                    {deleting === r.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
              {(r.tokens_used > 0 || r.slides_count > 0) && (
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-50 flex-wrap">
                  {r.slides_count > 0 && <span className="flex items-center gap-1 text-xs text-gray-400"><LayoutTemplate size={11} /> {r.slides_count} slides</span>}
                  {r.tokens_used > 0 && <span className="flex items-center gap-1 text-xs text-gray-400"><Coins size={11} /> {r.tokens_used.toLocaleString()} tokens</span>}
                  {r.tokens_used > 0 && <span className="text-xs text-gray-400">≈ ${((r.tokens_used / 1_000_000) * 0.25).toFixed(4)} AI cost</span>}
                  {r.ai_model && <span className="ml-auto text-xs text-gray-300">{r.ai_model}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Shared review sessions */}
      {historyPreview && (
        <PreviewModal
          deck={historyPreview.deck}
          templateName={historyPreview.templateName}
          templateId={historyPreview.templateId}
          period={historyPreview.period}
          orgId={orgId}
          theme="brand"
          brand={historyPreview.brand}
          slackWebhook={slackWebhookHistory}
          tokensUsed={0}
          initialReviewId={historyPreview.reviewId}
          initialShareUrl={historyPreview.shareUrl}
          initialAccess={historyPreview.initialAccess}
          onClose={() => setHistoryPreview(null)}
          onBuilt={() => { /* keep modal open so user sees Download PPTX button */ }}
        />
      )}

      {reviews.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">Shared Previews</p>
          {reviews.map(rv => {
            const reviewUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/review/${rv.share_token}`;
            return (
              <div key={rv.id} className="bg-white border border-gray-200 rounded-xl px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <MessageSquare size={16} className="text-amber-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-800">{rv.deck_title}</p>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${rv.status === "open" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {rv.status}
                        </span>
                        {rv.comment_count > 0 && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                            {rv.comment_count} comment{rv.comment_count !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{rv.period} · Shared {timeAgo(rv.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => openReviewPreview(rv)}
                      disabled={loadingPreview === rv.share_token}
                      className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                      {loadingPreview === rv.share_token ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} Preview
                    </button>
                    <CopyLinkButton url={reviewUrl} label="Copy link" />
                    <a href={reviewUrl} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 text-xs font-medium text-amber-600 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-lg transition-colors">
                      <ExternalLink size={13} /> Open
                    </a>
                    <button onClick={() => handleDeleteReview(rv.id)} disabled={deleting === rv.id}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors">
                      {deleting === rv.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: "data", label: "Data", icon: <Table size={14} /> },
  { id: "generate", label: "Generate", icon: <Zap size={14} /> },
  { id: "history", label: "History", icon: <History size={14} /> },
] as const;
type TabId = typeof TABS[number]["id"];

export default function ReportsPage() {
  const { currentOrg } = useOrg();
  const [tab, setTab] = useState<TabId>("data");
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [sourcesWithData, setSourcesWithData] = useState<SourceWithData[]>([]);
  const [flagChecked, setFlagChecked] = useState(true);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    getMyOrgFlags()
      .then(f => { setLocked(!f.reports_enabled); setFlagChecked(true); })
      .catch(() => { setLocked(false); setFlagChecked(true); });
  }, []);

  if (!currentOrg) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Select an organisation to view reports.</div>;
  if (!flagChecked) return null;
  if (locked) return <LockedFeature name="Reports" />;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <LayoutTemplate size={22} className="text-indigo-500" /> Reports
        </h1>
        <p className="text-sm text-gray-500 mt-1">Connect your sheet → filter by period → preview slides → build PPTX.</p>
      </div>

      <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 mb-6 w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-white text-indigo-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "data" && <DataSourcesTab orgId={currentOrg.id} onDataReady={setSourcesWithData} />}
      {tab === "generate" && <GenerateTab orgId={currentOrg.id} sourcesWithData={sourcesWithData} onGenerated={() => setHistoryRefresh(n => n + 1)} />}
      {tab === "history" && <HistoryTab orgId={currentOrg.id} refresh={historyRefresh} />}
    </div>
  );
}
