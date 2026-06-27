-- Save the goal description a visitor typed on the landing page.
-- Used to pre-populate the onboarding wizard after they sign up.

alter table public.waitlist
  add column if not exists goal_description text;
