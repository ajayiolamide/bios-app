"use client";

import { useState } from "react";
import type { SlideContent } from "@/app/actions/reports";

// ─── Slide preview renderer ───────────────────────────────────────────────────
// This used to exist as two separately hand-maintained copies — one inside
// the report editor (reports/page.tsx) and a second, drifted "full copy" in
// the public share page (review/[token]/page.tsx). The review copy never
// received several features added to the editor copy over time (point-value
// labels on line charts, target-line + legend + axis scale on bar charts,
// the big_stat footer's flex-shrink-0), so a deck could look complete in the
// editor and visibly broken on the link a client actually opens. Having one
// component both pages import fixes that at the source — there is now only
// one chart renderer to keep correct.

export function SlideCard({ slide, brand, deckTitle }: { slide: SlideContent; brand: { primary: string; secondary: string; logoUrl?: string | null }; deckTitle: string }) {
  const p = brand.primary;

  // ── Brand slides (title / closing) — full colour ────────────────────────────
  if (slide.type === "title") return (
    <div className="w-full h-full flex flex-col justify-end px-10 py-9 relative overflow-hidden" style={{ background: p }}>
      {/* subtle grid texture */}
      <div className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: "repeating-linear-gradient(0deg,#fff 0,#fff 1px,transparent 1px,transparent 40px),repeating-linear-gradient(90deg,#fff 0,#fff 1px,transparent 1px,transparent 40px)" }} />
      {/* Cover image — right side accent panel */}
      {slide.image_url && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slide.image_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
          <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${p} 40%, transparent 100%)` }} />
        </>
      )}
      {/* Company logo — mirrors where pptxgenjs places it on the exported cover slide */}
      {brand.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt="" className="absolute top-6 right-8 h-8 max-w-[120px] object-contain" />
      )}
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
      {slide.image_url && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slide.image_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25" />
          <div className="absolute inset-0" style={{ background: `${p}99` }} />
        </>
      )}
      <div className="relative text-center">
        <h1 className="text-white font-black mb-3" style={{ fontSize: "clamp(20px,3.5vw,32px)", letterSpacing: "-0.02em" }}>{slide.headline}</h1>
        <div className="h-px w-12 bg-white/40 mx-auto mb-3" />
        <p className="text-white/70 text-sm">{slide.subtitle}</p>
        <p className="mt-10 text-white/30 text-[11px] tracking-widest uppercase">{deckTitle}</p>
      </div>
    </div>
  );

  // ── Shared white-slide wrapper ───────────────────────────────────────────────
  // Three image modes:
  //   (1) No position + no layout      → small header thumbnail (legacy default)
  //   (2) imgPos set, layout undefined/"overlay" → freely-placed absolute overlay
  //   (3) layout "right-panel" | "left-panel" | "bottom" → image integrated into
  //       content area as a sibling panel; text/charts shift to make room
  const W = ({ title, subtitle, children, imgUrl: wImgUrl, imgPos: wImgPos, imgLayout: wImgLayout }: {
    title: string; subtitle?: string; children: React.ReactNode;
    imgUrl?: string; imgPos?: { x: number; y: number; w: number; h: number } | null;
    imgLayout?: "overlay" | "right-panel" | "left-panel" | "bottom";
  }) => {
    const isPanelLayout = !!wImgUrl && (wImgLayout === "right-panel" || wImgLayout === "left-panel" || wImgLayout === "bottom");
    const isOverlay     = !!wImgUrl && !!wImgPos && (!wImgLayout || wImgLayout === "overlay");
    const isThumbnail   = !!wImgUrl && !wImgPos && !isPanelLayout;
    return (
      <div className="w-full h-full bg-white flex flex-col overflow-hidden relative" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
        {/* Slide header — black on white */}
        <div className="px-8 pt-7 pb-5 flex-shrink-0 border-b border-gray-100 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-gray-900 leading-tight" style={{ fontSize: "clamp(13px,2vw,18px)", letterSpacing: "-0.02em" }}>{title}</h2>
            {subtitle && <p className="text-gray-400 mt-1 text-xs">{subtitle}</p>}
          </div>
          {isThumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={wImgUrl!} alt="" className="w-14 h-10 object-cover rounded-lg flex-shrink-0 border border-gray-100" />
          )}
        </div>
        {/* Content area — layout depends on image mode */}
        {isPanelLayout ? (
          wImgLayout === "bottom" ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 px-8 py-4 overflow-hidden min-h-0">{children}</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={wImgUrl!} alt="" className="h-[35%] flex-shrink-0 w-full object-cover border-t border-gray-100" />
            </div>
          ) : wImgLayout === "left-panel" ? (
            <div className="flex-1 flex flex-row overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={wImgUrl!} alt="" className="w-[40%] flex-shrink-0 object-cover border-r border-gray-100" />
              <div className="flex-1 px-6 py-5 overflow-hidden min-w-0">{children}</div>
            </div>
          ) : (
            // right-panel
            <div className="flex-1 flex flex-row overflow-hidden">
              <div className="flex-1 px-8 py-5 overflow-hidden min-w-0">{children}</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={wImgUrl!} alt="" className="w-[40%] flex-shrink-0 object-cover border-l border-gray-100" />
            </div>
          )
        ) : (
          <div className="flex-1 px-8 py-5 overflow-hidden">{children}</div>
        )}
        {/* Footer brand strip */}
        <div className="px-8 pb-3 flex items-center gap-1.5 flex-shrink-0">
          <div className="w-2 h-2 rounded-full" style={{ background: p }} />
          <p className="text-[10px] text-gray-300 tracking-wider uppercase">{deckTitle}</p>
        </div>
        {/* Free-position overlay (only in overlay mode) */}
        {isOverlay && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={wImgUrl!} alt="" className="absolute object-cover rounded-lg border border-gray-200 shadow-sm z-10"
            style={{ left: `${wImgPos!.x}%`, top: `${wImgPos!.y}%`, width: `${wImgPos!.w}%`, height: `${wImgPos!.h}%` }} />
        )}
      </div>
    );
  };

  // Helper: extract image_url, position, and layout from any slide type.
  // image_layout controls how the image is integrated into the slide:
  //   undefined / "overlay" — legacy behaviour (absolute overlay or header thumbnail)
  //   "right-panel"         — image fills right 40%, content shifts left
  //   "left-panel"          — image fills left 40%, content shifts right
  //   "bottom"              — image fills bottom 35%, content shifts up
  const slideImg = (slide as { image_url?: string }).image_url;
  const slidePosRaw = slide as { image_x?: number; image_y?: number; image_w?: number; image_h?: number };
  const imgPos = (slidePosRaw.image_x != null || slidePosRaw.image_y != null || slidePosRaw.image_w != null || slidePosRaw.image_h != null)
    ? { x: slidePosRaw.image_x ?? 70, y: slidePosRaw.image_y ?? 6, w: slidePosRaw.image_w ?? 26, h: slidePosRaw.image_h ?? 20 }
    : null;
  const slideLayout = (slide as { image_layout?: string }).image_layout as "overlay" | "right-panel" | "left-panel" | "bottom" | undefined;

  // ── Big stat ─────────────────────────────────────────────────────────────────
  if (slide.type === "big_stat") {
    const up = slide.change_direction === "up", dn = slide.change_direction === "down";
    const changeColor = up ? "#16A34A" : dn ? "#DC2626" : "#94A3B8";
    const arrow = up ? "↑" : dn ? "↓" : "→";
    const hasNarrative = !!slide.narrative;
    return (
      <div className="w-full h-full bg-white flex flex-col overflow-hidden relative" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
        {slideImg && !imgPos && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={slideImg} alt="" className="absolute top-3 right-3 w-14 h-10 object-cover rounded-lg border border-gray-100 z-10" />
        )}
        {slideImg && imgPos && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={slideImg} alt="" className="absolute object-cover rounded-lg border border-gray-200 shadow-sm z-10"
            style={{ left: `${imgPos.x}%`, top: `${imgPos.y}%`, width: `${imgPos.w}%`, height: `${imgPos.h}%` }} />
        )}
        <div className={`flex-1 flex ${hasNarrative ? "flex-row items-stretch" : "flex-col items-center justify-center"} px-8 gap-6 py-6`}>
          {/* Number column */}
          <div className={`flex flex-col items-center justify-center ${hasNarrative ? "w-2/5 flex-shrink-0 border-r border-gray-100" : ""} gap-2`}>
            <p className="text-xs text-gray-400 uppercase tracking-widest text-center">{slide.label}</p>
            <p className="font-black leading-none text-center" style={{ fontSize: hasNarrative ? "clamp(40px,8vw,68px)" : "clamp(56px,11vw,90px)", color: p, letterSpacing: "-0.04em" }}>{slide.value}</p>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full" style={{ background: changeColor + "18" }}>
              <span className="font-bold text-sm" style={{ color: changeColor }}>{arrow} {slide.change}</span>
            </div>
            <p className="text-xs text-gray-400 text-center leading-relaxed">{slide.context}</p>
          </div>
          {/* Narrative column — only when narrative is present */}
          {hasNarrative && (
            <div className="flex-1 flex flex-col justify-center pl-2">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{slide.narrative}</p>
            </div>
          )}
        </div>
        {/* flex-shrink-0 keeps this footer pinned at a fixed height */}
        <div className="px-8 pb-3 flex items-center gap-1.5 flex-shrink-0">
          <div className="w-2 h-2 rounded-full" style={{ background: p }} />
          <p className="text-[10px] text-gray-300 tracking-wider uppercase">{deckTitle}</p>
        </div>
      </div>
    );
  }

  // ── Stat + narrative (new variant: prominent number left, story text right) ──
  if (slide.type === "stat_narrative") {
    const up = slide.change_direction === "up", dn = slide.change_direction === "down";
    const changeColor = up ? "#16A34A" : dn ? "#DC2626" : "#94A3B8";
    const accentColor = slide.status === "positive" ? "#16A34A" : slide.status === "negative" ? "#DC2626" : p;
    const arrow = up ? "↑" : dn ? "↓" : "→";
    return (
      <div className="w-full h-full bg-white flex flex-col overflow-hidden" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
        {/* Header */}
        <div className="px-8 pt-7 pb-4 flex-shrink-0 border-b border-gray-100">
          <h2 className="font-black text-gray-900 leading-tight" style={{ fontSize: "clamp(13px,2vw,18px)", letterSpacing: "-0.02em" }}>{slide.title}</h2>
        </div>
        {/* Body: big number left, narrative right */}
        <div className="flex-1 flex items-stretch gap-0 overflow-hidden">
          {/* Left — number panel */}
          <div className="w-2/5 flex flex-col items-center justify-center px-6 gap-3 border-r-2 flex-shrink-0" style={{ borderColor: accentColor + "30", background: accentColor + "06" }}>
            <p className="text-[11px] text-gray-400 uppercase tracking-widest text-center">{slide.stat_label}</p>
            <p className="font-black leading-none text-center" style={{ fontSize: "clamp(44px,8vw,72px)", color: accentColor, letterSpacing: "-0.04em" }}>{slide.stat}</p>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full" style={{ background: changeColor + "18" }}>
              <span className="font-bold text-xs" style={{ color: changeColor }}>{arrow} {slide.change}</span>
            </div>
          </div>
          {/* Right — narrative */}
          <div className="flex-1 flex flex-col justify-center px-7 py-5 overflow-hidden">
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line line-clamp-6">{slide.narrative}</p>
          </div>
        </div>
        {/* Footer */}
        <div className="px-8 pb-3 flex items-center gap-1.5 flex-shrink-0">
          <div className="w-2 h-2 rounded-full" style={{ background: p }} />
          <p className="text-[10px] text-gray-300 tracking-wider uppercase">{deckTitle}</p>
        </div>
      </div>
    );
  }

  // ── Bar chart (SVG-based — works reliably in all contexts) ───────────────────
  if (slide.type === "bar_chart") {
    const series = slide.series.slice(0, 10);
    const maxVal = Math.max(...series.map(s3 => Math.max(s3.value, s3.target ?? 0)), 1);
    const isHorizontal = slide.orientation === "horizontal" || series.length > 6;
    const [hovBar, setHovBar] = useState<number | null>(null);

    if (isHorizontal) {
      // Horizontal SVG bars
      const SH = 30, padT = 4, padB = 30, rowH = SH;
      const totalH = series.length * rowH + padT + padB;
      const barAreaW = 230, labelW = 86, valW = 36;
      const W_SVG = labelW + barAreaW + valW + 8;
      return (
        <W title={slide.title} subtitle={slide.subtitle} imgUrl={slideImg} imgPos={imgPos} imgLayout={slideLayout}>
          <div className="h-full flex flex-col gap-1">
            <svg viewBox={`0 0 ${W_SVG} ${totalH}`} preserveAspectRatio="xMidYMid meet"
              style={{ flex: "1 1 0", minHeight: 0, width: "100%", display: "block" }}>
              {series.map((item, i) => {
                const y = padT + i * rowH;
                const barW = (item.value / maxVal) * barAreaW;
                const tBarW = item.target ? (item.target / maxVal) * barAreaW : null;
                const isHov = hovBar === i;
                return (
                  <g key={i} style={{ cursor: "pointer" }}
                    onMouseEnter={() => setHovBar(i)} onMouseLeave={() => setHovBar(null)}>
                    {/* Row highlight */}
                    {isHov && <rect x={0} y={y + 1} width={W_SVG} height={rowH - 2} rx={3} fill={p + "15"} />}
                    {/* Label */}
                    <text x={0} y={y + 15} fontSize={9} fill={isHov ? p : "#374151"} fontWeight={isHov ? "bold" : "normal"}>
                      {item.label.length > 14 ? item.label.slice(0, 13) + "…" : item.label}
                    </text>
                    {/* Track */}
                    <rect x={labelW} y={y + 9} width={barAreaW} height={11} rx={5} fill="#F3F4F6" />
                    {/* Fill */}
                    <rect x={labelW} y={y + 9} width={Math.max(4, barW)} height={11} rx={5}
                      fill={isHov ? p : p + "CC"} style={{ transition: "all 0.15s" }} />
                    {/* Target line */}
                    {tBarW && <rect x={labelW + tBarW - 1} y={y + 6} width={2} height={17} rx={1} fill="#F87171" />}
                    {/* Value */}
                    <text x={labelW + barAreaW + 6} y={y + 15} fontSize={9} fill={p} fontWeight="bold">{item.value.toLocaleString()}</text>
                  </g>
                );
              })}
              {/* Fixed info bar at bottom — shows hovered item detail */}
              {hovBar !== null && (
                <g>
                  <rect x={0} y={totalH - padB + 4} width={W_SVG} height={22} rx={4} fill="#1F2937" />
                  <text x={8} y={totalH - padB + 18} fontSize={10} fill="white" fontWeight="bold">
                    {series[hovBar].label}:  {series[hovBar].value.toLocaleString()}
                    {series[hovBar].target ? `  ·  target ${series[hovBar].target!.toLocaleString()}` : ""}
                  </text>
                </g>
              )}
            </svg>
            {series.some(s3 => s3.target) && (
              <div className="flex items-center gap-1 mt-1"><div className="w-2 h-0.5 bg-red-400 rounded" /><p className="text-[9px] text-gray-400">Target</p></div>
            )}
          </div>
        </W>
      );
    }

    // Vertical SVG bars
    const W_SVG = 320, padL = 28, padR = 8, padT = 20, padB = 42;
    const H_SVG = 160 + padB;
    const innerW = W_SVG - padL - padR;
    const innerH = H_SVG - padT - padB;
    const colW = innerW / series.length;
    const barW = Math.min(colW * 0.65, 32);
    return (
      <W title={slide.title} subtitle={slide.subtitle} imgUrl={slideImg} imgPos={imgPos} imgLayout={slideLayout}>
        <svg viewBox={`0 0 ${W_SVG} ${H_SVG}`} className="w-full h-full" style={{ display: "block" }}>
          {/* Y grid lines */}
          {[0.25, 0.5, 0.75, 1].map(frac => {
            const y = padT + innerH - frac * innerH;
            return (
              <g key={frac}>
                <line x1={padL} y1={y} x2={W_SVG - padR} y2={y} stroke="#F3F4F6" strokeWidth={1} />
                <text x={padL - 3} y={y + 3} fontSize={6} fill="#9CA3AF" textAnchor="end">{Math.round(maxVal * frac).toLocaleString()}</text>
              </g>
            );
          })}
          {/* Baseline */}
          <line x1={padL} y1={padT + innerH} x2={W_SVG - padR} y2={padT + innerH} stroke="#E5E7EB" strokeWidth={1} />
          {series.map((item, i) => {
            const cx = padL + i * colW + colW / 2;
            const bh = Math.max(2, (item.value / maxVal) * innerH);
            const by = padT + innerH - bh;
            const isHov = hovBar === i;
            return (
              <g key={i} style={{ cursor: "pointer" }}
                onMouseEnter={() => setHovBar(i)} onMouseLeave={() => setHovBar(null)}>
                {/* Bar */}
                <rect x={cx - barW / 2} y={by} width={barW} height={bh} rx={2}
                  fill={isHov ? p : p + "CC"} style={{ transition: "all 0.12s" }} />
                {/* Target line */}
                {item.target && (
                  <rect x={cx - barW / 2 - 2} y={padT + innerH - (item.target / maxVal) * innerH - 1}
                    width={barW + 4} height={2} rx={1} fill="#F87171" />
                )}
                {/* Value label above */}
                <text x={cx} y={by - 3} fontSize={isHov ? 8 : 7} fill={isHov ? p : "#6B7280"} textAnchor="middle" fontWeight={isHov ? "bold" : "normal"}>
                  {item.value.toLocaleString()}
                </text>
                {/* Category label below */}
                <text x={cx} y={padT + innerH + 11} fontSize={Math.max(6, Math.min(8, 70 / series.length))} fill={isHov ? p : "#9CA3AF"} textAnchor="middle" fontWeight={isHov ? "bold" : "normal"}>
                  {item.label.length > 8 ? item.label.slice(0, 7) + "…" : item.label}
                </text>
              </g>
            );
          })}
          {/* Fixed tooltip bar */}
          {hovBar !== null && (
            <g>
              <rect x={padL} y={H_SVG - 26} width={W_SVG - padL - padR} height={22} rx={4} fill="#1F2937" />
              <text x={padL + 8} y={H_SVG - 11} fontSize={10} fill="white" fontWeight="bold">
                {series[hovBar].label}: {series[hovBar].value.toLocaleString()}
                {series[hovBar].target ? `  ·  target ${series[hovBar].target!.toLocaleString()}` : ""}
              </text>
            </g>
          )}
          {series.some(s3 => s3.target) && (
            <g>
              <rect x={W_SVG - 40} y={padT - 10} width={8} height={4} rx={2} fill="#F87171" />
              <text x={W_SVG - 29} y={padT - 7} fontSize={7} fill="#9CA3AF">Target</text>
            </g>
          )}
        </svg>
      </W>
    );
  }

  // ── Progress bars ─────────────────────────────────────────────────────────────
  if (slide.type === "progress_bars") {
    return (
      <W title={slide.title} imgUrl={slideImg} imgPos={imgPos} imgLayout={slideLayout}>
        <div className="space-y-4 h-full overflow-hidden">
          {slide.items.slice(0, 6).map((item, i) => {
            const pct = Math.min(100, item.target > 0 ? Math.round((item.value / item.target) * 100) : 0);
            const barColor = item.status === "on_track" ? "#16A34A" : item.status === "off_track" ? "#DC2626" : "#D97706";
            return (
              <div key={i}>
                <div className="flex justify-between items-baseline mb-1.5">
                  <p className="text-sm font-semibold text-gray-800 truncate">{item.label}</p>
                  <div className="flex items-baseline gap-1 ml-3 flex-shrink-0">
                    <span className="font-black text-sm" style={{ color: barColor }}>{item.value.toLocaleString()}{item.unit}</span>
                    <span className="text-xs text-gray-400">/ {item.target.toLocaleString()}{item.unit}</span>
                  </div>
                </div>
                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                </div>
                <p className="text-xs text-gray-400 mt-1">{pct}% complete</p>
              </div>
            );
          })}
        </div>
      </W>
    );
  }

  // ── KPI grid ──────────────────────────────────────────────────────────────────
  if (slide.type === "kpi_grid") {
    const kpis = slide.kpis.slice(0, 6);
    const cols = kpis.length <= 2 ? 2 : kpis.length <= 4 ? 2 : 3;
    return (
      <W title={slide.title} imgUrl={slideImg} imgPos={imgPos} imgLayout={slideLayout}>
        <div className="grid gap-3 h-full content-start" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {kpis.map((kpi, i) => {
            const sc = kpi.status === "on_track" ? "#16A34A" : kpi.status === "off_track" ? "#DC2626" : "#D97706";
            return (
              <div key={i} className="rounded-xl p-4 flex flex-col gap-0.5" style={{ background: sc + "0D", border: `1px solid ${sc}30` }}>
                <p className="text-xs text-gray-500 truncate">{kpi.label}</p>
                <p className="font-black text-gray-900 leading-tight" style={{ fontSize: "clamp(16px,2.5vw,22px)" }}>{kpi.value}</p>
                {kpi.target && kpi.target !== "-" && (
                  <p className="text-xs" style={{ color: sc }}>Target: {kpi.target}</p>
                )}
              </div>
            );
          })}
        </div>
      </W>
    );
  }

  // ── Insight ───────────────────────────────────────────────────────────────────
  if (slide.type === "insight") {
    const ac = slide.status === "positive" ? "#16A34A" : slide.status === "negative" ? "#DC2626" : p;
    // "Stat box width" in the Edit panel controls this — defaults to the
    // original fixed w-32 ("balanced") so existing decks look unchanged.
    const statWidthCls = { narrow: "w-24", balanced: "w-32", wide: "w-48" }[slide.stat_width ?? "balanced"];
    return (
      <W title={slide.title} imgUrl={slideImg} imgPos={imgPos} imgLayout={slideLayout}>
        <div className="flex gap-5 h-full overflow-hidden">
          <div className={`flex flex-col items-center justify-center rounded-2xl px-5 flex-shrink-0 ${statWidthCls}`} style={{ background: ac }}>
            <p className="text-white font-black leading-tight text-center" style={{ fontSize: "clamp(22px,3.5vw,32px)" }}>{slide.stat}</p>
            <p className="text-white/75 text-xs text-center mt-2 leading-tight">{slide.stat_label}</p>
          </div>
          <div className="flex-1 flex flex-col justify-center border border-gray-100 rounded-2xl p-5 overflow-hidden bg-gray-50/50">
            {/* whitespace-pre-line: a plain <p> collapses every "\n" in the
                text down to a single space by default, so a body that's a
                short paragraph followed by a numbered/bulleted list (e.g.
                "...three root causes:\n1. X\n2. Y\n3. Z") rendered as one
                run-on sentence with no visible line breaks at all, even
                though the underlying text did contain them. This preserves
                real line breaks while still wrapping normally within the box. */}
            <p className="text-sm text-gray-700 leading-relaxed line-clamp-6 whitespace-pre-line">{slide.body}</p>
          </div>
        </div>
      </W>
    );
  }

  // ── Line chart (interactive) ──────────────────────────────────────────────────
  if (slide.type === "line_chart") {
    const pts = slide.series.slice(0, 12);
    const maxVal = Math.max(...pts.map(pt => pt.value), 1);
    const minVal = Math.min(...pts.map(pt => pt.value), 0);
    const range = maxVal - minVal || 1;
    const W_SVG = 320, H_SVG = 150, padL = 32, padR = 10, padT = 20, padB = 30;
    const innerW = W_SVG - padL - padR;
    const innerH = H_SVG - padT - padB;
    const xOf = (i: number) => padL + (i / Math.max(pts.length - 1, 1)) * innerW;
    const yOf = (v: number) => padT + innerH - ((v - minVal) / range) * innerH;
    const polyline = pts.map((pt, i) => `${xOf(i)},${yOf(pt.value)}`).join(" ");
    const [hovLine, setHovLine] = useState<number | null>(null);
    const H_SVG_L = H_SVG + 28; // extra room for info bar
    return (
      <W title={slide.title} subtitle={slide.subtitle} imgUrl={slideImg} imgPos={imgPos} imgLayout={slideLayout}>
        <svg viewBox={`0 0 ${W_SVG} ${H_SVG_L}`} preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: "100%", display: "block" }}>
          {/* Y grid lines */}
          {[0.25, 0.5, 0.75, 1].map(frac => {
            const y = padT + innerH - frac * innerH;
            return (
              <g key={frac}>
                <line x1={padL} y1={y} x2={W_SVG - padR} y2={y} stroke="#F3F4F6" strokeWidth={1} />
                <text x={padL - 3} y={y + 3} fontSize={6} fill="#9CA3AF" textAnchor="end">
                  {Math.round(minVal + range * frac).toLocaleString()}
                </text>
              </g>
            );
          })}
          <line x1={padL} y1={padT + innerH} x2={W_SVG - padR} y2={padT + innerH} stroke="#E5E7EB" strokeWidth={1} />
          {/* Area fill */}
          <polygon
            points={`${xOf(0)},${padT + innerH} ${polyline} ${xOf(pts.length - 1)},${padT + innerH}`}
            fill={p + "18"}
          />
          {/* Line */}
          <polyline points={polyline} fill="none" stroke={p} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {/* Vertical hover guide */}
          {hovLine !== null && (
            <line x1={xOf(hovLine)} y1={padT} x2={xOf(hovLine)} y2={padT + innerH}
              stroke={p} strokeWidth={1} strokeDasharray="3,3" opacity={0.6} />
          )}
          {/* Dots + hit areas */}
          {pts.map((pt, i) => {
            const x = xOf(i), y = yOf(pt.value);
            const isHov = hovLine === i;
            return (
              <g key={i} style={{ cursor: "pointer" }}
                onMouseEnter={() => setHovLine(i)} onMouseLeave={() => setHovLine(null)}>
                {/* Large invisible hit area */}
                <rect x={x - 14} y={padT} width={28} height={innerH} fill="transparent" />
                {/* Dot */}
                <circle cx={x} cy={y} r={isHov ? 6 : 3.5} fill={p} stroke="white" strokeWidth={2}
                  style={{ transition: "r 0.1s" }} />
                {/* Value label (always ≤6 pts, or on hover) */}
                {(pts.length <= 6 || isHov) && (
                  <text x={x} y={y - 9} fontSize={isHov ? 8 : 7} fill={p} textAnchor="middle" fontWeight="bold">{pt.value.toLocaleString()}</text>
                )}
                {/* X label */}
                <text x={x} y={padT + innerH + 12} fontSize={Math.max(6, Math.min(8, 72 / pts.length))} fill={isHov ? p : "#9CA3AF"} textAnchor="middle" fontWeight={isHov ? "bold" : "normal"}>
                  {pt.label}
                </text>
              </g>
            );
          })}
          {/* Fixed tooltip bar at bottom */}
          {hovLine !== null && (
            <g>
              <rect x={padL} y={H_SVG_L - 24} width={W_SVG - padL - padR} height={20} rx={4} fill="#1F2937" />
              <text x={padL + 8} y={H_SVG_L - 10} fontSize={10} fill="white" fontWeight="bold">
                {pts[hovLine].label}: {pts[hovLine].value.toLocaleString()}
              </text>
            </g>
          )}
        </svg>
      </W>
    );
  }

  // ── Pie / Donut chart (interactive) ──────────────────────────────────────────
  if (slide.type === "pie_chart") {
    const segs = slide.segments.slice(0, 7);
    const total = segs.reduce((sum, s3) => sum + s3.value, 0) || 1;
    const isDonut = slide.style === "donut";
    const PIE_COLORS = [p, "#6366F1", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];
    const [hovPie, setHovPie] = useState<number | null>(null);
    const cx = 70, cy = 70, r = 60, rInner = isDonut ? 26 : 0;

    let startAngle = -Math.PI / 2;
    const arcs = segs.map((seg, i) => {
      const sweep = (seg.value / total) * 2 * Math.PI;
      const endAngle = startAngle + sweep;
      const isHov = hovPie === i;
      // Slightly expand hovered segment
      const rr = isHov ? r + 4 : r;
      const x1 = cx + rr * Math.cos(startAngle);
      const y1 = cy + rr * Math.sin(startAngle);
      const x2 = cx + rr * Math.cos(endAngle);
      const y2 = cy + rr * Math.sin(endAngle);
      const largeArc = sweep > Math.PI ? 1 : 0;
      let d;
      if (isDonut) {
        const ri = rInner;
        const ix1 = cx + ri * Math.cos(startAngle);
        const iy1 = cy + ri * Math.sin(startAngle);
        const ix2 = cx + ri * Math.cos(endAngle);
        const iy2 = cy + ri * Math.sin(endAngle);
        d = `M ${x1} ${y1} A ${rr} ${rr} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${ri} ${ri} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;
      } else {
        d = `M ${cx} ${cy} L ${x1} ${y1} A ${rr} ${rr} 0 ${largeArc} 1 ${x2} ${y2} Z`;
      }
      // Midpoint for tooltip
      const midAngle = startAngle + sweep / 2;
      const tooltipX = cx + (rr + 10) * Math.cos(midAngle);
      const tooltipY = cy + (rr + 10) * Math.sin(midAngle);
      const result = { d, color: PIE_COLORS[i % PIE_COLORS.length], seg, pct: Math.round((seg.value / total) * 100), isHov, tooltipX, tooltipY };
      startAngle = endAngle;
      return result;
    });

    return (
      <W title={slide.title} subtitle={slide.subtitle} imgUrl={slideImg} imgPos={imgPos} imgLayout={slideLayout}>
        <div className="flex flex-col h-full gap-2">
          <div className="flex items-center gap-4 flex-1 min-h-0">
            <svg viewBox="0 0 140 140" style={{ flexShrink: 0, width: 130, height: 130 }}>
              {arcs.map((arc, i) => (
                <path key={i} d={arc.d} fill={arc.color} stroke="white" strokeWidth={1.5}
                  style={{ cursor: "pointer", transition: "all 0.15s ease", filter: arc.isHov ? `drop-shadow(0 0 4px ${arc.color}80)` : "none" }}
                  onMouseEnter={() => setHovPie(i)} onMouseLeave={() => setHovPie(null)} />
              ))}
              {isDonut && hovPie === null && (
                <>
                  <text x={cx} y={cy - 4} textAnchor="middle" fontSize={12} fontWeight="bold" fill="#111827">
                    {Math.round(total).toLocaleString()}
                  </text>
                  <text x={cx} y={cy + 10} textAnchor="middle" fontSize={7} fill="#9CA3AF">total</text>
                </>
              )}
              {isDonut && hovPie !== null && arcs[hovPie] && (
                <>
                  <text x={cx} y={cy - 4} textAnchor="middle" fontSize={12} fontWeight="bold" fill={arcs[hovPie].color}>
                    {arcs[hovPie].pct}%
                  </text>
                  <text x={cx} y={cy + 10} textAnchor="middle" fontSize={7} fill="#6B7280">
                    {arcs[hovPie].seg.label.slice(0, 12)}
                  </text>
                </>
              )}
            </svg>
            {/* Legend */}
            <div className="flex flex-col gap-1 overflow-hidden flex-1">
              {arcs.map((arc, i) => (
                <div key={i}
                  className="flex items-center gap-2 min-w-0 rounded-lg px-1.5 py-1 transition-all"
                  style={{ background: arc.isHov ? arc.color + "18" : "transparent", cursor: "pointer", transform: arc.isHov ? "translateX(3px)" : "none" }}
                  onMouseEnter={() => setHovPie(i)} onMouseLeave={() => setHovPie(null)}>
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0 transition-all" style={{ background: arc.color, transform: arc.isHov ? "scale(1.3)" : "none" }} />
                  <p className="text-xs truncate flex-1 transition-colors" style={{ color: arc.isHov ? arc.color : "#374151", fontWeight: arc.isHov ? 700 : 400 }}>
                    {arc.seg.label}
                  </p>
                  <p className="text-xs font-bold flex-shrink-0" style={{ color: arc.color }}>{arc.pct}%</p>
                </div>
              ))}
            </div>
          </div>
          {/* Info bar */}
          {hovPie !== null && arcs[hovPie] && (
            <div className="flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white flex items-center gap-2"
              style={{ background: "#1F2937" }}>
              <span style={{ color: arcs[hovPie].color }}>●</span>
              <span>{arcs[hovPie].seg.label}</span>
              <span className="ml-auto">{arcs[hovPie].seg.value.toLocaleString()}  ·  {arcs[hovPie].pct}%</span>
            </div>
          )}
        </div>
      </W>
    );
  }

  // ── Bullet list ───────────────────────────────────────────────────────────────
  if (slide.type === "bullet_list") return (
    <W title={slide.title} imgUrl={slideImg} imgPos={imgPos} imgLayout={slideLayout}>
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

  // ── Action plan (department-tagged recommendations) ─────────────────────────
  if (slide.type === "action_plan") return (
    <W title={slide.title} subtitle={slide.subtitle} imgUrl={slideImg} imgPos={imgPos} imgLayout={slideLayout}>
      {/* justify-start (not justify-center) on purpose: this list sits inside
          an `overflow-hidden` container above, and centering a column that's
          taller than its box clips evenly off BOTH ends — which in practice
          meant the very first (highest-priority) recommendation got its top
          sliced off whenever the available height was tight (e.g. on the
          public review page, which shares width with a comments sidebar).
          Top-aligning means any overflow gets trimmed off the bottom instead,
          so item #1 is always fully readable. */}
      <div className="h-full flex flex-col justify-start divide-y divide-gray-100">
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
