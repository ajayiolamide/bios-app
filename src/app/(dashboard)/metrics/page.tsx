import { redirect } from "next/navigation";

// This page used to duplicate the Goal -> KPI -> Feature hierarchy already
// shown on Business Goals, with one real extra: trend charts. That chart is
// now a toggle on each KPI row on Business Goals itself (see KpiRow in
// src/app/(dashboard)/goals/page.tsx), so there's one place to manage and
// view KPIs instead of two. This route stays only so old links/bookmarks
// land somewhere useful instead of a 404.
export default function MetricsPageRedirect() {
  redirect("/goals");
}
