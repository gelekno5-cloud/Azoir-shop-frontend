# Skill: bugfix

Find root cause. Apply smallest safe fix.

## Steps

1. **Read the actual code** — do not diagnose from description alone.
   Trace the relevant path: form submit → JS fetch → Edge Function → DB → response → redirect.

2. **Name the root cause** in one sentence before writing any fix.
   Classify: UI (Liquid/CSS/JS) · data (wrong value saved) · integration (wrong API call/shape) · config (wrong section setting or env var).

3. **Fix only the broken thing.** Do not clean up surrounding code.
   - DB change required? New migration file. Additive only. Confirm with user if destructive.
   - New secret required? Flag it explicitly — do not assume it exists.

4. **Check the fix mentally**: empty input · network failure · duplicate submission.

5. **Output**: root cause (one sentence) · what changed · deploy steps if any.
