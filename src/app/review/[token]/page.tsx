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
import { SlideCard } from "@/components/reports/slide-card";

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
