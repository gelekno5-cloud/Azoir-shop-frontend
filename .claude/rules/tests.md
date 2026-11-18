# Tests Rules — Azoir

One automated suite: the server's pure payload builders (`books-payloads.js`), tested with Node's built-in runner in `books-payloads.test.js` (`npm test`; `node:test`, one assertion per `test()`). Everything else is manual verification.

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
- Server payload builders: add to `books-payloads.test.js` (`node:test`); keep `server.js` itself out of tests (it listens on import).
- Location: `supabase/functions/<name>/index.test.ts`
- Highest-value targets: HMAC verification, idempotency (duplicate `shopify_order_id`), form validation logic.
- Do not test Liquid rendering, CSS output, or third-party API internals.
