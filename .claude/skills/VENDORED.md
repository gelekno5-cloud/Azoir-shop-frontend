# Vendored skills — provenance

Not a skill. A record of which skills here came from outside the project.

## leonxlnx/taste-skill — anti-slop frontend design

**Source:** https://github.com/leonxlnx/taste-skill · MIT © 2026 Leonxlnx
**Vendored:** 2026-08-20 · **Upstream:** installable as a Claude plugin marketplace

Copied verbatim so the set stays pinned and reviewable. `LICENSE.txt` sits in each skill directory.
Directory names follow upstream; the skill `name:` in frontmatter differs.

| Directory | Skill name | What it does |
|---|---|---|
| `taste-skill` | `design-taste-frontend` | Landing pages and portfolios that don't look templated. Audit-first on redesigns, strict pre-flight. |
| `redesign-skill` | `redesign-existing-projects` | Audits an existing site, finds generic AI patterns, applies premium standards without breaking behaviour. |

Both are scoped to **marketing/landing surfaces** — which is exactly what `web/` is.

### Deliberately not vendored (upstream has 13)

- `brutalist-skill` — declassified-blueprint aesthetic. Wrong for a fine-jewelry brand.
- `soft-skill`, `minimalist-skill` — aesthetic-direction skills that would compete with the
  existing `frontend-design` skill for the same triggers. Adding them makes skill selection
  less reliable, not more.
- `gpt-tasteskill` — mandates GSAP ScrollTrigger and Python-driven layout randomization. Far
  heavier than a static site with no build step needs.
- `imagegen-frontend-web`, `imagegen-frontend-mobile`, `brandkit`, `image-to-code-skill` —
  these generate AI imagery. Azoir sells real pieces made by hand; the gallery must be real
  photography of real work. Presenting generated renders as the atelier's output would be
  a straightforward misrepresentation to customers.
- `stitch-skill` — targets Google Stitch. `output-skill`, `taste-skill-v1` — generic / legacy.

---

## ⚠ Two stale files these skills will trip over

Both predate the current site and point agents at the dead Shopify theme:

1. **`.claude/rules/frontend.md`** describes Liquid + vanilla JS and sends new CSS to
   `assets/commission-rings.css`. The live site is plain HTML/CSS in **`web/`**, styled by
   **`web/azoir.css`**. An agent following these rules edits files that are never served.

2. **`.claude/skills/design-review/SKILL.md`** gives the brand palette as black `#0a0a0a`,
   cream `#fafaf8` / `#f5f4f0`, green `#08CB00`. The live site is **blue and light** —
   `#5B7FD4`, Cormorant Garamond + DM Sans.

`HANDOFF.md`, not `CLAUDE.md`, is the accurate description of the live site. Fix these two
before leaning on the taste skills, or they will do good work in the wrong place.
