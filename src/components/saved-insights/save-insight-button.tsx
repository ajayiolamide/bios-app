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

  // A plain gray text link here turned out to be invisible — nobody
  // reported using it because nothing about it looked clickable. A real
  // pill with a fill and border reads as an actual button, and the amber
  // color ties it visually to the "Saved Insights" picker on the Reports
  // page (same color there), so the connection between "save this" and
  // "pick it later" is obvious even before anyone reads the label.
  const stateCls =
    state === "saved" ? "bg-indigo-50 text-indigo-600 border-indigo-200"
    : state === "error" ? "bg-red-50 text-red-600 border-red-200"
    : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100";

  return (
    <button
      onClick={handleSave}
      disabled={state === "saving" || state === "saved"}
      title={state === "saved" ? "Saved — pick it when building a report" : "Save this insight for a future report"}
      className={className ?? `flex items-center gap-1.5 text-[11px] font-medium rounded-full border px-2.5 py-1 transition-colors flex-shrink-0 ${stateCls}`}
    >
      {state === "saving" ? (
        <Loader2 size={11} className="animate-spin" />
      ) : state === "saved" ? (
        <BookmarkCheck size={11} />
      ) : (
        <Bookmark size={11} />
      )}
      {state === "saved" ? "Saved" : state === "error" ? "Failed" : "Save for report"}
    </button>
  );
}
