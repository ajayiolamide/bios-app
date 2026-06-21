-- Read-only — run this in the Supabase SQL editor, nothing here writes data.
--
-- This checks whether your claim_submitted and claim_paid events carry a
-- shared identifier (e.g. claim_id) that ties them back to the same claim.
-- That's the difference between:
--   - the simple ratio KPI already built (claims paid ÷ claims submitted,
--     as a plain percentage over the same window), and
--   - a true "95% paid within 24h" SLA KPI, which needs to match each paid
--     claim back to its own submission to check the time between them.
-- If a shared field shows up in both result sets below with matching
-- values, the SLA version is buildable — tell me the field name and I'll
-- wire it up. If nothing matches, the ratio KPI is what you've got until
-- your event tracking adds one.

(
  select 'claim_submitted sample properties' as which, properties
  from public.events
  where name = 'claim_submitted'
  order by timestamp desc
  limit 5
)

union all

(
  select 'claim_paid sample properties' as which, properties
  from public.events
  where name = 'claim_paid'
  order by timestamp desc
  limit 5
);
