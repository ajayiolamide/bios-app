// Names that should never surface as pickable "events" — Mixpanel's own
// internal/autocapture/session-replay bookkeeping (always "$"-prefixed by
// convention), and a stray case where a client mistakenly tracked a literal
// email address as the event name. Applied at read time as a second line of
// defense on top of filtering these out at sync time, so any junk that's
// already in the table (or sneaks back in some other way) still never shows
// up in a picker.
//
// Lives in its own plain module (no "use server") because it's a synchronous
// helper — a "use server" file may only export async functions, and putting
// this here previously broke the production build.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isRealEventName(name: string): boolean {
  const n = name?.trim();
  return !!n && !n.startsWith("$") && !EMAIL_RE.test(n);
}
