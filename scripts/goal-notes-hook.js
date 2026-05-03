#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function safeString(value) {
  return typeof value === 'string' ? value : '';
}

function parsePayload(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    warn(`could not parse hook JSON: ${error.message}`);
    return {};
  }
}

function warn(message) {
  try {
    process.stderr.write(`[goal-notes] ${message}\n`);
  } catch {
    // ignore stderr failures
  }
}

function hookEventName(payload) {
  return safeString(payload.hook_event_name || payload.hookEventName || payload.event || payload.name).trim();
}

function promptText(payload, raw) {
  const candidates = [payload.prompt, payload.user_prompt, payload.userPrompt, payload.input, payload.text];
  for (const candidate of candidates) {
    const value = safeString(candidate);
    if (value.trim()) return value;
  }
  return raw;
}

function extractGoal(prompt) {
  const lines = safeString(prompt).split(/\r?\n/);
  const goalLines = [];
  for (const line of lines) {
    const match = line.match(/^\s*\/goal(?:\s+|$)(.*)$/i);
    if (match) goalLines.push(match[1].trim());
  }
  if (goalLines.length > 0) {
    return goalLines.join(' ').trim() || '(empty /goal invocation)';
  }
  const inline = safeString(prompt).match(/(?:^|\s)\/goal\s+([^\n\r]+)/i);
  return inline ? inline[1].trim() : '';
}

function redact(text) {
  return safeString(text)
    .replace(/(gh[opsu]_[A-Za-z0-9_]{20,})/g, '[redacted-token]')
    .replace(/(sk-[A-Za-z0-9_-]{20,})/g, '[redacted-token]')
    .replace(/((?:api|access|refresh|auth|bearer|token|secret|password|senha|cookie)[\w .:-]{0,32}[=:]\s*)([^\s,;]+)/gi, '$1[redacted]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[redacted-cpf]')
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '[redacted-cnpj]')
    .replace(/\b\d{44,}\b/g, '[redacted-long-number]')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text, max) {
  const value = safeString(text);
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function resolveCwd(payload) {
  const candidates = [payload.cwd, payload.workingDirectory, payload.workspace, process.env.PWD, process.cwd()];
  for (const candidate of candidates) {
    const value = safeString(candidate).trim();
    if (value && fs.existsSync(value)) return value;
  }
  return process.cwd();
}

function gitValue(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function resolveRoot(cwd) {
  const gitRoot = gitValue(cwd, ['rev-parse', '--show-toplevel']);
  if (gitRoot) return { root: gitRoot, isGit: true };
  let current = path.resolve(cwd);
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.omx'))) return { root: current, isGit: false };
    current = path.dirname(current);
  }
  return { root: '', isGit: false };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function outputPaths(cwd) {
  const resolved = resolveRoot(cwd);
  if (resolved.root) {
    const dir = path.join(resolved.root, '.omx');
    ensureDir(dir);
    return {
      dir,
      markdown: path.join(dir, 'goal-notes.md'),
      jsonl: path.join(dir, 'goal-notes.jsonl'),
      scope: resolved.isGit ? 'git' : 'project',
      root: resolved.root,
    };
  }
  const dir = path.join(os.homedir(), '.codex', 'goal-notes');
  ensureDir(dir);
  return {
    dir,
    markdown: path.join(dir, 'goal-notes.md'),
    jsonl: path.join(dir, 'goal-notes.jsonl'),
    scope: 'global',
    root: '',
  };
}

function shellQuote(value) {
  return safeString(value).replace(/`/g, '\\`');
}

function appendAtomic(file, content) {
  fs.appendFileSync(file, content, { encoding: 'utf8', mode: 0o600 });
}

function main() {
  const raw = readStdin();
  const payload = parsePayload(raw);
  const event = hookEventName(payload);
  if (event && event !== 'UserPromptSubmit') return;

  const prompt = promptText(payload, raw);
  const goal = extractGoal(prompt);
  if (!goal) return;

  const cwd = resolveCwd(payload);
  const paths = outputPaths(cwd);
  const branch = gitValue(cwd, ['branch', '--show-current']) || gitValue(cwd, ['rev-parse', '--short', 'HEAD']);
  const timestamp = new Date().toISOString();
  const sessionId = safeString(payload.session_id || payload.sessionId || payload.conversation_id || payload.thread_id).trim();
  const cleanGoal = truncate(redact(goal), 1200);
  const cleanPrompt = truncate(redact(prompt), 2400);

  const markdown = [
    '',
    `## ${timestamp} — /goal`,
    `- Objective: ${cleanGoal}`,
    `- Scope: ${paths.scope}${paths.root ? ` root \`${shellQuote(paths.root)}\`` : ''}`,
    `- Cwd: \`${shellQuote(cwd)}\``,
    branch ? `- Branch: \`${shellQuote(branch)}\`` : '',
    sessionId ? `- Session: \`${shellQuote(sessionId)}\`` : '',
    '- Future-session reminders:',
    '  - Preserve user intent and acceptance criteria before implementation.',
    '  - Record verification evidence and unresolved risks before completion.',
    cleanPrompt && cleanPrompt !== cleanGoal ? `- Full prompt excerpt: ${cleanPrompt}` : '',
    '',
  ].filter(Boolean).join('\n');

  const jsonRecord = {
    timestamp,
    event: '/goal',
    objective: cleanGoal,
    promptExcerpt: cleanPrompt,
    cwd,
    root: paths.root,
    scope: paths.scope,
    branch: branch || null,
    sessionId: sessionId || null,
    reminders: [
      'Preserve user intent and acceptance criteria before implementation.',
      'Record verification evidence and unresolved risks before completion.',
    ],
  };

  appendAtomic(paths.markdown, `${markdown}\n`);
  appendAtomic(paths.jsonl, `${JSON.stringify(jsonRecord)}\n`);
}

try {
  main();
} catch (error) {
  warn(error && error.message ? error.message : String(error));
}
