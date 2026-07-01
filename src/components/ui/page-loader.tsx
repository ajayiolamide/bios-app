"use client";

import { useEffect, useState } from "react";

export function PageLoader() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Eased progress: fast start → slow finish (never actually reaches 100 — page takes over)
    const startTime = performance.now();
    const duration = 2800; // ms to reach ~95%

    let frame: number;
    const tick = (now: number) => {
      const elapsed = Math.min(now - startTime, duration);
      // Ease-out curve: starts fast, decelerates toward 95%
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

        {/* Logo mark — pulsing ring + M */}
        <div className="relative flex items-center justify-center">
          {/* Outer pulse ring */}
          <span
            className="absolute rounded-full bg-indigo-100"
            style={{
              width: 72,
              height: 72,
              animation: "metrik-pulse 2s ease-in-out infinite",
            }}
          />
          {/* Icon container */}
          <div
            className="relative z-10 flex items-center justify-center rounded-2xl bg-indigo-600"
            style={{ width: 52, height: 52 }}
          >
            {/* Simple bar-chart icon — Metrik's visual metaphor */}
            <svg
              width="26"
              height="26"
              viewBox="0 0 26 26"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect x="3"  y="14" width="5" height="9" rx="1.5" fill="white" fillOpacity="0.6" />
              <rect x="10" y="8"  width="5" height="15" rx="1.5" fill="white" />
              <rect x="17" y="3"  width="5" height="20" rx="1.5" fill="white" fillOpacity="0.6" />
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
              className="h-full rounded-full bg-indigo-500"
              style={{
                width: `${progress}%`,
                transition: "width 80ms linear",
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

      {/* Pulse keyframe — injected once */}
      <style>{`
        @keyframes metrik-pulse {
          0%, 100% { transform: scale(1);   opacity: 0.5; }
          50%       { transform: scale(1.18); opacity: 0;   }
        }
      `}</style>
    </div>
  );
}
