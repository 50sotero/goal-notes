# Universal Project Goal Notes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `goal-notes` a universal, project-level goal-memory tool for any AI assistant or automation flow while preserving the current Codex/OMX hook behavior.

**Architecture:** Split the current Codex-specific hook into a zero-dependency assistant-neutral core plus thin runtime adapters. Generic users get project-level `.goal-notes/` storage by default; the existing Codex hook wrapper keeps legacy project-level `.omx/` storage by default. Every invocation writes to exactly one deterministic store and keeps note payloads private/redacted by default.

**Tech Stack:** Node.js built-in modules only, Node built-in test runner (`node --test`), Git CLI for project-root and ignore verification, existing Codex skill metadata files.

---

## Context

Current repository: `/mnt/c/users/victo/documents/code/goal-notes`

Current files:
- `SKILL.md` — currently frames the skill around Codex sessions and Codex hook usage.
- `agents/openai.yaml` — currently OpenAI/Codex-facing metadata.
- `scripts/goal-notes-hook.js` — monolithic Codex native `UserPromptSubmit` hook helper.
- `.gitignore` — currently ignores `.omx/` but not `.goal-notes/`.

Current behavior to preserve:
- `/goal` prompts are captured from Codex-ish hook JSON.
- Hook mode is best-effort and stdout-silent.
- Hook mode writes project-level `.omx/goal-notes.md` and `.omx/goal-notes.jsonl` by default.
- Global legacy fallback is `~/.codex/goal-notes/`.
- Redaction covers common tokens/secrets, CPF, CNPJ, and long numeric strings.

## Principles

1. **Project-level by default:** goal memory should live with the project context unless the caller explicitly requests or requires global storage.
2. **Assistant-neutral core:** the core should know about goals, prompts, stores, privacy, and serialization — not Codex as the primary identity.
3. **Adapters stay thin:** Codex/OMX, shell, CI, Claude, Gemini, OpenCode, and future runtimes should be usage/adaptation layers over the same core.
4. **No surprise migration:** never mirror, migrate, or split writes unless explicitly requested.
5. **Private by default:** redaction, `0o600` file writes where supported, and `.goal-notes/.gitignore` sentinel must protect payloads in arbitrary Git projects.
6. **Zero dependencies:** keep install friction low by using only Node built-ins.
7. **Import-safe:** testable modules must not write files merely by being imported.

## Storage Contract

| Entry point | Store precedence | Default store | Project path | Global fallback | `auto` behavior |
|---|---|---|---|---|---|
| `scripts/goal-notes.js capture` | `--store` > `GOAL_NOTES_STORE` > default | `universal` | `.goal-notes/goal-notes.{md,jsonl}` | `$GOAL_NOTES_HOME` else `~/.goal-notes` | Use existing `.omx/goal-notes.md` or `.omx/goal-notes.jsonl` only if one exists; otherwise universal. |
| `scripts/goal-notes.js hook --format codex-native` | `--store` > `GOAL_NOTES_STORE` > default | `omx` | `.omx/goal-notes.{md,jsonl}` | `~/.codex/goal-notes` | Same as above. |
| `scripts/goal-notes-hook.js` compatibility wrapper | wrapper args if implemented > `GOAL_NOTES_STORE` > default | `omx` | `.omx/goal-notes.{md,jsonl}` | `~/.codex/goal-notes` | Same as hook mode; must remain legacy-default. |

Additional rules:
- Existing `.omx/` directory alone does **not** trigger `auto`; actual `.omx/goal-notes.md` or `.omx/goal-notes.jsonl` must exist.
- `GOAL_NOTES_HOME` applies only to universal global fallback.
- Invalid `--store` or `GOAL_NOTES_STORE`:
  - human CLI exits nonzero and prints an error to stderr;
  - hook/wrapper warns to stderr, exits `0`, and does not write.
- No default mirroring and no silent migration.

## File Structure

Create/modify these files:

- Modify: `SKILL.md`
  - Reframe the tool as universal goal memory.
  - Document project-level storage, privacy, CLI usage, and runtime adapters.
- Modify: `agents/openai.yaml`
  - Assistant-neutral wording, still useful inside Codex/OpenAI skill lists.
- Modify: `.gitignore`
  - Add `.goal-notes/` while preserving `.omx/`.
- Create: `scripts/goal-notes.js`
  - Universal CLI and core implementation.
  - Export pure/import-safe functions for tests.
- Modify: `scripts/goal-notes-hook.js`
  - Convert to a compatibility wrapper/delegator to `scripts/goal-notes.js hook --format codex-native --store omx`.
  - Preserve stdout silence and best-effort behavior.
- Create: `tests/goal-notes.test.js`
  - Node built-in tests with isolated temp directories and temp HOME.

Do **not** add package dependencies, npm package scaffolding, fuzzy goal detection, or automatic migration.

---

## Chunk 1: Lock the Storage and Privacy Behavior with Tests

### Task 1: Add the test scaffold and first failing generic capture test

**Files:**
- Create: `tests/goal-notes.test.js`
- Reference: `scripts/goal-notes-hook.js`

- [ ] **Step 1: Create test helpers**

Create `tests/goal-notes.test.js` with Node built-ins only:

```js
'use strict';

const assert = require('node:assert/strict');
const { describe, it, beforeEach, afterEach } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'scripts', 'goal-notes.js');
const hookPath = path.join(repoRoot, 'scripts', 'goal-notes-hook.js');

function mkTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-notes-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['branch', '-M', 'main'], { cwd: dir });
  return dir;
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd,
    env: { ...process.env, HOME: options.home || options.cwd || os.tmpdir(), ...options.env },
    input: options.input,
    encoding: 'utf8',
  });
}
```

- [ ] **Step 2: Write the failing generic project-level capture test**

Add:

```js
it('capture writes universal project-level goal notes by default', () => {
  const cwd = mkTempProject();
  const result = runNode([
    cliPath,
    'capture',
    '--goal',
    'make this work outside Codex',
    '--prompt',
    '/goal make this work outside Codex',
    '--source',
    'shell',
    '--cwd',
    cwd,
  ], { cwd });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /goal note captured/i);
  assert.equal(fs.existsSync(path.join(cwd, '.goal-notes', 'goal-notes.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.goal-notes', 'goal-notes.jsonl')), true);
  assert.match(fs.readFileSync(path.join(cwd, '.goal-notes', 'goal-notes.md'), 'utf8'), /make this work outside Codex/);
});
```

- [ ] **Step 3: Run test to verify RED**

Run:

```bash
node --test tests/goal-notes.test.js
```

Expected: FAIL because `scripts/goal-notes.js` does not exist yet.

### Task 2: Add privacy sentinel and ignored-payload tests

**Files:**
- Modify: `tests/goal-notes.test.js`

- [ ] **Step 1: Add a failing test for `.goal-notes/.gitignore` and ignored payloads**

Add:

```js
it('universal project storage keeps note payloads ignored in git projects', () => {
  const cwd = mkTempProject();
  const result = runNode([cliPath, 'capture', '--goal', 'private local memory', '--cwd', cwd], { cwd });

  assert.equal(result.status, 0, result.stderr);
  const sentinel = path.join(cwd, '.goal-notes', '.gitignore');
  assert.equal(fs.existsSync(sentinel), true);

  execFileSync('git', ['check-ignore', '.goal-notes/goal-notes.md'], { cwd });
  execFileSync('git', ['check-ignore', '.goal-notes/goal-notes.jsonl'], { cwd });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
node --test tests/goal-notes.test.js
```

Expected: FAIL until the CLI creates the sentinel and note payloads.

### Task 3: Add Codex compatibility wrapper tests

**Files:**
- Modify: `tests/goal-notes.test.js`

- [ ] **Step 1: Add a failing test for the existing wrapper defaulting to `.omx`**

Add:

```js
it('compatibility hook remains stdout-silent and writes legacy omx project notes', () => {
  const cwd = mkTempProject();
  const payload = JSON.stringify({
    hook_event_name: 'UserPromptSubmit',
    cwd,
    session_id: 'test-session',
    prompt: '/goal preserve Codex compatibility',
  });

  const result = runNode([hookPath], { cwd, input: payload });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(fs.existsSync(path.join(cwd, '.omx', 'goal-notes.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.omx', 'goal-notes.jsonl')), true);
  assert.match(fs.readFileSync(path.join(cwd, '.omx', 'goal-notes.md'), 'utf8'), /preserve Codex compatibility/);
});
```

- [ ] **Step 2: Add a failing test for non-goal prompts**

Add:

```js
it('compatibility hook ignores non-goal prompts', () => {
  const cwd = mkTempProject();
  const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd, prompt: 'hello there' });
  const result = runNode([hookPath], { cwd, input: payload });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(fs.existsSync(path.join(cwd, '.omx', 'goal-notes.md')), false);
});
```

- [ ] **Step 3: Run tests to verify RED/PRESERVE expectations**

Run:

```bash
node --test tests/goal-notes.test.js
```

Expected: Some tests may currently pass through the old wrapper; new CLI-dependent tests still fail.

---

## Chunk 2: Build the Assistant-Neutral Core and CLI

### Task 4: Create `scripts/goal-notes.js` with import-safe core functions

**Files:**
- Create: `scripts/goal-notes.js`
- Modify: `tests/goal-notes.test.js`

- [ ] **Step 1: Create the script skeleton**

Create `scripts/goal-notes.js`:

```js
#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const VALID_STORES = new Set(['universal', 'omx', 'auto']);

function safeString(value) {
  return typeof value === 'string' ? value : '';
}

function isMain() {
  return process.argv[1] && importSafeFileUrl(process.argv[1]) === importSafeFileUrl(__filename);
}

function importSafeFileUrl(file) {
  return pathToFileURL(path.resolve(file)).href;
}

module.exports = {
  safeString,
  // Add exported functions as they are implemented.
};

if (isMain()) {
  runCli(process.argv.slice(2), {
    stdin: fs.readFileSync(0, 'utf8'),
    env: process.env,
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
```

- [ ] **Step 2: Run syntax check**

Run:

```bash
node -c scripts/goal-notes.js
```

Expected: PASS once the skeleton is syntactically valid.

### Task 5: Implement argument parsing and invalid store handling

**Files:**
- Modify: `scripts/goal-notes.js`
- Modify: `tests/goal-notes.test.js`

- [ ] **Step 1: Add tests for invalid store behavior**

Add:

```js
it('human CLI fails closed for invalid stores', () => {
  const cwd = mkTempProject();
  const result = runNode([cliPath, 'capture', '--goal', 'bad store', '--store', 'nonsense', '--cwd', cwd], { cwd });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid store/i);
  assert.equal(fs.existsSync(path.join(cwd, '.goal-notes')), false);
});

it('hook mode warns and exits zero for invalid stores without writing', () => {
  const cwd = mkTempProject();
  const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd, prompt: '/goal invalid hook store' });
  const result = runNode([cliPath, 'hook', '--format', 'codex-native', '--store', 'nonsense'], { cwd, input: payload });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /invalid store/i);
  assert.equal(fs.existsSync(path.join(cwd, '.omx')), false);
  assert.equal(fs.existsSync(path.join(cwd, '.goal-notes')), false);
});
```

- [ ] **Step 2: Implement minimal parser**

Implement a small parser that supports:
- command: `capture` or `hook`
- flags: `--goal`, `--prompt`, `--source`, `--cwd`, `--quiet`, `--store`, `--format`
- store resolution: `--store` > `GOAL_NOTES_STORE` > command default

- [ ] **Step 3: Run invalid-store tests**

Run:

```bash
node --test tests/goal-notes.test.js --test-name-pattern "invalid store|invalid stores"
```

Expected: PASS.

### Task 6: Implement redaction and goal normalization

**Files:**
- Modify: `scripts/goal-notes.js`
- Modify: `tests/goal-notes.test.js`

- [ ] **Step 1: Add redaction test**

Add:

```js
it('redacts secrets and Brazilian document identifiers', () => {
  const cwd = mkTempProject();
  const goal = 'token=sk-abcdefghijklmnopqrstuvwxyz123456 CPF 123.456.789-10 CNPJ 12.345.678/0001-90 number 12345678901234567890123456789012345678901234';
  const result = runNode([cliPath, 'capture', '--goal', goal, '--cwd', cwd], { cwd });

  assert.equal(result.status, 0, result.stderr);
  const content = fs.readFileSync(path.join(cwd, '.goal-notes', 'goal-notes.md'), 'utf8');
  assert.doesNotMatch(content, /sk-abcdefghijklmnopqrstuvwxyz123456/);
  assert.doesNotMatch(content, /123\.456\.789-10/);
  assert.doesNotMatch(content, /12\.345\.678\/0001-90/);
  assert.doesNotMatch(content, /12345678901234567890123456789012345678901234/);
  assert.match(content, /\[redacted/);
});
```

- [ ] **Step 2: Move existing redaction into reusable functions**

Implement:
- `redact(text)`
- `truncate(text, max)`
- `extractGoalFromPrompt(prompt)` for hook mode
- `normalizeCapture({ goal, prompt, source, cwd, sessionId })`

Preserve existing redaction rules.

- [ ] **Step 3: Run redaction tests**

Run:

```bash
node --test tests/goal-notes.test.js --test-name-pattern "redacts"
```

Expected: PASS.

### Task 7: Implement project root and storage resolution

**Files:**
- Modify: `scripts/goal-notes.js`
- Modify: `tests/goal-notes.test.js`

- [ ] **Step 1: Add tests for project marker resolution and global fallback**

Add tests that prove:
- a nested cwd under a Git repo writes to the Git root `.goal-notes/`;
- when no project root can be found and `GOAL_NOTES_HOME` is set, universal fallback writes there.

Example:

```js
it('capture writes at the nearest git project root from nested cwd', () => {
  const root = mkTempProject();
  const nested = path.join(root, 'packages', 'app');
  fs.mkdirSync(nested, { recursive: true });

  const result = runNode([cliPath, 'capture', '--goal', 'nested project goal', '--cwd', nested], { cwd: nested });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(root, '.goal-notes', 'goal-notes.md')), true);
  assert.equal(fs.existsSync(path.join(nested, '.goal-notes', 'goal-notes.md')), false);
});
```

- [ ] **Step 2: Implement root resolution**

Implement `resolveProjectRoot(cwd)`:
1. use explicit `--cwd` if supplied as starting point;
2. nearest Git root via `git rev-parse --show-toplevel`;
3. nearest marker directory containing one of: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `AGENTS.md`, `.project`;
4. fallback to starting cwd;
5. global fallback only when cwd is invalid/unavailable or caller chooses future global mode.

- [ ] **Step 3: Implement store path resolution**

Implement:
- `resolveStore({ store, command, cwd, env })`
- universal project path: `<projectRoot>/.goal-notes/`
- omx project path: `<projectRoot>/.omx/`
- universal global fallback: `$GOAL_NOTES_HOME` else `~/.goal-notes`
- omx global fallback: `~/.codex/goal-notes`

- [ ] **Step 4: Run storage tests**

Run:

```bash
node --test tests/goal-notes.test.js --test-name-pattern "project root|GOAL_NOTES_HOME|nearest git"
```

Expected: PASS.

### Task 8: Implement serialization, append, and privacy sentinel

**Files:**
- Modify: `scripts/goal-notes.js`

- [ ] **Step 1: Implement note serialization**

Generate Markdown entries shaped like:

```markdown
## 2026-05-03T00:00:00.000Z — goal
- Objective: <redacted/truncated objective>
- Source: <source>
- Store: <universal|omx>
- Project: `<project root>`
- Cwd: `<cwd>`
- Branch: `<branch>`
- Session: `<session id>`
- Future-session reminders:
  - Preserve user intent and acceptance criteria before implementation.
  - Record verification evidence and unresolved risks before completion.
```

Generate JSONL with at least:

```js
{
  timestamp,
  event: 'goal',
  objective,
  promptExcerpt,
  source,
  cwd,
  projectRoot,
  store,
  branch,
  sessionId,
  reminders,
}
```

- [ ] **Step 2: Implement private append**

Implement append behavior:
- create store directory recursively;
- for universal project storage, create `.goal-notes/.gitignore` with:

```gitignore
# Goal Notes stores private local assistant memory here.
*
!.gitignore
```

- append Markdown and JSONL with mode `0o600` where Node supports it;
- do not print from core functions.

- [ ] **Step 3: Run generic capture and privacy tests**

Run:

```bash
node --test tests/goal-notes.test.js --test-name-pattern "capture writes|keeps note payloads ignored"
```

Expected: PASS.

---

## Chunk 3: Preserve Codex/OMX Hook Compatibility

### Task 9: Implement codex-native hook mode in the universal CLI

**Files:**
- Modify: `scripts/goal-notes.js`
- Modify: `tests/goal-notes.test.js`

- [ ] **Step 1: Add malformed JSON and stdout silence tests**

Add:

```js
it('hook mode handles malformed JSON without failing or stdout', () => {
  const cwd = mkTempProject();
  const result = runNode([cliPath, 'hook', '--format', 'codex-native'], { cwd, input: '{bad json' });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /could not parse|malformed/i);
});
```

- [ ] **Step 2: Implement hook parsing**

Implement `runHookCodexNative({ stdin, env, cwd, stdout, stderr })`:
- parse stdin JSON best-effort;
- accept hook event fields: `hook_event_name`, `hookEventName`, `event`, `name`;
- only capture `UserPromptSubmit`, or capture if no event is present but prompt starts with `/goal`;
- read prompt fields: `prompt`, `user_prompt`, `userPrompt`, `input`, `text`;
- extract `/goal` from line starts or inline `/goal ...`;
- ignore non-goal prompts;
- use default store `omx`;
- never write stdout;
- exit status `0` for malformed JSON and invalid store in hook mode.

- [ ] **Step 3: Run hook-mode tests**

Run:

```bash
node --test tests/goal-notes.test.js --test-name-pattern "hook mode|Codex|compatibility"
```

Expected: PASS.

### Task 10: Convert `scripts/goal-notes-hook.js` into a compatibility delegator

**Files:**
- Modify: `scripts/goal-notes-hook.js`

- [ ] **Step 1: Replace monolith with delegator**

Make `scripts/goal-notes-hook.js`:
- read stdin once;
- spawn or call `scripts/goal-notes.js hook --format codex-native --store omx` with the same stdin;
- pass env through;
- preserve stdout silence even if child behavior changes unexpectedly;
- write warnings only to stderr;
- exit `0` on failures to preserve hook best-effort behavior.

Possible approach:

```js
#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

try {
  const input = fs.readFileSync(0, 'utf8');
  const cli = path.join(__dirname, 'goal-notes.js');
  const result = spawnSync(process.execPath, [cli, 'hook', '--format', 'codex-native', '--store', 'omx', '--quiet'], {
    input,
    encoding: 'utf8',
    env: process.env,
    cwd: process.cwd(),
  });
  if (result.stderr) process.stderr.write(result.stderr);
} catch (error) {
  process.stderr.write(`[goal-notes] ${error && error.message ? error.message : String(error)}\n`);
}
```

- [ ] **Step 2: Run wrapper tests**

Run:

```bash
node --test tests/goal-notes.test.js --test-name-pattern "compatibility hook|non-goal"
```

Expected: PASS.

- [ ] **Step 3: Syntax check scripts**

Run:

```bash
node -c scripts/goal-notes.js
node -c scripts/goal-notes-hook.js
```

Expected: PASS.

---

## Chunk 4: Complete Environment and Store Mode Coverage

### Task 11: Test and implement `GOAL_NOTES_STORE` and `auto`

**Files:**
- Modify: `scripts/goal-notes.js`
- Modify: `tests/goal-notes.test.js`

- [ ] **Step 1: Add `GOAL_NOTES_STORE=omx` test for capture**

Add:

```js
it('GOAL_NOTES_STORE can route generic capture to omx storage', () => {
  const cwd = mkTempProject();
  const result = runNode([cliPath, 'capture', '--goal', 'env store'], {
    cwd,
    env: { GOAL_NOTES_STORE: 'omx' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(cwd, '.omx', 'goal-notes.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.goal-notes', 'goal-notes.md')), false);
});
```

- [ ] **Step 2: Add `auto` existing-file behavior test**

Add:

```js
it('auto store uses existing legacy goal-note files but ignores bare .omx directories', () => {
  const cwd = mkTempProject();
  fs.mkdirSync(path.join(cwd, '.omx'), { recursive: true });

  let result = runNode([cliPath, 'capture', '--goal', 'bare omx does not count', '--store', 'auto', '--cwd', cwd], { cwd });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(cwd, '.goal-notes', 'goal-notes.md')), true);

  const cwd2 = mkTempProject();
  fs.mkdirSync(path.join(cwd2, '.omx'), { recursive: true });
  fs.writeFileSync(path.join(cwd2, '.omx', 'goal-notes.md'), 'legacy\n');

  result = runNode([cliPath, 'capture', '--goal', 'legacy file counts', '--store', 'auto', '--cwd', cwd2], { cwd: cwd2 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(path.join(cwd2, '.omx', 'goal-notes.md'), 'utf8'), /legacy file counts/);
  assert.equal(fs.existsSync(path.join(cwd2, '.goal-notes', 'goal-notes.md')), false);
});
```

- [ ] **Step 3: Run env/auto tests**

Run:

```bash
node --test tests/goal-notes.test.js --test-name-pattern "GOAL_NOTES_STORE|auto store"
```

Expected: PASS.

### Task 12: Test and implement `GOAL_NOTES_HOME`

**Files:**
- Modify: `scripts/goal-notes.js`
- Modify: `tests/goal-notes.test.js`

- [ ] **Step 1: Add global fallback test**

Because project-level storage should be the default, only use global fallback when cwd is invalid/unavailable or when implementation exposes an explicit global mode later. For this pass, test invalid cwd fallback:

```js
it('GOAL_NOTES_HOME controls universal global fallback when cwd is unavailable', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-notes-home-'));
  const missing = path.join(home, 'missing-cwd');
  const result = runNode([cliPath, 'capture', '--goal', 'global fallback', '--cwd', missing], {
    cwd: home,
    home,
    env: { GOAL_NOTES_HOME: path.join(home, 'custom-goals') },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(home, 'custom-goals', 'goal-notes.md')), true);
});
```

- [ ] **Step 2: Implement invalid cwd fallback**

If `--cwd` is invalid/unavailable:
- universal store falls back to `$GOAL_NOTES_HOME` else `~/.goal-notes`;
- omx store falls back to `~/.codex/goal-notes`.

- [ ] **Step 3: Run home fallback test**

Run:

```bash
node --test tests/goal-notes.test.js --test-name-pattern "GOAL_NOTES_HOME"
```

Expected: PASS.

---

## Chunk 5: Rewrite User-Facing Skill Docs and Metadata

### Task 13: Rewrite `SKILL.md` around universal goal memory

**Files:**
- Modify: `SKILL.md`

- [ ] **Step 1: Replace Codex-only description**

Update frontmatter description to avoid Codex-only framing, for example:

```yaml
description: Capture persistent project-level goal notes, acceptance reminders, and improvement points for any AI assistant, CLI, or automation workflow without storing secrets.
```

- [ ] **Step 2: Document universal usage first**

Include examples:

```bash
node scripts/goal-notes.js capture --goal "Ship address matching" --source shell
node scripts/goal-notes.js capture --goal "Review OCR gaps" --prompt "$PROMPT" --source claude
node scripts/goal-notes.js capture --goal "CI release verification" --source ci --quiet
```

- [ ] **Step 3: Document project-level storage**

State:
- default universal project storage is `.goal-notes/` at project root;
- Codex/OMX adapter default is `.omx/` for backward compatibility;
- global fallback is only for missing project context or explicit future global use;
- no mirroring/migration occurs automatically.

- [ ] **Step 4: Document privacy limits**

State:
- `.goal-notes/.gitignore` is created to ignore payloads;
- note files are local/private by default;
- redaction is best-effort, not a security boundary;
- users should avoid putting secrets, credentials, QR contents, invoices, or unnecessary personal data in goals.

- [ ] **Step 5: Document adapters**

Include sections for:
- generic shell/manual capture;
- Codex native hook;
- Claude/Claude Code manual command;
- Gemini/OpenCode manual command;
- CI/post-task summary.

- [ ] **Step 6: Document compatibility wrapper**

State that `scripts/goal-notes-hook.js` remains the stable Codex hook entrypoint.

### Task 14: Update OpenAI/Codex skill metadata

**Files:**
- Modify: `agents/openai.yaml`

- [ ] **Step 1: Make metadata universal-friendly**

Update values similar to:

```yaml
display_name: Goal Notes
short_description: Persist project-level goal context for future assistant sessions.
default_prompt: Capture this goal as local project memory with acceptance reminders, improvement points, and privacy-safe redaction.
```

- [ ] **Step 2: Validate YAML syntax manually**

Run:

```bash
python3 - <<'PY'
import yaml
from pathlib import Path
print(yaml.safe_load(Path('agents/openai.yaml').read_text()))
PY
```

Expected: prints parsed metadata object.

### Task 15: Update repository ignore rules

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add `.goal-notes/`**

Ensure `.gitignore` contains:

```gitignore
.omx/
.goal-notes/
.DS_Store
```

- [ ] **Step 2: Confirm repo status ignores generated plan stores**

Run from repo root after any manual sample capture:

```bash
git status --short --ignored | grep -E 'goal-notes|\.omx' || true
```

Expected: generated note stores are ignored, source files are not accidentally ignored.

---

## Chunk 6: Full Verification and Rollout

### Task 16: Run repo-safe verification

**Files:**
- All changed files

- [ ] **Step 1: Run full Node tests**

Run:

```bash
node --test
```

Expected: PASS for all tests.

- [ ] **Step 2: Run syntax checks**

Run:

```bash
node -c scripts/goal-notes.js
node -c scripts/goal-notes-hook.js
```

Expected: PASS.

- [ ] **Step 3: Run generic CLI sample in temp dir**

Run:

```bash
tmp=$(mktemp -d)
git -C "$tmp" init -q
git -C "$tmp" branch -M main
node scripts/goal-notes.js capture --goal "universal project-level smoke test" --cwd "$tmp" --source shell
test -f "$tmp/.goal-notes/goal-notes.md"
git -C "$tmp" check-ignore .goal-notes/goal-notes.md
rm -rf "$tmp"
```

Expected: command prints success, note exists, Git ignores payload.

- [ ] **Step 4: Run Codex hook sample in temp dir**

Run:

```bash
tmp=$(mktemp -d)
git -C "$tmp" init -q
git -C "$tmp" branch -M main
printf '%s' "{\"hook_event_name\":\"UserPromptSubmit\",\"cwd\":\"$tmp\",\"prompt\":\"/goal codex wrapper smoke test\"}" | node scripts/goal-notes-hook.js >"$tmp/stdout" 2>"$tmp/stderr"
test ! -s "$tmp/stdout"
test -f "$tmp/.omx/goal-notes.md"
rm -rf "$tmp"
```

Expected: stdout empty, legacy `.omx` note exists.

- [ ] **Step 5: Run skill validation if installed validator exists**

Run:

```bash
if [ -f /home/victo/.codex/skills/.system/skill-creator/scripts/quick_validate.py ]; then
  python3 /home/victo/.codex/skills/.system/skill-creator/scripts/quick_validate.py .
else
  echo "quick_validate.py not installed; skipped"
fi
```

Expected: `Skill is valid!` or explicit skip.

### Task 17: Roll out to local Codex skill install

**Files:**
- Local install target: `/home/victo/.codex/skills/goal-notes`
- Hook config: `/home/victo/.codex/hooks.json`

- [ ] **Step 1: Copy updated skill files to local install**

Run:

```bash
rm -rf /home/victo/.codex/skills/goal-notes
mkdir -p /home/victo/.codex/skills/goal-notes
cp -a SKILL.md scripts agents /home/victo/.codex/skills/goal-notes/
```

- [ ] **Step 2: Validate installed skill**

Run:

```bash
python3 /home/victo/.codex/skills/.system/skill-creator/scripts/quick_validate.py /home/victo/.codex/skills/goal-notes
```

Expected: `Skill is valid!`

- [ ] **Step 3: Verify hooks config still points to wrapper and parses**

Run:

```bash
python3 -m json.tool /home/victo/.codex/hooks.json >/dev/null
grep -F '/home/victo/.codex/skills/goal-notes/scripts/goal-notes-hook.js' /home/victo/.codex/hooks.json
```

Expected: JSON parse succeeds and grep finds the wrapper path.

- [ ] **Step 4: Run installed wrapper smoke test**

Run:

```bash
tmp=$(mktemp -d)
git -C "$tmp" init -q
git -C "$tmp" branch -M main
printf '%s' "{\"hook_event_name\":\"UserPromptSubmit\",\"cwd\":\"$tmp\",\"prompt\":\"/goal installed wrapper smoke\"}" | node /home/victo/.codex/skills/goal-notes/scripts/goal-notes-hook.js >"$tmp/stdout" 2>"$tmp/stderr"
test ! -s "$tmp/stdout"
test -f "$tmp/.omx/goal-notes.md"
rm -rf "$tmp"
```

Expected: stdout empty and `.omx` note created.

### Task 18: Commit and push

**Files:**
- `.gitignore`
- `SKILL.md`
- `agents/openai.yaml`
- `scripts/goal-notes.js`
- `scripts/goal-notes-hook.js`
- `tests/goal-notes.test.js`
- `docs/superpowers/plans/2026-05-03-universal-project-goal-notes.md`

- [ ] **Step 1: Review diff**

Run:

```bash
git diff -- .
git status --short
```

Expected: only intended files changed.

- [ ] **Step 2: Stage intended files**

Run:

```bash
git add .gitignore SKILL.md agents/openai.yaml scripts/goal-notes.js scripts/goal-notes-hook.js tests/goal-notes.test.js docs/superpowers/plans/2026-05-03-universal-project-goal-notes.md
```

- [ ] **Step 3: Commit with Lore protocol as Victor**

Run:

```bash
git config user.name "Victor Sotero"
git config user.email "victor.sotero@ic.ufal.br"
git commit -m "Make goal notes portable across assistant workflows" \
  -m "Goal notes need to work beyond Codex while preserving the existing Codex/OMX hook contract. This change introduces assistant-neutral capture semantics, deterministic project-level storage, and private-by-default payload handling." \
  -m "Constraint: Existing Codex hook installs must remain stdout-silent and legacy-default to .omx storage." \
  -m "Rejected: Default mirroring between .goal-notes and .omx | duplicates records and obscures source of truth." \
  -m "Rejected: Fuzzy prompt detection | raises false-positive persistence risk." \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Directive: Keep runtime adapters thin and never make hook mode emit stdout." \
  -m "Tested: node --test; node -c scripts; generic CLI temp capture; Codex hook temp capture; skill validation." \
  -m "Not-tested: Published package-manager install path; no package manager distribution exists yet."
```

- [ ] **Step 4: Push**

Run:

```bash
git push origin main
```

Expected: push succeeds to `https://github.com/50sotero/goal-notes`.

---

## Definition of Done

- [ ] `SKILL.md` no longer frames the project as Codex-only.
- [ ] Generic users can run one Node command and write project-level `.goal-notes/` notes.
- [ ] Universal project-level note payloads are ignored in arbitrary Git repos by default.
- [ ] Existing Codex hook wrapper remains stdout-silent and writes project-level `.omx/` notes by default.
- [ ] Store precedence and `auto` behavior are documented and tested.
- [ ] Invalid store behavior is safe and tested.
- [ ] Tests use only temp directories and do not write real user `.omx`, `.codex`, or home stores.
- [ ] Local Codex install is updated after repo-safe tests pass.
- [ ] Lore commit authored by `Victor Sotero <victor.sotero@ic.ufal.br>` is pushed.

## Non-goals

- No npm package distribution in this pass.
- No fuzzy goal detection from arbitrary prose.
- No automatic migration from `.omx` to `.goal-notes`.
- No default mirroring between stores.
- No new runtime dependencies.
