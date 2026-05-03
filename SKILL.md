---
name: goal-notes
description: Capture persistent notes and improvement points whenever a user invokes /goal or asks to manage goal memory, so future Codex sessions inherit useful objective context without storing secrets.
metadata:
  short-description: Persist goal context and improvement notes
---

# Goal Notes

Use this skill whenever the user invokes `/goal`, asks to start or update an explicit goal, or asks to preserve lessons/improvement points for future sessions.

## Purpose

Goal notes are lightweight continuity records. They preserve:
- the goal text and repo/session context,
- concrete acceptance criteria or verification reminders,
- risks, assumptions, and follow-up improvements discovered while working,
- completion evidence when a goal finishes.

They do **not** replace the normal goal tool/state. They add durable memory for future agents.

## Storage

Prefer project-local storage when a repository/workspace is available:
- Markdown ledger: `.omx/goal-notes.md`
- Machine-readable event log: `.omx/goal-notes.jsonl`

If no project root can be resolved, fall back to:
- `~/.codex/goal-notes/goal-notes.md`
- `~/.codex/goal-notes/goal-notes.jsonl`

## Workflow

1. Detect the goal request.
   - Strong trigger: prompt begins with `/goal` or contains a standalone `/goal ...` line.
   - Also use this skill for explicit goal retrospectives, goal handoffs, and future-session improvement notes.
2. Capture only useful continuity context.
   - Objective: the requested goal text after `/goal`.
   - Context: cwd, git root, branch, and session id if available.
   - Improvement points: risks, reminders, checks to run, UX/product lessons, and unresolved decisions.
3. Redact sensitive data.
   - Do not store secrets, tokens, credentials, auth cookies, QR contents, raw invoices, or unnecessary personal data.
   - Replace likely sensitive values with `[redacted]`.
4. Keep notes short and actionable.
   - Prefer bullets future agents can execute.
   - Avoid narrative transcripts.
5. On completion, append final evidence.
   - Tests/builds run, files changed, commits/PRs, known gaps.

## Hook automation

This skill includes `scripts/goal-notes-hook.js`, a non-blocking Codex native `UserPromptSubmit` hook helper. It reads the hook JSON from stdin, records `/goal` prompts, and exits `0` without emitting stdout so existing hooks can continue normally.

Install/wire it by adding a separate `UserPromptSubmit` command hook before or after existing hooks:

```json
{
  "type": "command",
  "command": "node \"/home/victo/.codex/skills/goal-notes/scripts/goal-notes-hook.js\""
}
```

The helper is intentionally best-effort: failures are logged to stderr and never block the user prompt.

## Manual note pattern

When manually adding a goal note, use this compact shape:

```markdown
## 2026-05-03T12:34:56.000Z — goal
- Objective: implement X
- Context: repo `/path`, branch `feature/x`
- Acceptance: test Y passes; browser flow Z verified
- Improvement points:
  - Future agents should inspect A before changing B.
  - Avoid C unless D is verified.
```
