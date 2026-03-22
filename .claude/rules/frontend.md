# Frontend Rules — Azoir

Stack: Liquid + vanilla JS. No build step. No frameworks in sections.

## JS
- Scope all `querySelector` calls to the section root element, not `document`.
- Keep JS in a single `<script>` at the bottom of the section file. No inline handlers.
- Disable submit button during async POST. Re-enable on completion (success or error).
- Always handle fetch errors with a visible inline message — never just `console.log`.

## Forms
- Validate with JS before submit. Show shake animation + red border + `.cr-error` message adjacent to the field.
- Do not rely on browser `required` alone — it gives no visual feedback on shake-style UX.

## CSS
- New styles go in `assets/commission-rings.css`, not inline in Liquid.
- Class prefixes: `cr-` · `design-fee__` · `bz-` (legacy). Do not mix.
- Use `!important` only to beat theme specificity on active/state classes. Comment why.
- Transitions: `0.12s ease`. Hard limit.

## Uploads
- Reject files >10MB client-side before uploading.
- Show preview grid with hover overlay + remove button.
- Storage destination comes from `section.settings.supabase_bucket`.
