# Create Support Doc

Create internal support documentation for troubleshooting and operations.

## Important Guidelines

- **Always use AskUserQuestion tool** when asking the user anything
- **Keep docs actionable** — Focus on steps, not background
- **One topic per doc** — Easier to find and maintain

## Process

### Step 1: Determine Doc Type

Use AskUserQuestion:

What kind of support doc are you creating?

1. **Guide** — How to do something (setup, configuration, workflows)
2. **Troubleshooting** — How to diagnose/fix specific issues
3. **Runbook** — Step-by-step operational procedures

### Step 2: Gather Context

Based on doc type, ask:

**For Guides:**
- What task does this guide cover?
- Who is the audience (developers, ops, new team members)?

**For Troubleshooting:**
- What symptom or error does this address?
- What are the common causes?

**For Runbooks:**
- What operation does this cover?
- What systems/services are involved?

### Step 3: Draft the Doc

Create in appropriate location:
- Guides → `align/support/guides/`
- Troubleshooting → `align/support/troubleshooting/`
- Runbooks → `align/support/runbooks/`

Use this structure:

**Guide template:**
```markdown
# [Title]

## Overview
[1-2 sentences on what this covers]

## Steps
1. ...
2. ...

## Notes
- [Any gotchas or tips]
```

**Troubleshooting template:**
```markdown
# [Symptom/Error]

## Symptoms
- [What the user sees]

## Causes
1. **[Cause]** — [How to identify]

## Solutions
### For [Cause 1]
1. ...
```

**Runbook template:**
```markdown
# [Operation Name]

## When to Use
[Trigger conditions]

## Prerequisites
- [ ] ...

## Steps
1. ...

## Rollback
[If something goes wrong]
```

### Step 4: Confirm and Create

Show draft to user, get confirmation, create file.
