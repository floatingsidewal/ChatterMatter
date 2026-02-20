# Status

Show the current alignment state of the project.

## Important Guidelines

- **Read-only** — This command only reports, never modifies
- **Quick scan** — Don't read file contents, just check existence and counts
- **Actionable** — Suggest what to do next based on gaps

## Process

### Step 1: Check Directory Structure

Verify these paths exist:
- `align/` (root)
- `align/product/`
- `align/standards/`
- `align/features/`
- `align/support/`

### Step 2: Gather Metrics

**Product docs:**
- Check for `align/product/mission.md`
- Check for `align/product/roadmap.md`
- Check for `align/product/tech-stack.md`

**Standards:**
- Count `.md` files in `align/standards/` (recursive)
- Check for `align/standards/index.yml`
- If index exists, check if it's up to date (count entries vs files)

**Features:**
- Count folders in `align/features/`
- Identify most recent spec
- Check if any specs lack `summary.md` (not finalized)

**Support:**
- Count files in `align/support/guides/`
- Count files in `align/support/troubleshooting/`
- Count files in `align/support/runbooks/`

### Step 3: Present Status

Format output:

```
# Align Status

## Product Context
- [x] mission.md
- [x] roadmap.md
- [ ] tech-stack.md (missing)

## Standards
- 12 standards documented
- Index: up to date (12/12 indexed)
- Domains: api (4), database (3), frontend (5)

## Features
- 8 specs total
- 2 in progress (no summary.md)
- Most recent: 2026-01-22-user-auth

## Support
- 3 guides
- 5 troubleshooting docs
- 2 runbooks

## Suggestions
- [ ] Add tech-stack.md — Run `/plan-product`
- [ ] Finalize "user-auth" spec — Run `/align` to wrap up
```

### Step 4: Suggest Next Actions

Based on gaps, suggest commands:

| Gap | Suggestion |
|-----|------------|
| No `align/` directory | Run `/align` to get started |
| Missing product docs | Run `/plan-product` |
| No standards | Run `/discover-standards` |
| Index out of date | Run `/index-standards` |
| Unfinalized specs | Run `/align` on the active spec |
| No support docs | Consider `/create-support-doc` |

## Quick Mode

If user runs `/align-status quick` or `/align status`, just show counts:

```
Product: 2/3 | Standards: 12 | Specs: 8 (2 active) | Support: 10
```
