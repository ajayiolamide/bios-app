"use client";

// Wraps the main content area and shows the branded PageLoader during
// any route transition. Next.js App Router renders client-component page
// shells instantly on navigation — this intercepts that gap so users never
// see a blank or partial page between route changes.

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PageLoader } from "@/components/ui/page-loader";

export function NavigationLoader({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const prevPathRef = useRef(pathname);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      prevPathRef.current = pathname;
      setTransitioning(true);
      // Give the new page 2 seconds to load data and render.
      // Short enough to feel fast, long enough to cover most client fetches.
      const t = setTimeout(() => setTransitioning(false), 2000);
      return () => clearTimeout(t);
    }
  }, [pathname]);

  return (
    <div className="relative flex-1 overflow-hidden h-full">
      {/* Overlay during transitions — sits above everything, fades in quickly */}
      {transitioning && (
        <div
          className="absolute inset-0 z-50 bg-white flex items-center justify-center"
          style={{ animation: "fadeIn 80ms ease-in" }}
        >
          <PageLoader />
        </div>
      )}
      <div className="h-full overflow-y-auto p-6">{children}</div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
    </div>
  );
}
