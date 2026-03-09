-- ─────────────────────────────────────────────────────────────────────────────
-- Azoir Commission — post-payment backend schema
-- Run after 001_quote_requests.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Job reference sequence: AZR-YYYY-NNNNN
create sequence if not exists public.job_ref_seq start 1;

create or replace function public.next_job_ref()
returns text language sql as $$
  select 'AZR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.job_ref_seq')::text, 5, '0');
$$;

-- ── Payments ─────────────────────────────────────────────────────────────────
-- One row per Shopify order. shopify_order_id is the idempotency key.
create table if not exists public.payments (
  id                  uuid          primary key default gen_random_uuid(),
  created_at          timestamptz   not null default now(),
  quote_request_id    uuid          not null references public.quote_requests(id),
  shopify_order_id    text          not null unique,
  shopify_order_name  text,                        -- e.g. "#1001"
  amount              numeric(10,2) not null,
  currency            text          not null default 'AUD',
  status              text          not null default 'captured',
  raw_payload         jsonb                        -- full Shopify order webhook body
);

-- ── Jobs ─────────────────────────────────────────────────────────────────────
create table if not exists public.jobs (
  id                  uuid          primary key default gen_random_uuid(),
  created_at          timestamptz   not null default now(),
  payment_id          uuid          not null references public.payments(id),
  quote_request_id    uuid          not null references public.quote_requests(id),
  job_ref             text          unique default public.next_job_ref(),
  status              text          not null default 'new', -- new | in_progress | complete | cancelled
  assigned_to         text,
  internal_notes      text,
  due_at              timestamptz
);

-- ── AI outputs ───────────────────────────────────────────────────────────────
create table if not exists public.ai_outputs (
  id                  uuid          primary key default gen_random_uuid(),
  created_at          timestamptz   not null default now(),
  job_id              uuid          not null references public.jobs(id),
  output_type         text          not null, -- 'customer_confirmation' | 'job_sheet'
  model               text,
  prompt_tokens       int,
  output_tokens       int,
  content             text          not null
);

-- ── Notifications ─────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id                  uuid          primary key default gen_random_uuid(),
  created_at          timestamptz   not null default now(),
  job_id              uuid          not null references public.jobs(id),
  channel             text          not null, -- 'email' | 'sms' | 'whatsapp'
  recipient           text          not null,
  status              text          not null default 'pending', -- pending | sent | failed
  provider_id         text,                   -- Resend message ID or Twilio SID
  error_message       text,
  sent_at             timestamptz
);

-- ── Processing logs ───────────────────────────────────────────────────────────
create table if not exists public.processing_logs (
  id                  uuid          primary key default gen_random_uuid(),
  created_at          timestamptz   not null default now(),
  quote_request_id    uuid,
  payment_id          uuid,
  job_id              uuid,
  event               text          not null,
  level               text          not null default 'info', -- info | warn | error
  message             text,
  metadata            jsonb
);

-- ── RLS — service role only (Edge Functions) ──────────────────────────────────
alter table public.payments          enable row level security;
alter table public.jobs              enable row level security;
alter table public.ai_outputs        enable row level security;
alter table public.notifications     enable row level security;
alter table public.processing_logs   enable row level security;

-- No anon policies on backend tables

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists payments_quote_request_id_idx  on public.payments(quote_request_id);
create index if not exists jobs_payment_id_idx            on public.jobs(payment_id);
create index if not exists jobs_quote_request_id_idx      on public.jobs(quote_request_id);
create index if not exists ai_outputs_job_id_idx          on public.ai_outputs(job_id);
create index if not exists notifications_job_id_idx       on public.notifications(job_id);
create index if not exists processing_logs_job_id_idx     on public.processing_logs(job_id);
