# Tests Rules — Azoir

No automated test suite. Manual verification is current standard.

## Smoke Test
`test-email.sh` — end-to-end pipeline test. Requires `PROCESS_JOB_SECRET` in env.

## Local Edge Function Testing
```bash
npx supabase functions serve FUNCTION_NAME
```
Send requests with `curl`. For webhook testing, manually construct an HMAC-signed payload.

## Pre-Ship Checklist (Edge Functions)
- [ ] Deploys without error
- [ ] Happy path returns expected response
- [ ] Missing required field returns 400
- [ ] Invalid HMAC returns 401
- [ ] DB row created/updated correctly (check Supabase dashboard)

## If Adding Tests
- Location: `supabase/functions/<name>/index.test.ts`
- Highest-value targets: HMAC verification, idempotency (duplicate `shopify_order_id`), form validation logic.
- Do not test Liquid rendering, CSS output, or third-party API internals.
