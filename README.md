# Goal Notes — project memory for every AI assistant

<p align="center">
  <strong>Your coding agent forgets why it started. Goal Notes makes the goal live in the repo.</strong>
</p>

<p align="center">
  <a href="#30-second-demo">30-second demo</a> ·
  <a href="#install">Install</a> ·
  <a href="#use-it-from-any-assistant">Adapters</a> ·
  <a href="#privacy-model">Privacy</a> ·
  <a href="#how-it-works">How it works</a>
</p>

---

You tell an AI agent what matters:

```text
/goal ship the Stripe migration without breaking renewal billing
```

Then the session ends, context compacts, another agent takes over, or you switch from Codex to Claude to Gemini to OpenCode.

The goal disappears into chat history.

**Goal Notes** captures the durable part — objective, source, project root, branch, session id, reminders, and verification cues — into local project files that future assistants can read before they touch code.

No database. No cloud. No daemon. No package install. Just Node built-ins and two append-only files.

## Why this exists

AI coding agents are very good at doing work and very bad at remembering the reason the work exists.

Goal Notes fixes the smallest, highest-leverage piece of agent memory:

- **What are we trying to accomplish?**
- **Where does that goal belong?**
- **What should the next assistant preserve, verify, or avoid?**
- **Which local file has the continuity record?**

It is intentionally boring infrastructure: a tiny CLI + compatibility hook that writes local markdown and JSONL ledgers.

## 30-second demo

```bash
git clone https://github.com/50sotero/goal-notes.git
cd goal-notes

node scripts/goal-notes.js capture \
  --goal "Keep project memory across AI assistants" \
  --source shell

cat .goal-notes/goal-notes.md
```

You get a project-local note like:

```markdown
## 2026-05-03T12:34:56.000Z — goal
- Objective: Keep project memory across AI assistants
- Source: shell
- Store: universal
- Project: `/your/project`
- Cwd: `/your/project`
- Branch: `main`
- Future-session reminders:
  - Preserve user intent and acceptance criteria before implementation.
  - Record verification evidence and unresolved risks before completion.
```

In a Git repo, Goal Notes also creates:

```text
.goal-notes/.gitignore
```

so private note payloads stay local by default.

## The promise

Goal Notes gives every assistant the same tiny superpower:

> **Before you continue the work, recover the goal.**

That means:

- Codex hook sessions can keep legacy `.omx/` behavior.
- Generic shell usage writes `.goal-notes/` by default.
- Claude, Gemini, OpenCode, CI, and custom automations can all call the same CLI.
- Every invocation writes to exactly one deterministic store.
- Sensitive-looking values are redacted before persistence.

## Install

### For humans

If you just want to try Goal Notes in a project, clone the repo and run the universal CLI:

```bash
git clone https://github.com/50sotero/goal-notes.git
cd goal-notes
node scripts/goal-notes.js capture --goal "Document release gates" --source shell
```

To use it from another project without installing hooks, call the script with that project as `--cwd`:

```bash
node /path/to/goal-notes/scripts/goal-notes.js capture \
  --goal "Keep release acceptance criteria visible" \
  --source shell \
  --cwd /path/to/your/project
```

This writes private project memory to `/path/to/your/project/.goal-notes/` by default.

### For agents

If you are an AI coding agent installing Goal Notes for future sessions, copy the skill into the local Codex skills directory:

```bash
mkdir -p ~/.codex/skills/goal-notes
cp -a SKILL.md scripts agents ~/.codex/skills/goal-notes/
```

Then wire the stable hook entrypoint in the Codex hooks config:

```json
{
  "type": "command",
  "command": "node \"/home/victo/.codex/skills/goal-notes/scripts/goal-notes-hook.js\""
}
```

Agent install checklist:

```bash
python3 -m json.tool ~/.codex/hooks.json >/dev/null
node ~/.codex/skills/goal-notes/scripts/goal-notes.js capture \
  --goal "agent install smoke" \
  --source shell \
  --quiet \
  --cwd "$PWD"
```

The wrapper is intentionally boring: it reads Codex hook JSON from stdin, delegates to the universal CLI, writes legacy `.omx/goal-notes.{md,jsonl}`, emits no stdout, and exits `0` on hook failures so prompt submission is never blocked.

## Use it from any assistant

### Shell / manual capture

```bash
node scripts/goal-notes.js capture \
  --goal "Ship address matching with OCR fallback" \
  --source shell
```

### From a prompt excerpt

```bash
node scripts/goal-notes.js capture \
  --prompt "/goal review billing edge cases before touching renewals" \
  --source claude
```

### Claude / Claude Code

```bash
node scripts/goal-notes.js capture \
  --goal "Preserve the approved design before implementation" \
  --source claude \
  --cwd "$PWD"
```

### Gemini / OpenCode

```bash
node scripts/goal-notes.js capture --goal "Track Android QA blockers" --source gemini --cwd "$PWD"
node scripts/goal-notes.js capture --goal "Persist refactor acceptance criteria" --source opencode --cwd "$PWD"
```

### CI / release automation

```bash
node scripts/goal-notes.js capture \
  --goal "Release candidate verified on staging" \
  --source ci \
  --quiet \
  --cwd "$GITHUB_WORKSPACE"
```

### Codex native hook smoke test

```bash
printf '{"hook_event_name":"UserPromptSubmit","cwd":"%s","prompt":"/goal preserve Codex compatibility"}' "$PWD" \
  | node scripts/goal-notes-hook.js
```

Expected behavior:

- stdout stays empty;
- `.omx/goal-notes.md` is created for legacy Codex/OMX compatibility;
- non-`/goal` prompts are ignored.

## Storage model

| Entry point | Default store | Project files | Global fallback |
|---|---:|---|---|
| `scripts/goal-notes.js capture` | `universal` | `.goal-notes/goal-notes.{md,jsonl}` | `$GOAL_NOTES_HOME` or `~/.goal-notes` |
| `scripts/goal-notes.js hook --format codex-native` | `omx` | `.omx/goal-notes.{md,jsonl}` | `~/.codex/goal-notes` |
| `scripts/goal-notes-hook.js` | `omx` | `.omx/goal-notes.{md,jsonl}` | `~/.codex/goal-notes` |

Store precedence:

```text
--store > GOAL_NOTES_STORE > command default
```

Supported stores:

- `universal` — assistant-neutral `.goal-notes/` storage.
- `omx` — Codex/OMX-compatible `.omx/` storage.
- `auto` — use existing `.omx/goal-notes.md` or `.omx/goal-notes.jsonl` if present; otherwise use `universal`.

A bare `.omx/` directory does **not** trigger `auto`. There is no surprise migration, mirroring, or split write.

## Privacy model

Goal Notes is private-by-default, not magic.

What it does:

- creates `.goal-notes/.gitignore` for universal project storage;
- appends note files with `0o600` permissions where supported;
- redacts common secret/token patterns;
- redacts CPF, CNPJ, long numeric identifiers, bearer/JWT-looking tokens, quoted secret values, and cookie headers;
- keeps hook mode best-effort and stdout-silent.

What it does **not** do:

- it does not provide a security boundary;
- it does not encrypt notes;
- it does not decide what is safe to disclose;
- it does not sync anything to a remote service.

Do not put credentials, raw invoices, QR contents, production secrets, or unnecessary personal data in goals.

## How it works

```text
prompt / CLI args
      │
      ▼
extract /goal objective
      │
      ▼
redact + truncate
      │
      ▼
resolve project root
      │
      ▼
choose exactly one store
      │
      ▼
append markdown + JSONL
```

Project root resolution:

1. nearest Git root;
2. nearest project marker: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `AGENTS.md`, `.project`;
3. supplied cwd;
4. global fallback only when cwd is invalid/unavailable.

## What gets recorded

Markdown is for humans and future agents:

```markdown
- Objective: <redacted objective>
- Source: <shell|claude|gemini|opencode|ci|codex-native>
- Store: <universal|omx>
- Project: `<project root>`
- Cwd: `<cwd>`
- Branch: `<branch>`
- Session: `<session id>`
- Future-session reminders:
  - Preserve user intent and acceptance criteria before implementation.
  - Record verification evidence and unresolved risks before completion.
```

JSONL is for tools:

```json
{"event":"goal","objective":"...","source":"shell","store":"universal"}
```

## CLI reference

```bash
node scripts/goal-notes.js capture [options]
node scripts/goal-notes.js hook --format codex-native [options]
```

Options:

| Option | Purpose |
|---|---|
| `--goal <text>` | Objective text to persist. |
| `--prompt <text>` | Original prompt; `/goal ...` is extracted when `--goal` is omitted. |
| `--source <name>` | Runtime label: `shell`, `claude`, `gemini`, `opencode`, `ci`, etc. |
| `--cwd <path>` | Directory used for project-root detection. |
| `--store <mode>` | `universal`, `omx`, or `auto`. |
| `--format codex-native` | Hook parser for Codex native hook JSON. |
| `--quiet` | Suppress human CLI success output. |

Invalid store behavior:

- human CLI: non-zero exit + stderr warning + no write;
- hook mode: stderr warning + exit `0` + no write.

## Test it

```bash
node --test
node -c scripts/goal-notes.js
node -c scripts/goal-notes-hook.js
```

Focused smoke tests:

```bash
# Universal project storage
tmp=$(mktemp -d)
git -C "$tmp" init -q
node scripts/goal-notes.js capture --goal "universal smoke" --cwd "$tmp"
test -f "$tmp/.goal-notes/goal-notes.md"
git -C "$tmp" check-ignore .goal-notes/goal-notes.md
rm -rf "$tmp"

# Codex wrapper compatibility
tmp=$(mktemp -d)
git -C "$tmp" init -q
printf '{"hook_event_name":"UserPromptSubmit","cwd":"%s","prompt":"/goal hook smoke"}' "$tmp" \
  | node scripts/goal-notes-hook.js >"$tmp/stdout"
test ! -s "$tmp/stdout"
test -f "$tmp/.omx/goal-notes.md"
rm -rf "$tmp"
```

## Design principles

- **Project-level by default** — memory belongs with the project context.
- **Assistant-neutral core** — storage and privacy logic do not know or care which assistant called them.
- **Thin adapters** — Codex/OMX, shell, Claude, Gemini, OpenCode, and CI are just entrypoints.
- **No surprise migration** — one invocation, one deterministic store.
- **Private by default** — local files, ignored payloads, best-effort redaction.
- **Zero dependencies** — Node built-ins only.
- **Import-safe** — tests can require the module without writing files.

## Repository map

```text
.
├── SKILL.md                         # Skill instructions for assistant runtimes
├── agents/openai.yaml               # OpenAI/Codex skill metadata
├── scripts/
│   ├── goal-notes.js                # Universal CLI + import-safe core
│   └── goal-notes-hook.js           # Codex/OMX compatibility wrapper
└── tests/goal-notes.test.js         # Node built-in test suite
```

## Roadmap ideas

Goal Notes is deliberately small. Good next steps would keep that constraint:

- `goal-notes list` for local summaries;
- `goal-notes doctor` for ignore/privacy checks;
- adapter snippets for more agent runtimes;
- optional read-only renderer for project dashboards;
- signed release packaging if/when distribution exists.

Not planned by default:

- cloud sync;
- fuzzy goal detection;
- automatic migration between stores;
- storing raw prompt transcripts;
- package dependencies for the core path.

## Contributing

Keep the core boring:

1. No new dependencies unless there is a very strong reason.
2. Preserve stdout silence for hook mode.
3. Add tests before changing storage, parsing, or redaction behavior.
4. Run `node --test` and syntax checks before opening a PR.
5. Keep adapters thin; put shared behavior in `scripts/goal-notes.js`.

## The shortest pitch

If Superpowers gives agents a methodology, Goal Notes gives them continuity.

If OpenClaw-style local agents can do real work on your machine, Goal Notes makes sure the next agent remembers what the work was for.

**Tiny local files. Big reduction in agent amnesia.**
