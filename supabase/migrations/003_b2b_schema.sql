-- ─────────────────────────────────────────────────────────────────────────────
-- Azoir — B2B portal schema
-- Run after 002_backend_schema.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── B2B Registrations ─────────────────────────────────────────────────────────
create table if not exists public.b2b_registrations (
  id                    uuid          primary key default gen_random_uuid(),
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),

  shopify_customer_id   text          not null unique,
  contact_name          text          not null,
  company_name          text          not null,
  email                 text          not null,
  phone                 text,
  website               text,
  business_type         text,          -- retailer | wholesaler | designer | other
  country               text,
  tax_id                text,
  resale_cert_url       text,          -- path in b2b-documents storage bucket
  resale_cert_expires_at date,

  status                text          not null default 'pending', -- pending | approved | rejected
  reviewed_at           timestamptz,
  reviewed_by           text,          -- admin shopify_customer_id
  rejection_reason      text,
  internal_notes        text
);

-- ── B2B Orders ────────────────────────────────────────────────────────────────
create table if not exists public.b2b_orders (
  id                    uuid          primary key default gen_random_uuid(),
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),

  b2b_registration_id   uuid          not null references public.b2b_registrations(id),
  shopify_customer_id   text          not null,

  -- Denormalized contact (snapshot at order time)
  contact_name          text          not null,
  company_name          text          not null,
  email                 text          not null,
  phone                 text,
  country               text,

  -- Commission details
  contact_method        text,          -- email | sms | whatsapp
  metal                 text,
  stones                text,
  notes                 text,
  reference_links       text[],
  reference_image_urls  text[],

  -- B2B-specific
  po_number             text,
  quantity              int           not null default 1,
  deadline_at           date,

  -- Design fee
  design_fee_amount     numeric(10,2) not null default 90.00,
  design_fee_status     text          not null default 'pending', -- pending | paid | waived
  design_fee_paid_at    timestamptz,
  design_fee_payment_ref text,         -- Shopify order ID
  shopify_order_name    text,          -- e.g. "#1002"

  -- Order status
  status                text          not null default 'pending_payment',
  -- pending_payment | paid | in_design | in_production | shipped | complete | cancelled

  -- Shipping
  tracking_number       text,
  tracking_carrier      text,
  shipped_at            timestamptz
);

-- ── B2B Status History ────────────────────────────────────────────────────────
create table if not exists public.b2b_status_history (
  id                    uuid          primary key default gen_random_uuid(),
  created_at            timestamptz   not null default now(),

  b2b_order_id          uuid          not null references public.b2b_orders(id),
  from_status           text,
  to_status             text          not null,
  changed_by            text,          -- admin shopify_customer_id or 'system'
  note                  text
);

-- ── updated_at triggers ───────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger b2b_registrations_updated_at
  before update on public.b2b_registrations
  for each row execute function public.set_updated_at();

create trigger b2b_orders_updated_at
  before update on public.b2b_orders
  for each row execute function public.set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.b2b_registrations  enable row level security;
alter table public.b2b_orders         enable row level security;
alter table public.b2b_status_history enable row level security;

-- All access goes through Edge Functions (service role) — no anon policies

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists b2b_registrations_customer_id_idx  on public.b2b_registrations(shopify_customer_id);
create index if not exists b2b_registrations_status_idx       on public.b2b_registrations(status);
create index if not exists b2b_orders_registration_id_idx     on public.b2b_orders(b2b_registration_id);
create index if not exists b2b_orders_customer_id_idx         on public.b2b_orders(shopify_customer_id);
create index if not exists b2b_orders_status_idx              on public.b2b_orders(status);
create index if not exists b2b_status_history_order_id_idx    on public.b2b_status_history(b2b_order_id);
