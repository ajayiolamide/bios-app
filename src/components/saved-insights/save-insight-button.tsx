"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react";
import { saveInsight } from "@/app/actions/saved-insights";

// Drop this next to any AI-generated text, anywhere in the app, to let the
// user pin it into the saved-insights library — then it shows up as a
// pickable item when building a report, instead of disappearing the moment
// they navigate away from whatever screen generated it.
export function SaveInsightButton({
  orgId, source, content, context, className,
}: {
  orgId: string;
  source: string;
  content: string;
  context?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function handleSave() {
    if (state === "saving" || state === "saved" || !orgId) return;
    setState("saving");
    const res = await saveInsight(orgId, source, content, context);
    if (res.error) {
      setState("error");
      setTimeout(() => setState("idle"), 2000);
    } else {
      setState("saved");
    }
  }

  return (
    <button
      onClick={handleSave}
      disabled={state === "saving" || state === "saved"}
      title={state === "saved" ? "Saved — pick it when building a report" : "Save this insight for a future report"}
      className={className ?? "flex items-center gap-1 text-[11px] text-gray-400 hover:text-indigo-600 transition-colors flex-shrink-0"}
    >
      {state === "saving" ? (
        <Loader2 size={11} className="animate-spin" />
      ) : state === "saved" ? (
        <BookmarkCheck size={11} className="text-indigo-500" />
      ) : (
        <Bookmark size={11} />
      )}
      {state === "saved" ? "Saved" : state === "error" ? "Failed" : "Save for report"}
    </button>
  );
}
