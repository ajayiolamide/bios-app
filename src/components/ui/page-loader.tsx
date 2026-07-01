"use client";

import { useEffect, useState } from "react";

export function PageLoader() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const startTime = performance.now();
    const duration = 3200; // ease to ~95% over ~3s

    let frame: number;
    const tick = (now: number) => {
      const elapsed = Math.min(now - startTime, duration);
      const t = elapsed / duration;
      const eased = 1 - Math.pow(1 - t, 2.2);
      setProgress(Math.round(eased * 95));
      if (elapsed < duration) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="flex items-center justify-center h-full min-h-[70vh]">
      <div className="flex flex-col items-center gap-6 select-none">

        {/* Logo mark — animated glyph with pulsing ring */}
        <div className="relative flex items-center justify-center">
          {/* Outer pulse rings */}
          <span
            className="absolute rounded-full"
            style={{
              width: 88,
              height: 88,
              background: "radial-gradient(circle, rgba(87,106,231,0.15) 0%, transparent 70%)",
              animation: "glyph-ring-outer 2.4s ease-in-out infinite",
            }}
          />
          <span
            className="absolute rounded-full"
            style={{
              width: 68,
              height: 68,
              background: "radial-gradient(circle, rgba(87,106,231,0.2) 0%, transparent 70%)",
              animation: "glyph-ring-inner 2.4s ease-in-out infinite 0.3s",
            }}
          />
          {/* The actual logo glyph — breathes */}
          <div
            style={{
              width: 48,
              height: 48,
              animation: "glyph-breathe 2.4s ease-in-out infinite",
              position: "relative",
              zIndex: 10,
            }}
          >
            <svg
              width="48"
              height="48"
              viewBox="0 0 62 62"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M11 17.9091L35.5455 49L40.4545 42.4545L16.7273 13L11 17.9091Z"
                fill="#576AE7"
                style={{ animation: "glyph-path 2.4s ease-in-out infinite" }}
              />
              <path
                d="M24.9102 20.3636L41.2738 40.8182L46.1829 34.2727L29.8192 14.6364L24.9102 20.3636Z"
                fill="#576AE7"
                style={{ animation: "glyph-path 2.4s ease-in-out infinite 0.15s" }}
              />
              <path
                d="M35.5464 18.7272L47.0009 33.4545C48.9181 31.2178 49.9929 29.1457 51.91 26.909L40.4555 13.8181L35.5464 18.7272Z"
                fill="#576AE7"
                style={{ animation: "glyph-path 2.4s ease-in-out infinite 0.3s" }}
              />
            </svg>
          </div>
        </div>

        {/* Wordmark */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-xl font-bold tracking-tight text-gray-900">
            metrik
          </span>
          <span className="text-xs text-gray-400 tracking-wide">
            Compiling your data&hellip;
          </span>
        </div>

        {/* Progress bar + counter */}
        <div className="w-56 flex flex-col gap-1.5">
          <div
            className="w-full rounded-full bg-gray-100 overflow-hidden"
            style={{ height: 3 }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${progress}%`,
                transition: "width 80ms linear",
                background: "linear-gradient(90deg, #576AE7, #8b5cf6)",
              }}
            />
          </div>
          <div className="flex justify-end">
            <span className="text-[11px] tabular-nums text-gray-400">
              {progress}%
            </span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes glyph-breathe {
          0%, 100% { transform: scale(1);    filter: drop-shadow(0 2px 8px rgba(87,106,231,0.3)); }
          50%       { transform: scale(1.1); filter: drop-shadow(0 4px 16px rgba(87,106,231,0.55)); }
        }
        @keyframes glyph-ring-outer {
          0%, 100% { transform: scale(1);    opacity: 0.6; }
          50%       { transform: scale(1.25); opacity: 0; }
        }
        @keyframes glyph-ring-inner {
          0%, 100% { transform: scale(1);    opacity: 0.7; }
          50%       { transform: scale(1.2);  opacity: 0; }
        }
        @keyframes glyph-path {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.75; }
        }
      `}</style>
    </div>
  );
}
