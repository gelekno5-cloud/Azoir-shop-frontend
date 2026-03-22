# Backend Rules — Azoir

Stack: Supabase Edge Functions (Deno/TS). Shared modules in `supabase/functions/_shared/`.

## Structure
- Entry: `supabase/functions/<name>/index.ts`
- Return shape: `{ success: true, data }` or `{ success: false, error: "message" }`
- Always set CORS headers from `ALLOWED_ORIGINS` env var.

## Validation & Security
- Validate all fields before any DB write. Return `400` with a descriptive message on failure.
- Never trust `request_id` from the client — verify the row exists before using it.
- `shopify-payment-webhook`: HMAC must be verified before any DB write. Non-negotiable.
- `process-job`: `PROCESS_JOB_SECRET` header must be checked. Never skip.
- Service role client stays inside Edge Functions only. Anon key is client-side only.

## Database
- `.single()` when expecting one row — handle the null case explicitly.
- `payments.shopify_order_id` is the idempotency key — always upsert, never bare insert.

## Error Handling
- Catch all async errors. A swallowed webhook error = lost revenue.
- Log failures to `processing_logs` with `job_id`, step name, and error message.
- `5xx` for unexpected failures only. Use specific `4xx` for client errors.

## Notifications
- Always record delivery attempt in `notifications` table regardless of send success/failure.
- Internal job sheet → `INTERNAL_EMAIL` env var. Customer confirmation → email from `quote_requests`.
