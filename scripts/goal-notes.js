#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const VALID_STORES = new Set(['universal', 'omx', 'auto']);
const PROJECT_MARKERS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'AGENTS.md', '.project'];
const UNIVERSAL_DIR = '.goal-notes';
const OMX_DIR = '.omx';
const MARKDOWN_FILE = 'goal-notes.md';
const JSONL_FILE = 'goal-notes.jsonl';
const UNIVERSAL_SENTINEL = `# Goal Notes stores private local assistant memory here.\n*\n!.gitignore\n`;
const DEFAULT_REMINDERS = [
  'Preserve user intent and acceptance criteria before implementation.',
  'Record verification evidence and unresolved risks before completion.',
];

function safeString(value) {
  return typeof value === 'string' ? value : '';
}

function importSafeFileUrl(file) {
  return pathToFileURL(path.resolve(file)).href;
}

function isMain() {
  return process.argv[1] && importSafeFileUrl(process.argv[1]) === importSafeFileUrl(__filename);
}

function homeDir(env = process.env) {
  return safeString(env.HOME).trim() || os.homedir();
}

function warn(stderr, message) {
  try {
    stderr.write(`[goal-notes] ${message}\n`);
  } catch {
    // Ignore stderr failures; hook usage must stay best-effort.
  }
}

function redact(text) {
  return safeString(text)
    .replace(/\b(authorization\s*:\s*(?:bearer|basic)\s+)(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s,;]+)/gi, '$1[redacted]')
    .replace(/\b(bearer\s+)([A-Za-z0-9._~+/-]{16,}=*)/gi, '$1[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
    .replace(/\bgh[opsu]_[A-Za-z0-9_]{20,}\b/g, '[redacted-token]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[redacted-token]')
    .replace(/((?:api|access|refresh|auth|authorization|bearer|token|secret|password|senha|cookie)[\w .:-]{0,32}[=:]\s*)(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s,;]+)/gi, '$1[redacted]')
    .replace(/\b(cookie\s*:\s*)([^\r\n]+)/gi, '$1[redacted-cookie]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[redacted-cpf]')
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '[redacted-cnpj]')
    .replace(/\b\d{44,}\b/g, '[redacted-long-number]')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text, max) {
  const value = safeString(text);
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function extractGoalFromPrompt(prompt) {
  const value = safeString(prompt);
  const goalLines = [];
  for (const line of value.split(/\r?\n/)) {
    const match = line.match(/^\s*\/goal(?:\s+|$)(.*)$/i);
    if (match) goalLines.push(match[1].trim());
  }
  if (goalLines.length > 0) {
    return goalLines.join(' ').trim() || '(empty /goal invocation)';
  }
  const inline = value.match(/(?:^|\s)\/goal\s+([^\n\r]+)/i);
  return inline ? inline[1].trim() : '';
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const command = args.shift() || '';
  const flags = {};
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const eq = token.indexOf('=');
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
    if (!name) return { command, flags, positionals, error: `invalid option ${token}` };

    if (name === 'quiet') {
      flags.quiet = true;
      continue;
    }

    let value;
    if (eq !== -1) {
      value = token.slice(eq + 1);
    } else {
      value = args[index + 1];
      if (typeof value === 'undefined' || value.startsWith('--')) {
        return { command, flags, positionals, error: `missing value for --${name}` };
      }
      index += 1;
    }
    flags[name] = value;
  }

  return { command, flags, positionals, error: '' };
}

function pathExistsDir(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function resolveStartCwd(cwd, baseCwd = process.cwd()) {
  const value = safeString(cwd).trim() || baseCwd;
  const resolved = path.resolve(baseCwd, value);
  if (!pathExistsDir(resolved)) {
    return { requestedCwd: resolved, effectiveCwd: '', valid: false };
  }
  return { requestedCwd: resolved, effectiveCwd: resolved, valid: true };
}

function gitValue(cwd, args) {
  if (!cwd) return '';
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function nearestMarkerRoot(start) {
  let current = path.resolve(start);
  while (current && current !== path.dirname(current)) {
    if (PROJECT_MARKERS.some((marker) => fs.existsSync(path.join(current, marker)))) {
      return current;
    }
    current = path.dirname(current);
  }
  return '';
}

function resolveProjectRoot(cwd, baseCwd = process.cwd()) {
  const start = resolveStartCwd(cwd, baseCwd);
  if (!start.valid) {
    return {
      valid: false,
      requestedCwd: start.requestedCwd,
      effectiveCwd: '',
      projectRoot: '',
      rootKind: 'global',
    };
  }

  const gitRoot = gitValue(start.effectiveCwd, ['rev-parse', '--show-toplevel']);
  if (gitRoot) {
    return { ...start, projectRoot: gitRoot, rootKind: 'git' };
  }

  const markerRoot = nearestMarkerRoot(start.effectiveCwd);
  if (markerRoot) {
    return { ...start, projectRoot: markerRoot, rootKind: 'marker' };
  }

  return { ...start, projectRoot: start.effectiveCwd, rootKind: 'cwd' };
}

function legacyGoalFilesExist(projectRoot) {
  if (!projectRoot) return false;
  return fs.existsSync(path.join(projectRoot, OMX_DIR, MARKDOWN_FILE)) || fs.existsSync(path.join(projectRoot, OMX_DIR, JSONL_FILE));
}

function resolveSelectedStore({ explicitStore, env, defaultStore }) {
  return safeString(explicitStore).trim() || safeString(env.GOAL_NOTES_STORE).trim() || defaultStore;
}

function resolveStore({ explicitStore, defaultStore, cwd, env = process.env, baseCwd = process.cwd() }) {
  const selectedStore = resolveSelectedStore({ explicitStore, env, defaultStore });
  if (!VALID_STORES.has(selectedStore)) {
    return { error: `invalid store: ${selectedStore || '(empty)'}` };
  }

  const root = resolveProjectRoot(cwd, baseCwd);
  let store = selectedStore;
  if (store === 'auto') {
    store = root.valid && legacyGoalFilesExist(root.projectRoot) ? 'omx' : 'universal';
  }

  let dir;
  let scope;
  let projectRoot = root.projectRoot;
  if (root.valid) {
    scope = root.rootKind;
    dir = path.join(projectRoot, store === 'omx' ? OMX_DIR : UNIVERSAL_DIR);
  } else {
    scope = 'global';
    projectRoot = '';
    dir = store === 'omx'
      ? path.join(homeDir(env), '.codex', 'goal-notes')
      : path.resolve(homeDir(env), safeString(env.GOAL_NOTES_HOME).trim() || '.goal-notes');
  }

  return {
    selectedStore,
    store,
    dir,
    markdown: path.join(dir, MARKDOWN_FILE),
    jsonl: path.join(dir, JSONL_FILE),
    scope,
    projectRoot,
    cwd: root.requestedCwd,
    effectiveCwd: root.effectiveCwd,
    isProject: root.valid,
  };
}

function normalizeCapture({ goal, prompt, source, cwd, sessionId }) {
  const objectiveSource = safeString(goal).trim() || extractGoalFromPrompt(prompt);
  const objective = truncate(redact(objectiveSource || '(empty goal)'), 1200);
  const promptExcerpt = truncate(redact(prompt), 2400);
  return {
    objective,
    promptExcerpt,
    source: safeString(source).trim() || 'cli',
    cwd: safeString(cwd).trim(),
    sessionId: safeString(sessionId).trim(),
  };
}

function escapeBackticks(value) {
  return safeString(value).replace(/`/g, '\\`');
}

function appendPrivate(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, 'a', 0o600);
  try {
    fs.writeFileSync(fd, content, { encoding: 'utf8' });
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // chmod can fail on some mounted filesystems; append already requested mode 0o600.
  }
}

function ensureUniversalPrivacySentinel(storage) {
  if (storage.store !== 'universal' || !storage.isProject) return;
  fs.mkdirSync(storage.dir, { recursive: true, mode: 0o700 });
  const sentinel = path.join(storage.dir, '.gitignore');
  if (!fs.existsSync(sentinel)) {
    fs.writeFileSync(sentinel, UNIVERSAL_SENTINEL, { encoding: 'utf8', mode: 0o600 });
  }
}

function serializeNote(record) {
  const markdown = [
    '',
    `## ${record.timestamp} — goal`,
    `- Objective: ${record.objective}`,
    `- Source: ${record.source}`,
    `- Store: ${record.store}`,
    record.projectRoot ? `- Project: \`${escapeBackticks(record.projectRoot)}\`` : '- Project: global fallback',
    `- Cwd: \`${escapeBackticks(record.cwd)}\``,
    record.branch ? `- Branch: \`${escapeBackticks(record.branch)}\`` : '',
    record.sessionId ? `- Session: \`${escapeBackticks(record.sessionId)}\`` : '',
    '- Future-session reminders:',
    ...record.reminders.map((reminder) => `  - ${reminder}`),
    record.promptExcerpt && record.promptExcerpt !== record.objective ? `- Prompt excerpt: ${record.promptExcerpt}` : '',
    '',
  ].filter(Boolean).join('\n');

  return {
    markdown: `${markdown}\n`,
    jsonl: `${JSON.stringify(record)}\n`,
  };
}

function captureGoal({ goal, prompt, source, cwd, sessionId, store, env = process.env, baseCwd = process.cwd(), now = new Date() }) {
  const storage = resolveStore({ explicitStore: store, defaultStore: 'universal', cwd, env, baseCwd });
  if (storage.error) return { ok: false, error: storage.error };

  const normalized = normalizeCapture({ goal, prompt, source, cwd: storage.cwd, sessionId });
  const branchCwd = storage.effectiveCwd || storage.projectRoot;
  const branch = gitValue(branchCwd, ['branch', '--show-current']) || gitValue(branchCwd, ['rev-parse', '--short', 'HEAD']);
  const record = {
    timestamp: now.toISOString(),
    event: 'goal',
    objective: normalized.objective,
    promptExcerpt: normalized.promptExcerpt,
    source: normalized.source,
    cwd: normalized.cwd,
    projectRoot: storage.projectRoot,
    store: storage.store,
    branch: branch || null,
    sessionId: normalized.sessionId || null,
    reminders: DEFAULT_REMINDERS,
  };
  const serialized = serializeNote(record);

  ensureUniversalPrivacySentinel(storage);
  appendPrivate(storage.markdown, serialized.markdown);
  appendPrivate(storage.jsonl, serialized.jsonl);

  return { ok: true, storage, record };
}

function parseHookPayload(raw, stderr) {
  const trimmed = safeString(raw).trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    warn(stderr, `could not parse hook JSON: ${error.message}`);
    return {};
  }
}

function hookEventName(payload) {
  return safeString(payload.hook_event_name || payload.hookEventName || payload.event || payload.name).trim();
}

function hookPromptText(payload, raw) {
  const candidates = [payload.prompt, payload.user_prompt, payload.userPrompt, payload.input, payload.text];
  for (const candidate of candidates) {
    const value = safeString(candidate);
    if (value.trim()) return value;
  }
  return safeString(raw);
}

function hookCwd(payload, fallbackCwd) {
  return safeString(payload.cwd || payload.workingDirectory || payload.workspace).trim() || fallbackCwd;
}

function hookSessionId(payload) {
  return safeString(payload.session_id || payload.sessionId || payload.conversation_id || payload.thread_id).trim();
}

function runHookCodexNative({ stdin, env, cwd, stdout, stderr, flags = {} }) {
  void stdout;
  const selectedStore = resolveSelectedStore({ explicitStore: flags.store, env, defaultStore: 'omx' });
  if (!VALID_STORES.has(selectedStore)) {
    warn(stderr, `invalid store: ${selectedStore || '(empty)'}`);
    return 0;
  }

  const payload = parseHookPayload(stdin, stderr);
  const event = hookEventName(payload);
  const prompt = hookPromptText(payload, stdin);
  if (event && event !== 'UserPromptSubmit') return 0;
  if (!event && !/^\s*\/goal(?:\s+|$)/i.test(prompt)) return 0;

  const goal = extractGoalFromPrompt(prompt);
  if (!goal) return 0;

  const result = captureGoal({
    goal,
    prompt,
    source: 'codex-native',
    cwd: hookCwd(payload, cwd),
    sessionId: hookSessionId(payload),
    store: selectedStore,
    env,
    baseCwd: cwd,
  });
  if (!result.ok) warn(stderr, result.error);
  return 0;
}

function runCaptureCommand({ flags, env, cwd, stdout, stderr }) {
  const selectedStore = resolveSelectedStore({ explicitStore: flags.store, env, defaultStore: 'universal' });
  if (!VALID_STORES.has(selectedStore)) {
    warn(stderr, `invalid store: ${selectedStore || '(empty)'}`);
    return 1;
  }

  const goal = safeString(flags.goal).trim() || extractGoalFromPrompt(flags.prompt);
  if (!goal) {
    warn(stderr, 'missing goal; pass --goal or a /goal prompt');
    return 1;
  }

  const result = captureGoal({
    goal,
    prompt: safeString(flags.prompt),
    source: flags.source || 'cli',
    cwd: flags.cwd || cwd,
    sessionId: flags.session || flags.sessionId,
    store: selectedStore,
    env,
    baseCwd: cwd,
  });
  if (!result.ok) {
    warn(stderr, result.error);
    return 1;
  }
  if (!flags.quiet) {
    stdout.write(`Goal note captured in ${result.storage.dir}\n`);
  }
  return 0;
}

function runCli(argv, { stdin = '', env = process.env, cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    warn(stderr, parsed.error);
    return 1;
  }

  if (parsed.command === 'capture') {
    return runCaptureCommand({ flags: parsed.flags, env, cwd, stdout, stderr });
  }

  if (parsed.command === 'hook') {
    const format = parsed.flags.format || 'codex-native';
    if (format !== 'codex-native') {
      warn(stderr, `unsupported hook format: ${format}`);
      return 0;
    }
    try {
      return runHookCodexNative({ stdin, env, cwd, stdout, stderr, flags: parsed.flags });
    } catch (error) {
      warn(stderr, error && error.message ? error.message : String(error));
      return 0;
    }
  }

  warn(stderr, 'usage: goal-notes.js <capture|hook> [options]');
  return 1;
}

module.exports = {
  VALID_STORES,
  safeString,
  importSafeFileUrl,
  isMain,
  redact,
  truncate,
  extractGoalFromPrompt,
  parseArgs,
  resolveProjectRoot,
  resolveStore,
  normalizeCapture,
  serializeNote,
  captureGoal,
  runHookCodexNative,
  runCli,
};

if (isMain()) {
  const command = process.argv[2];
  const stdin = command === 'hook' ? fs.readFileSync(0, 'utf8') : '';
  process.exitCode = runCli(process.argv.slice(2), {
    stdin,
    env: process.env,
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
