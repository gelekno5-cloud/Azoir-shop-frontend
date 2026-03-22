# Database Rules — Azoir

## Migration Rules
- New numbered file per change: `supabase/migrations/NNN_description.sql`
- Never edit existing migration files — they may already be applied in production.
- Prefer additive changes. Flag any DROP or RENAME as destructive — confirm with user before writing.
- New `NOT NULL` column without a DEFAULT will fail on a live table. Always add DEFAULT or make nullable.
- New table must include `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.

## RLS Policies
- `quote_requests`: anon SELECT by UUID only. Insert via service role in Edge Function.
- All other tables (`payments`, `jobs`, `ai_outputs`, `notifications`, `processing_logs`): service role only.
- Never disable RLS. Never add anon INSERT/UPDATE/DELETE policies.

## Conventions
- Primary keys: `UUID` with `gen_random_uuid()` default.
- Timestamps: `created_at TIMESTAMPTZ DEFAULT now()`.
- Foreign keys: explicit `REFERENCES table(id)` with documented `ON DELETE` behavior.

## Before Writing a Migration
1. Is this additive? If not — stop and flag.
2. Does new column have DEFAULT or nullable? If not — will break live table.
3. Do existing RLS policies still hold?
4. Does Edge Function code need updating alongside this migration?
5. What's the rollback?
