import { redirect } from "next/navigation";

// Old /insights route — now lives at /ai-analyst
export default function InsightsRedirect() {
  redirect("/ai-analyst");
}
