# Skill: design-review

Review UI against the Azoir luxury/minimal standard.

## Brand Reference
- Black: `#0a0a0a` · Cream: `#fafaf8` / `#f5f4f0` · Green `#08CB00` = pay button hover only
- Transitions: `0.12s ease`. Anything slower feels cheap.
- Hover lift: `translateY(-4px)` · `box-shadow: 0 12px 32px rgba(0,0,0,0.09)`
- No gradients. No text shadows. No decorative flourishes. Typography defers to theme.

## What to Check
- Is anything outside the brand palette?
- Is green used anywhere except the pay button hover?
- Are any transitions slower than `0.12s`?
- Do form error states show clearly, adjacent to the field?
- Does the upload zone look intentional and inviting — not like a browser default?
- Do active/selected states (contact method buttons, etc.) read clearly?
- On mobile: do touch targets meet 44px minimum? Does the phone+country combo still work?
- Does anything feel generic, decorative, or off-brand for a luxury jeweller?

## Output Format
For each issue: **Location** (file + class) · **Issue** · **Fix** (specific CSS or markup).
