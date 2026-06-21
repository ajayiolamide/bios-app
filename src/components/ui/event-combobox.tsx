"use client";

import { useEffect, useRef, useState } from "react";

// A plain <select> full of event names stops being usable once an org has
// synced a couple hundred events from Mixpanel — there's no way to find
// "hosp_search_failed" in a 250-item alphabetical list without scrolling
// blind. This is a type-to-filter combobox that still falls back to letting
// someone type a brand-new event name that doesn't exist yet (the event may
// not have fired before — see metrics.ts's optional event_name design).
export function EventCombobox({
  value,
  onChange,
  options,
  placeholder = "Search events…",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the visible text in sync if the value changes from outside (e.g.
  // form reset) without fighting the user's own typing.
  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = (q ? options.filter((o) => o.toLowerCase().includes(q)) : options).slice(0, 50);
  const exactMatch = options.some((o) => o.toLowerCase() === q);

  function select(name: string) {
    onChange(name);
    setQuery(name);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-300"
      />
      {open && (filtered.length > 0 || q) && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {filtered.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => select(n)}
              className="w-full text-left px-2.5 py-1.5 text-[11px] text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 truncate font-mono"
            >
              {n}
            </button>
          ))}
          {q && !exactMatch && (
            <div className="px-2.5 py-1.5 text-[11px] text-gray-400 border-t border-gray-50 italic">
              No match — typing this in will use &quot;{query.trim()}&quot; as a new event name.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
