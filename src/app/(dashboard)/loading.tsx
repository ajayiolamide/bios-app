// Next.js automatically uses this as the Suspense fallback for every route
// inside the (dashboard) group — replaces the old plain spinner.
import { PageLoader } from "@/components/ui/page-loader";

export default function DashboardLoading() {
  return <PageLoader />;
}
