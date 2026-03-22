# Skill: ship-feature

Ship a focused feature with minimal scope.

## Steps

1. **Read only what's involved**
   - Liquid change: read the section file + its template JSON.
   - Edge Function change: read `index.ts` + any `_shared/` modules it imports.
   - DB change: read existing migration files first.

2. **State the plan** — which files change, why, and what deploy steps are needed.

3. **Edit with these constraints**
   - Do not touch code outside the task scope.
   - New CSS → `assets/commission-rings.css`. Not inline in Liquid.
   - New section setting key → update template JSON too.
   - Edge Function: validate all inputs, handle all errors, log to `processing_logs`.
   - DB migration: additive only. New NOT NULL column needs a DEFAULT. New table needs RLS.
   - `shopify-payment-webhook`: never skip HMAC check.

4. **Final check**
   - Liquid: section settings match template JSON?
   - Edge Function: input validation present? Error handling covers failure paths?
   - Migration: additive? RLS intact? Edge Function code updated alongside it?

5. **Output**: changed files + any manual deploy steps the user must run.
