# BIOS App — Setup Guide

## 1. Install dependencies

```bash
cd ~/Documents/bios-app
npm install
```

## 2. Configure environment

```bash
cp .env.local.example .env.local
```

Open `.env.local` and fill in:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page, "anon public" key |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page, "service_role" key |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com |

## 3. Run the database migration

In the Supabase dashboard go to **SQL Editor** and paste + run the contents of:

```
supabase/migrations/001_initial.sql
```

This creates: `profiles`, `organizations`, `organization_members`, `events` tables with RLS policies, and an auto-org trigger on signup.

## 4. Configure Supabase Auth redirect URL

In Supabase dashboard → **Authentication → URL Configuration**:
- Site URL: `http://localhost:3000`
- Redirect URLs: `http://localhost:3000/auth/callback`

## 5. Start the dev server

```bash
npm run dev
```

Visit http://localhost:3000 — you'll be redirected to `/login`.

---

## Project structure

```
src/
├── app/
│   ├── (auth)/          # login + signup pages
│   ├── (dashboard)/     # protected app shell + all nav pages
│   └── auth/callback/   # Supabase OAuth callback
├── components/
│   ├── layout/          # Sidebar, Header, OrgSwitcher
│   └── ui/              # shadcn components
├── contexts/
│   └── org-context.tsx  # multi-tenant org switcher state
├── lib/supabase/        # browser / server / middleware clients
└── types/database.ts    # typed Supabase schema
supabase/
└── migrations/
    └── 001_initial.sql  # run this in Supabase SQL editor
```

## Phase 2 roadmap

- CSV event import + live event table
- Metric builder with recharts visualization
- Funnel builder + drop-off chart
- AI Analyst chat (Claude streaming)
- Org invite flow + member management
- API key generation for SDK ingestion
```
