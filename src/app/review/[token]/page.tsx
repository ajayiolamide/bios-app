"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getReviewSession, addSlideComment } from "@/app/actions/review";
import type { SlidesDeck, SlideContent } from "@/app/actions/reports";
import type { SlideComment } from "@/app/actions/review";
import {
  ChevronLeft, ChevronRight, MessageSquare, Send, CheckCircle2,
  Loader2, AlertCircle, ArrowLeft, ArrowRight,
} from "lucide-react";
import { use } from "react";

// ─── SlideCard (full copy — no layout imports needed) ─────────────────────────

function SlideCard({ slide, brand, deckTitle }: {
  slide: SlideContent;
  brand: { primary: string; secondary: string };
  deckTitle: string;
}) {
  const p = brand.primary;

  if (slide.type === "title") return (
    <div className="w-full h-full flex flex-col justify-end px-10 py-9 relative overflow-hidden" style={{ background: p }}>
      <div className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: "repeating-linear-gradient(0deg,#fff 0,#fff 1px,transparent 1px,transparent 40px),repeating-linear-gradient(90deg,#fff 0,#fff 1px,transparent 1px,transparent 40px)" }} />
      <div className="relative">
        <p className="text-white/50 text-[11px] tracking-widest uppercase mb-4">{deckTitle}</p>
        <h1 className="text-white font-black leading-tight mb-3" style={{ fontSize: "clamp(20px,3.5vw,32px)", letterSpacing: "-0.02em" }}>{slide.headline}</h1>
        <div className="h-px w-12 bg-white/40 mb-3" />
        <p className="text-white/70 text-sm leading-relaxed">{slide.subtitle}</p>
      </div>
    </div>
  );

  if (slide.type === "closing") return (
    <div className="w-full h-full flex flex-col items-center justify-center px-10 py-9 relative overflow-hidden" style={{ background: p }}>
      <div className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: "repeating-linear-gradient(0deg,#fff 0,#fff 1px,transparent 1px,transparent 40px),repeating-linear-gradient(90deg,#fff 0,#fff 1px,transparent 1px,transparent 40px)" }} />
      <div className="relative text-center">
        <h1 className="text-white font-black mb-3" style={{ fontSize: "clamp(20px,3.5vw,32px)", letterSpacing: "-0.02em" }}>{slide.headline}</h1>
        <div className="h-px w-12 bg-white/40 mx-auto mb-3" />
        <p className="text-white/70 text-sm">{slide.subtitle}</p>
        <p className="mt-10 text-white/30 text-[11px] tracking-widest uppercase">{deckTitle}</p>
      </div>
    </div>
  );

  const W = ({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) => (
    <div className="w-full h-full bg-white flex flex-col overflow-hidden">
      <div className="px-8 pt-7 pb-5 flex-shrink-0 border-b border-gray-100">
        <h2 className="font-black text-gray-900 leading-tight" style={{ fontSize: "clamp(13px,2vw,18px)", letterSpacing: "-0.02em" }}>{title}</h2>
        {subtitle && <p className="text-gray-400 mt-1 text-xs">{subtitle}</p>}
      </div>
      <div className="flex-1 px-8 py-5 overflow-hidden">{children}</div>
      <div className="px-8 pb-3 flex items-center gap-1.5 flex-shrink-0">
        <div className="w-2 h-2 rounded-full" style={{ background: p }} />
        <p className="text-[10px] text-gray-300 tracking-wider uppercase">{deckTitle}</p>
      </div>
    </div>
  );

  if (slide.type === "big_stat") {
    const up = slide.change_direction === "up", dn = slide.change_direction === "down";
    const changeColor = up ? "#16A34A" : dn ? "#DC2626" : "#94A3B8";
    const arrow = up ? "↑" : dn ? "↓" : "→";
    return (
      <div className="w-full h-full bg-white flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center px-10 gap-3">
          <p className="text-xs text-gray-400 uppercase tracking-widest text-center">{slide.label}</p>
          <p className="font-black leading-none text-center" style={{ fontSize: "clamp(56px,11vw,90px)", color: p, letterSpacing: "-0.04em" }}>{slide.value}</p>
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full" style={{ background: changeColor + "18" }}>
            <span className="font-bold text-sm" style={{ color: changeColor }}>{arrow} {slide.change}</span>
          </div>
          <p className="text-xs text-gray-400 text-center max-w-xs leading-relaxed">{slide.context}</p>
        </div>
        <div className="px-8 pb-3 flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ background: p }} />
          <p className="text-[10px] text-gray-300 tracking-wider uppercase">{deckTitle}</p>
        </div>
      </div>
    );
  }

  if (slide.type === "bar_chart") {
    const series = slide.series.slice(0, 10);
    const maxVal = Math.max(...series.map(s => Math.max(s.value, s.target ?? 0)), 1);
    const isH = slide.orientation === "horizontal" || series.length > 6;
    return (
      <W title={slide.title} subtitle={slide.subtitle}>
        {isH ? (
          <div className="space-y-3 h-full overflow-hidden">
            {series.map((item, i) => (
              <div key={i}>
                <div className="flex justify-between mb-1">
                  <p className="text-xs font-medium text-gray-700 truncate">{item.label}</p>
                  <p className="text-xs font-black ml-3 flex-shrink-0" style={{ color: p }}>{item.value}</p>
                </div>
                <div className="relative h-4 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(item.value / maxVal) * 100}%`, background: p }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-end gap-2 h-full pb-1">
            {series.map((item, i) => (
              <div key={i} className="flex flex-col items-center flex-1 h-full justify-end">
                <p className="text-xs font-black mb-1.5" style={{ color: p, fontSize: 10 }}>{item.value}</p>
                <div className="w-full rounded-t-lg" style={{ height: `${(item.value / maxVal) * 72}%`, background: p, minHeight: 3 }} />
                <p className="mt-1.5 text-center truncate w-full text-gray-500" style={{ fontSize: 9 }}>{item.label}</p>
              </div>
            ))}
          </div>
        )}
      </W>
    );
  }

  if (slide.type === "progress_bars") return (
    <W title={slide.title}>
      <div className="space-y-4 overflow-hidden">
        {slide.items.slice(0, 6).map((item, i) => {
          const pct = Math.min(100, item.target > 0 ? Math.round((item.value / item.target) * 100) : 0);
          const c = item.status === "on_track" ? "#16A34A" : item.status === "off_track" ? "#DC2626" : "#D97706";
          return (
            <div key={i}>
              <div className="flex justify-between items-baseline mb-1.5">
                <p className="text-sm font-semibold text-gray-800 truncate">{item.label}</p>
                <span className="font-black text-sm ml-2 flex-shrink-0" style={{ color: c }}>{item.value}{item.unit} <span className="text-xs text-gray-400 font-normal">/ {item.target}{item.unit}</span></span>
              </div>
              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c }} />
              </div>
              <p className="text-xs text-gray-400 mt-1">{pct}%</p>
            </div>
          );
        })}
      </div>
    </W>
  );

  if (slide.type === "kpi_grid") {
    const kpis = slide.kpis.slice(0, 6);
    const cols = kpis.length <= 2 ? 2 : kpis.length <= 4 ? 2 : 3;
    return (
      <W title={slide.title}>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {kpis.map((kpi, i) => {
            const sc = kpi.status === "on_track" ? "#16A34A" : kpi.status === "off_track" ? "#DC2626" : "#D97706";
            return (
              <div key={i} className="rounded-xl p-4" style={{ background: sc + "0D", border: `1px solid ${sc}30` }}>
                <p className="text-xs text-gray-500 truncate">{kpi.label}</p>
                <p className="font-black text-gray-900 leading-tight" style={{ fontSize: "clamp(16px,2.5vw,22px)" }}>{kpi.value}</p>
                {kpi.target && kpi.target !== "-" && <p className="text-xs" style={{ color: sc }}>Target: {kpi.target}</p>}
              </div>
            );
          })}
        </div>
      </W>
    );
  }

  if (slide.type === "insight") {
    const ac = slide.status === "positive" ? "#16A34A" : slide.status === "negative" ? "#DC2626" : p;
    return (
      <W title={slide.title}>
        <div className="flex gap-5 h-full overflow-hidden">
          <div className="flex flex-col items-center justify-center rounded-2xl px-5 flex-shrink-0 w-32" style={{ background: ac }}>
            <p className="text-white font-black leading-tight text-center" style={{ fontSize: "clamp(22px,3.5vw,32px)" }}>{slide.stat}</p>
            <p className="text-white/75 text-xs text-center mt-2 leading-tight">{slide.stat_label}</p>
          </div>
          <div className="flex-1 flex flex-col justify-center border border-gray-100 rounded-2xl p-5 bg-gray-50/50 overflow-hidden">
            <p className="text-sm text-gray-700 leading-relaxed">{slide.body}</p>
          </div>
        </div>
      </W>
    );
  }

  if (slide.type === "line_chart") {
    const pts = slide.series.slice(0, 12);
    const maxVal = Math.max(...pts.map(pt => pt.value), 1);
    const minVal = Math.min(...pts.map(pt => pt.value), 0);
    const range = maxVal - minVal || 1;
    const W_SVG = 500, H_SVG = 200, PAD = 20;
    const xStep = pts.length > 1 ? (W_SVG - PAD * 2) / (pts.length - 1) : W_SVG - PAD * 2;
    const toY = (v: number) => PAD + ((maxVal - v) / range) * (H_SVG - PAD * 2);
    const toX = (i: number) => PAD + i * xStep;
    const pathD = pts.map((pt, i) => `${i === 0 ? "M" : "L"} ${toX(i)} ${toY(pt.value)}`).join(" ");
    const areaD = `${pathD} L ${toX(pts.length - 1)} ${H_SVG - PAD} L ${toX(0)} ${H_SVG - PAD} Z`;
    return (
      <W title={slide.title} subtitle={slide.subtitle}>
        <div className="h-full flex flex-col">
          <svg viewBox={`0 0 ${W_SVG} ${H_SVG}`} preserveAspectRatio="xMidYMid meet"
            style={{ width: "100%", height: "100%", display: "block" }}>
            <defs>
              <linearGradient id="lg-rv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={p} stopOpacity="0.18" />
                <stop offset="100%" stopColor={p} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={areaD} fill="url(#lg-rv)" />
            <path d={pathD} fill="none" stroke={p} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {pts.map((pt, i) => (
              <g key={i}>
                <circle cx={toX(i)} cy={toY(pt.value)} r={3} fill={p} />
                <text x={toX(i)} y={H_SVG - 4} textAnchor="middle" fontSize={9} fill="#94A3B8">{pt.label}</text>
              </g>
            ))}
          </svg>
        </div>
      </W>
    );
  }

  if (slide.type === "pie_chart") {
    const segs = slide.segments.slice(0, 7);
    const total = segs.reduce((sum, s3) => sum + s3.value, 0) || 1;
    const isDonut = slide.style === "donut";
    const COLORS = [p, "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4"];
    let cumAngle = -Math.PI / 2;
    const slices = segs.map((seg, i) => {
      const angle = (seg.value / total) * 2 * Math.PI;
      const x1 = 50 + 40 * Math.cos(cumAngle);
      const y1 = 50 + 40 * Math.sin(cumAngle);
      cumAngle += angle;
      const x2 = 50 + 40 * Math.cos(cumAngle);
      const y2 = 50 + 40 * Math.sin(cumAngle);
      const large = angle > Math.PI ? 1 : 0;
      const d = isDonut
        ? `M ${50 + 22 * Math.cos(cumAngle - angle)} ${50 + 22 * Math.sin(cumAngle - angle)} L ${x1} ${y1} A 40 40 0 ${large} 1 ${x2} ${y2} L ${50 + 22 * Math.cos(cumAngle)} ${50 + 22 * Math.sin(cumAngle)} A 22 22 0 ${large} 0 ${50 + 22 * Math.cos(cumAngle - angle)} ${50 + 22 * Math.sin(cumAngle - angle)} Z`
        : `M 50 50 L ${x1} ${y1} A 40 40 0 ${large} 1 ${x2} ${y2} Z`;
      return { d, color: COLORS[i % COLORS.length], label: seg.label, pct: Math.round((seg.value / total) * 100) };
    });
    return (
      <W title={slide.title} subtitle={slide.subtitle}>
        <div className="flex items-center gap-4 h-full overflow-hidden">
          <svg viewBox="0 0 100 100" className="flex-shrink-0" style={{ width: 120, height: 120 }}>
            {slices.map((s3, i) => <path key={i} d={s3.d} fill={s3.color} stroke="white" strokeWidth="0.5" />)}
          </svg>
          <div className="flex-1 overflow-hidden space-y-1.5">
            {slices.map((s3, i) => (
              <div key={i} className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s3.color }} />
                <span className="text-xs text-gray-700 truncate flex-1">{s3.label}</span>
                <span className="text-xs font-bold flex-shrink-0" style={{ color: s3.color }}>{s3.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </W>
    );
  }

  if (slide.type === "bullet_list") return (
    <W title={slide.title}>
      <ul className="space-y-3">
        {slide.items.slice(0, 6).map((item, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p }} />
            <span className="text-sm text-gray-700 leading-relaxed">{item}</span>
          </li>
        ))}
      </ul>
    </W>
  );

  if (slide.type === "action_plan") return (
    <W title={slide.title} subtitle={slide.subtitle}>
      <div className="h-full flex flex-col justify-center divide-y divide-gray-100">
        {slide.items.slice(0, 4).map((item, i) => (
          <div key={i} className="flex items-start gap-4 py-3 first:pt-0 last:pb-0">
            <span className="text-xs font-mono text-gray-300 mt-0.5 flex-shrink-0 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold tracking-wider uppercase mb-1" style={{ color: p }}>{item.department}</p>
              <p className="text-sm font-bold text-gray-900 leading-snug">{item.recommendation}</p>
              <p className="text-xs text-gray-400 mt-0.5 leading-snug">{item.rationale}</p>
            </div>
          </div>
        ))}
      </div>
    </W>
  );

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function initials(name: string) {
  return name.trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
}

function slideLabel(slide: SlideContent): string {
  if ("title" in slide && slide.type === "title") return slide.headline;
  if ("headline" in slide) return (slide as { headline: string }).headline;
  if ("title" in slide) return (slide as { title: string }).title;
  return slide.type;
}

// ─── Comment panel ────────────────────────────────────────────────────────────

function CommentPanel({
  reviewId, slideIndex, slide, slides, comments, brand, onAdded, onNavigate,
}: {
  reviewId: string;
  slideIndex: number;
  slide: SlideContent | undefined;
  slides: SlideContent[];
  comments: SlideComment[];
  brand: { primary: string; secondary: string };
  onAdded: (c: SlideComment) => void;
  onNavigate: (i: number) => void;
}) {
  const [name, setName] = useState(() => {
    try { return localStorage.getItem("reviewer_name") ?? ""; } catch { return ""; }
  });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const slideComments = comments.filter(c => c.slide_index === slideIndex && !c.resolved);

  // Scroll to bottom when new comment
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [slideComments.length]);

  const submit = async () => {
    if (!text.trim()) return;
    setSending(true);
    try { localStorage.setItem("reviewer_name", name); } catch {}
    const res = await addSlideComment(reviewId, slideIndex, name || "Reviewer", text.trim());
    setSending(false);
    if (res.comment) {
      onAdded(res.comment);
      setText("");
      setToast(true);
      setTimeout(() => setToast(false), 2500);
    }
  };

  // Slides with open comments (for quick navigation)
  const slidesWithComments = slides
    .map((_, i) => ({ i, count: comments.filter(c => c.slide_index === i && !c.resolved).length }))
    .filter(s => s.count > 0);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Panel header */}
      <div className="px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <MessageSquare size={14} style={{ color: brand.primary }} />
          <p className="text-sm font-bold text-gray-900">Feedback</p>
          {comments.filter(c => !c.resolved).length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: brand.primary }}>
              {comments.filter(c => !c.resolved).length}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 truncate">
          Slide {slideIndex + 1} · {slide ? slideLabel(slide) : ""}
        </p>
      </div>

      {/* Comments for this slide */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {slideComments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3" style={{ background: brand.primary + "15" }}>
              <MessageSquare size={18} style={{ color: brand.primary }} />
            </div>
            <p className="text-sm font-medium text-gray-500">No feedback yet</p>
            <p className="text-xs text-gray-400 mt-1">Be the first to leave a note on this slide.</p>
          </div>
        ) : (
          slideComments.map(c => (
            <div key={c.id} className="flex gap-3">
              {/* Avatar */}
              <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[11px] font-bold"
                style={{ background: brand.primary }}>
                {initials(c.reviewer_name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <p className="text-xs font-semibold text-gray-800 truncate">{c.reviewer_name}</p>
                  <p className="text-[10px] text-gray-400 flex-shrink-0">{timeAgo(c.created_at)}</p>
                </div>
                <div className="bg-gray-50 rounded-xl rounded-tl-sm px-3 py-2.5 border border-gray-100">
                  <p className="text-sm text-gray-700 leading-relaxed">{c.comment_text}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Other slides with comments */}
      {slidesWithComments.filter(s => s.i !== slideIndex).length > 0 && (
        <div className="px-4 py-3 border-t border-gray-100 flex-shrink-0">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">Other slides with feedback</p>
          <div className="flex flex-wrap gap-1.5">
            {slidesWithComments.filter(s => s.i !== slideIndex).map(s => (
              <button key={s.i} onClick={() => onNavigate(s.i)}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-medium transition-colors"
                style={{ background: brand.primary + "15", color: brand.primary }}>
                Slide {s.i + 1}
                <span className="w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white" style={{ background: brand.primary }}>
                  {s.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="px-4 pb-5 pt-3 border-t border-gray-100 flex-shrink-0 space-y-2.5">
        {toast && (
          <div className="flex items-center gap-2 text-xs font-medium text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
            <CheckCircle2 size={13} /> Feedback sent!
          </div>
        )}
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 bg-gray-50"
          style={{ "--tw-ring-color": brand.primary + "50" } as React.CSSProperties}
        />
        <div className="relative">
          <textarea
            ref={textRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
            placeholder="Leave feedback on this slide… ⌘↵ to send"
            rows={3}
            className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-3 pr-11 focus:outline-none focus:ring-2 resize-none bg-white"
            style={{ "--tw-ring-color": brand.primary + "50" } as React.CSSProperties}
          />
          <button onClick={submit} disabled={sending || !text.trim()}
            className="absolute bottom-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center text-white transition-opacity disabled:opacity-30"
            style={{ background: brand.primary }}>
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          </button>
        </div>
        <p className="text-[10px] text-gray-400 text-center">Your feedback is visible to the presenter.</p>
      </div>
    </div>
  );
}

// ─── Main review page ─────────────────────────────────────────────────────────

export default function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<"not_found" | "private" | "expired" | null>(null);
  const [reviewId, setReviewId] = useState("");
  const [deck, setDeck] = useState<SlidesDeck | null>(null);
  const [period, setPeriod] = useState("");
  const [comments, setComments] = useState<SlideComment[]>([]);
  const [brand, setBrand] = useState({ primary: "#6366f1", secondary: "#a5b4fc" });
  const [idx, setIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [showComments, setShowComments] = useState(false);

  useEffect(() => {
    getReviewSession(token).then(res => {
      if (res.error || !res.review) {
        setError(res.error ?? "Not found");
        setErrorType(res.errorType ?? "not_found");
        setLoading(false);
        return;
      }
      setReviewId(res.review.id);
      setDeck(res.review.deck);
      setPeriod(res.review.period);
      setComments(res.comments);
      setBrand(res.review.brand);
      setLoading(false);
    });
  }, [token]);

  const navigate = useCallback((dir: number) => {
    if (!deck) return;
    setIdx(i => Math.max(0, Math.min(deck.slides.length - 1, i + dir)));
  }, [deck]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (e.key === "ArrowRight" || e.key === " ") navigate(1);
      if (e.key === "ArrowLeft") navigate(-1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0F172A" }}>
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={28} className="animate-spin" style={{ color: "#6366f1" }} />
        <p className="text-sm text-gray-400">Loading review…</p>
      </div>
    </div>
  );

  if (error || !deck) {
    const icon = errorType === "private" ? "🔒" : errorType === "expired" ? "⏰" : "🔍";
    const title = errorType === "private" ? "This report is private"
      : errorType === "expired" ? "This link has expired"
      : "Report not found";
    const sub = errorType === "private" ? "The owner has made this report private. Ask them to re-enable access."
      : errorType === "expired" ? "The share link for this report has passed its expiry date."
      : error ?? "This review link doesn't exist or has been removed.";
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0F172A" }}>
        <div className="text-center max-w-sm px-6">
          <span className="text-5xl block mb-4">{icon}</span>
          <p className="text-white font-bold text-lg">{title}</p>
          <p className="text-sm text-gray-400 mt-2 leading-relaxed">{sub}</p>
        </div>
      </div>
    );
  }

  const slides = deck.slides ?? [];
  const total = slides.length;
  const slide = slides[idx];
  const slideCommentCount = (i: number) => comments.filter(c => c.slide_index === i && !c.resolved).length;

  return (
    <div className="h-[100dvh] overflow-hidden flex flex-col" style={{ background: "#0F172A", fontFamily: "system-ui, -apple-system, sans-serif" }}>

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 flex-shrink-0 border-b border-white/5" style={{ background: "#0F172A" }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: brand.primary }} />
          <div className="min-w-0">
            <p className="font-bold text-white text-sm truncate leading-tight">{deck.title}</p>
            <p className="text-[11px] text-gray-500 hidden sm:block">{period} · {total} slides</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Mobile: comment toggle */}
          <button onClick={() => setShowComments(v => !v)}
            className="sm:hidden flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-white/10 text-gray-300 relative">
            <MessageSquare size={13} />
            {comments.filter(c => !c.resolved).length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-white text-[9px] font-bold flex items-center justify-center"
                style={{ background: brand.primary }}>
                {comments.filter(c => !c.resolved).length}
              </span>
            )}
          </button>
          <span className="hidden sm:inline px-2 py-1 rounded-lg border border-white/10 text-gray-400 text-xs">Review mode · ← → keys</span>
        </div>
      </div>

      {/* Mobile: horizontal filmstrip */}
      <div className="sm:hidden flex gap-2 overflow-x-auto px-3 py-2 flex-shrink-0" style={{ background: "#0A0F1A" }}>
        {slides.map((sl, i) => {
          const cnt = slideCommentCount(i);
          const active = i === idx;
          return (
            <button key={i} onClick={() => setIdx(i)} className="relative flex-shrink-0 rounded-lg overflow-hidden"
              style={{ width: 80, aspectRatio: "16/9", outline: active ? `2px solid ${brand.primary}` : "2px solid transparent", outlineOffset: 1, opacity: active ? 1 : 0.5 }}>
              <div className="pointer-events-none" style={{ width: "200%", height: "200%", transform: "scale(0.5)", transformOrigin: "top left" }}>
                <SlideCard slide={sl} brand={brand} deckTitle={deck.title} />
              </div>
              {cnt > 0 && <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full text-white text-[8px] font-bold flex items-center justify-center" style={{ background: brand.primary }}>{cnt}</span>}
            </button>
          );
        })}
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── Left filmstrip (desktop only) ─────────────────────────────── */}
        <div className="hidden sm:flex w-32 lg:w-36 flex-shrink-0 flex-col overflow-y-auto py-3 px-2 gap-2 border-r border-white/5" style={{ background: "#0A0F1A" }}>
          {slides.map((sl, i) => {
            const cnt = slideCommentCount(i);
            const active = i === idx;
            return (
              <button key={i} onClick={() => setIdx(i)} className="w-full rounded-lg overflow-hidden relative transition-all group flex-shrink-0"
                style={{ aspectRatio: "16/9", outline: active ? `2px solid ${brand.primary}` : "2px solid transparent", outlineOffset: 2, opacity: active ? 1 : 0.45 }}>
                <div className="pointer-events-none" style={{ width: "200%", height: "200%", transform: "scale(0.5)", transformOrigin: "top left" }}>
                  <SlideCard slide={sl} brand={brand} deckTitle={deck.title} />
                </div>
                <span className="absolute bottom-1 left-1.5 text-[9px] font-bold text-white/50">{i + 1}</span>
                {cnt > 0 && <span className="absolute top-1 right-1 w-4 h-4 rounded-full text-white text-[9px] font-bold flex items-center justify-center" style={{ background: brand.primary }}>{cnt}</span>}
              </button>
            );
          })}
        </div>

        {/* ── Main canvas ───────────────────────────────────────────────── */}
        <div className={`flex-1 flex flex-col min-w-0 overflow-hidden ${showComments ? "hidden sm:flex" : "flex"}`}>
          <div className="flex-1 flex items-center justify-center overflow-hidden relative p-4 sm:p-8">
            <div className="w-full max-w-4xl rounded-xl sm:rounded-2xl overflow-hidden shadow-2xl"
              style={{
                aspectRatio: "16/9",
                transform: `scale(${zoom})`,
                transformOrigin: "center center",
                transition: "transform 0.15s ease",
                boxShadow: `0 0 0 1px rgba(255,255,255,0.06), 0 24px 80px -12px rgba(0,0,0,0.7)`,
              }}>
              {slide ? <SlideCard slide={slide} brand={brand} deckTitle={deck.title} />
                : <div className="w-full h-full flex items-center justify-center bg-white text-gray-300">No slides</div>}
            </div>
            {/* Zoom — desktop only */}
            <div className="hidden sm:flex absolute bottom-5 right-5 items-center gap-1 rounded-lg px-2 py-1.5" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}>
              <button onClick={() => setZoom(z => Math.max(0.4, parseFloat((z - 0.1).toFixed(1))))} className="w-6 h-6 flex items-center justify-center text-gray-300 hover:text-white text-lg font-light">−</button>
              <span className="text-[11px] font-mono text-gray-400 w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(2.5, parseFloat((z + 0.1).toFixed(1))))} className="w-6 h-6 flex items-center justify-center text-gray-300 hover:text-white text-lg font-light">+</button>
              <button onClick={() => setZoom(1)} className="ml-1 text-[10px] text-gray-500 hover:text-gray-300 px-1">reset</button>
            </div>
          </div>

          {/* Bottom nav */}
          <div className="flex-shrink-0 px-4 sm:px-8 py-3 sm:py-4 flex items-center gap-3 sm:gap-4 border-t border-white/5" style={{ background: "#0A0F1A" }}>
            <button onClick={() => navigate(-1)} disabled={idx === 0} className="p-2 rounded-xl text-gray-500 hover:text-white hover:bg-white/5 disabled:opacity-20 transition-all">
              <ArrowLeft size={18} />
            </button>
            <div className="flex items-center gap-1.5 flex-1 justify-center flex-wrap">
              {slides.map((_, i) => {
                const cnt = slideCommentCount(i);
                const active = i === idx;
                return (
                  <button key={i} onClick={() => setIdx(i)} className="rounded-full transition-all relative"
                    style={{ width: active ? 20 : 7, height: 7, background: active ? brand.primary : cnt > 0 ? brand.primary + "60" : "#334155" }}>
                    {cnt > 0 && !active && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-gray-900" style={{ background: brand.primary }} />}
                  </button>
                );
              })}
            </div>
            <span className="text-gray-600 text-xs font-mono w-10 text-center">{idx + 1}/{total}</span>
            <button onClick={() => navigate(1)} disabled={idx === total - 1} className="p-2 rounded-xl text-gray-500 hover:text-white hover:bg-white/5 disabled:opacity-20 transition-all">
              <ArrowRight size={18} />
            </button>
          </div>
        </div>

        {/* ── Comment panel ─────────────────────────────────────────────── */}
        {/* Desktop: always visible sidebar | Mobile: fullscreen overlay when showComments */}
        <div className={`${showComments ? "flex" : "hidden"} sm:flex w-full sm:w-72 lg:w-80 flex-shrink-0 border-l border-white/5 flex-col overflow-hidden absolute sm:relative inset-0 sm:inset-auto z-10`}
          style={{ background: showComments ? "#0F172A" : undefined }}>
          {/* Mobile back button */}
          {showComments && (
            <button onClick={() => setShowComments(false)} className="sm:hidden flex items-center gap-2 px-4 py-3 text-sm text-gray-400 border-b border-white/5">
              <ArrowLeft size={14} /> Back to slides
            </button>
          )}
          <CommentPanel
            reviewId={reviewId}
            slideIndex={idx}
            slide={slide}
            slides={slides}
            comments={comments}
            brand={brand}
            onAdded={c => setComments(prev => [...prev, c])}
            onNavigate={i => { setIdx(i); setShowComments(false); }}
          />
        </div>
      </div>
    </div>
  );
}
