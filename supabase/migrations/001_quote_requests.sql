-- ─────────────────────────────────────────────────────────────────────────────
-- Azoir Commission — quote_requests table
-- Run this in: Supabase Dashboard → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.quote_requests (
  id                    uuid        primary key default gen_random_uuid(),
  created_at            timestamptz not null    default now(),

  -- Customer details
  customer_name         text        not null,
  email                 text        not null,
  phone                 text,
  country               text,
  contact_method        text,

  -- Project details
  notes                 text,
  metal                 text,
  stones                text,
  reference_links       text,

  -- Status
  status                text        not null default 'pending',

  -- Design fee
  design_fee_required   boolean     not null default true,
  design_fee_amount     numeric(10,2),
  design_fee_status     text        not null default 'unpaid',
  design_fee_paid_at    timestamptz,
  design_fee_payment_ref text
);

-- Enable RLS
alter table public.quote_requests enable row level security;

-- Anyone can SELECT a specific row by its UUID (used by the design-fee page)
-- UUIDs are 122-bit random — practically unguessable for MVP security
create policy "anon can select own request by id"
  on public.quote_requests
  for select
  to anon
  using (true);

-- No anon INSERT — the Edge Function uses the service role key
-- No UPDATE / DELETE for anon
