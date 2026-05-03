---
name: goal-notes
description: Capture persistent project-level goal notes, acceptance reminders, and improvement points for any AI assistant, CLI, or automation workflow without storing secrets.
metadata:
  short-description: Persist project-level goal context for future assistant sessions
---

# Goal Notes

Use this skill whenever a user invokes `/goal`, asks to preserve goal memory, or wants future assistant sessions to inherit concise objective context and verification reminders.

Goal Notes is assistant-neutral: the reusable CLI writes local project memory for any shell, CI job, Claude/Gemini/OpenCode workflow, or Codex/OMX hook while preserving the legacy Codex hook entrypoint.

## What to capture

Keep notes short, private, and actionable:

- Objective and acceptance criteria after `/goal` or an explicit goal request.
- Repo/workspace context, branch, source runtime, and session id when available.
- Future-session reminders, risks, unresolved decisions, and verification evidence.
- Improvement points that would prevent a future assistant from repeating mistakes.

Do not store transcripts, secrets, credentials, QR contents, raw invoices, or unnecessary personal data.

## Universal CLI usage

Run from any project or pass `--cwd` explicitly:

```bash
node scripts/goal-notes.js capture --goal "Ship address matching" --source shell
node scripts/goal-notes.js capture --goal "Review OCR gaps" --prompt "$PROMPT" --source claude
node scripts/goal-notes.js capture --goal "CI release verification" --source ci --quiet
```

Useful flags:

- `--goal` — objective text to persist.
- `--prompt` — original prompt excerpt; `/goal ...` is extracted when `--goal` is omitted.
- `--source` — runtime label such as `shell`, `claude`, `gemini`, `opencode`, `ci`, or `codex-native`.
- `--cwd` — project/workspace directory used for root detection.
- `--store universal|omx|auto` — explicit storage target.
- `--quiet` — suppress human CLI success output.

`GOAL_NOTES_STORE` can set the store when `--store` is not provided. Invalid stores fail closed for human CLI usage.

## Storage model

Default universal storage is project-level and private-by-default:

- Markdown ledger: `.goal-notes/goal-notes.md`
- Machine-readable log: `.goal-notes/goal-notes.jsonl`

Project root resolution uses the nearest Git root first, then common project markers such as `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `AGENTS.md`, or `.project`, then the supplied cwd.

If the cwd is unavailable, universal storage falls back to `$GOAL_NOTES_HOME` or `~/.goal-notes`. The Codex/OMX adapter falls back to `~/.codex/goal-notes`.

No mirroring, migration, or split writes happen automatically. Each invocation writes to exactly one deterministic store. `--store auto` uses existing `.omx/goal-notes.md` or `.omx/goal-notes.jsonl` only when one already exists; a bare `.omx/` directory is not enough.

## Privacy limits

For universal project storage, the CLI creates `.goal-notes/.gitignore`:

```gitignore
# Goal Notes stores private local assistant memory here.
*
!.gitignore
```

The repository `.gitignore` should also ignore `.goal-notes/`. Note payload files are appended with `0o600` permissions where the filesystem supports it.

Redaction is best-effort, not a security boundary. It covers common token/secret patterns, CPF, CNPJ, and long numeric strings, but users and agents should still avoid putting sensitive material in goals.

## Runtime adapters

### Generic shell/manual capture

```bash
node scripts/goal-notes.js capture --goal "Document release acceptance gates" --source shell
```

### Codex native hook / OMX compatibility

`scripts/goal-notes-hook.js` remains the stable Codex hook entrypoint. It delegates to the universal CLI in hook mode, stays stdout-silent, exits `0` on hook failures, and keeps the legacy project default `.omx/goal-notes.{md,jsonl}`.

Example hook command:

```json
{
  "type": "command",
  "command": "node \"/home/victo/.codex/skills/goal-notes/scripts/goal-notes-hook.js\""
}
```

### Claude / Claude Code

```bash
node scripts/goal-notes.js capture --goal "Summarize checkout risks" --source claude --cwd "$PWD"
```

### Gemini / OpenCode

```bash
node scripts/goal-notes.js capture --goal "Track Android QA blockers" --source gemini --cwd "$PWD"
node scripts/goal-notes.js capture --goal "Persist refactor acceptance" --source opencode --cwd "$PWD"
```

### CI or post-task summary

```bash
node scripts/goal-notes.js capture --goal "Release verified on staging" --source ci --quiet --cwd "$GITHUB_WORKSPACE"
```

## Manual note shape

When manually adding a goal note, keep this compact structure:

```markdown
## 2026-05-03T12:34:56.000Z — goal
- Objective: implement X
- Source: shell
- Store: universal
- Project: `/path/to/project`
- Cwd: `/path/to/project`
- Branch: `feature/x`
- Future-session reminders:
  - Preserve user intent and acceptance criteria before implementation.
  - Record verification evidence and unresolved risks before completion.
```
