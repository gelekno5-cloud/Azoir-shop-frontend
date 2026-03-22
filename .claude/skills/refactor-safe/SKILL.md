# Skill: refactor-safe

Improve clarity without changing behavior. If a change alters what the code does — stop and ask.

## Steps

1. **Read first.** Note `!important` flags, workarounds, or comments explaining why something is non-obvious — these are intentional.

2. **Apply improvements** (extract repeated logic, simplify nested conditions, remove dead code).

3. **Hard constraints — do not cross:**
   - Do not rename CSS classes — Liquid references them by string.
   - Do not rename section setting keys — template JSONs reference them by string.
   - Do not reorder CSS — specificity is order-dependent.
   - Do not change Edge Function response shapes — clients depend on them.
   - Do not remove event listeners or change their trigger conditions.

4. **Output**: what improved · what was left alone and why.
