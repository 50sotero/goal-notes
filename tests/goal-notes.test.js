'use strict';

const assert = require('node:assert/strict');
const { describe, it, afterEach } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'scripts', 'goal-notes.js');
const hookPath = path.join(repoRoot, 'scripts', 'goal-notes-hook.js');
const tempDirs = [];

function mkTempDir(prefix = 'goal-notes-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function mkTempProject() {
  const dir = mkTempDir();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['branch', '-M', 'main'], { cwd: dir });
  return dir;
}

function runNode(args, options = {}) {
  const env = { ...process.env };
  delete env.GOAL_NOTES_HOME;
  delete env.GOAL_NOTES_STORE;

  return spawnSync(process.execPath, args, {
    cwd: options.cwd,
    env: { ...env, HOME: options.home || options.cwd || os.tmpdir(), ...options.env },
    input: options.input,
    encoding: 'utf8',
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('goal-notes universal CLI and compatibility hook', () => {
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

  it('universal project storage keeps note payloads ignored in git projects', () => {
    const cwd = mkTempProject();
    const result = runNode([cliPath, 'capture', '--goal', 'private local memory', '--cwd', cwd], { cwd });

    assert.equal(result.status, 0, result.stderr);
    const sentinel = path.join(cwd, '.goal-notes', '.gitignore');
    assert.equal(fs.existsSync(sentinel), true);

    execFileSync('git', ['check-ignore', '.goal-notes/goal-notes.md'], { cwd });
    execFileSync('git', ['check-ignore', '.goal-notes/goal-notes.jsonl'], { cwd });
  });

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

  it('compatibility hook ignores non-goal prompts', () => {
    const cwd = mkTempProject();
    const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd, prompt: 'hello there' });
    const result = runNode([hookPath], { cwd, input: payload });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(fs.existsSync(path.join(cwd, '.omx', 'goal-notes.md')), false);
  });

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

  it('GOAL_NOTES_STORE invalid values fail closed for human CLI usage', () => {
    const cwd = mkTempProject();
    const result = runNode([cliPath, 'capture', '--goal', 'bad env store', '--cwd', cwd], {
      cwd,
      env: { GOAL_NOTES_STORE: 'nonsense' },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid store/i);
    assert.equal(fs.existsSync(path.join(cwd, '.goal-notes')), false);
    assert.equal(fs.existsSync(path.join(cwd, '.omx')), false);
  });

  it('GOAL_NOTES_STORE invalid values warn and exit zero in hook mode', () => {
    const cwd = mkTempProject();
    const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd, prompt: '/goal invalid hook env store' });
    const result = runNode([cliPath, 'hook', '--format', 'codex-native'], {
      cwd,
      input: payload,
      env: { GOAL_NOTES_STORE: 'nonsense' },
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /invalid store/i);
    assert.equal(fs.existsSync(path.join(cwd, '.goal-notes')), false);
    assert.equal(fs.existsSync(path.join(cwd, '.omx')), false);
  });

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

  it('redacts bearer headers, quoted secret values, and cookie payloads', () => {
    const cwd = mkTempProject();
    const goal = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghijklmnopqrstuvwxyz.1234567890 password="abc def" cookie: session=supersecret value';
    const result = runNode([cliPath, 'capture', '--goal', goal, '--cwd', cwd], { cwd });

    assert.equal(result.status, 0, result.stderr);
    const content = fs.readFileSync(path.join(cwd, '.goal-notes', 'goal-notes.md'), 'utf8');
    assert.doesNotMatch(content, /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/);
    assert.doesNotMatch(content, /abcdefghijklmnopqrstuvwxyz\.1234567890/);
    assert.doesNotMatch(content, /abc def/);
    assert.doesNotMatch(content, /session=supersecret/);
    assert.match(content, /\[redacted/);
  });

  it('redacts full multi-cookie headers in markdown and JSONL', () => {
    const cwd = mkTempProject();
    const goal = 'Cookie: session=supersecret; csrftoken=secret2; theme=light';
    const result = runNode([cliPath, 'capture', '--goal', goal, '--cwd', cwd], { cwd });

    assert.equal(result.status, 0, result.stderr);
    const markdown = fs.readFileSync(path.join(cwd, '.goal-notes', 'goal-notes.md'), 'utf8');
    const jsonl = fs.readFileSync(path.join(cwd, '.goal-notes', 'goal-notes.jsonl'), 'utf8');
    for (const content of [markdown, jsonl]) {
      assert.doesNotMatch(content, /session=supersecret/);
      assert.doesNotMatch(content, /csrftoken=secret2/);
      assert.doesNotMatch(content, /theme=light/);
      assert.match(content, /\[redacted-cookie\]/);
    }
  });

  it('capture writes at the nearest git project root from nested cwd', () => {
    const root = mkTempProject();
    const nested = path.join(root, 'packages', 'app');
    fs.mkdirSync(nested, { recursive: true });

    const result = runNode([cliPath, 'capture', '--goal', 'nested project goal', '--cwd', nested], { cwd: nested });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(root, '.goal-notes', 'goal-notes.md')), true);
    assert.equal(fs.existsSync(path.join(nested, '.goal-notes', 'goal-notes.md')), false);
  });

  it('capture uses nearest project marker when git root is unavailable', () => {
    const root = mkTempDir();
    fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}\n');
    const nested = path.join(root, 'src', 'feature');
    fs.mkdirSync(nested, { recursive: true });

    const result = runNode([cliPath, 'capture', '--goal', 'marker project goal', '--cwd', nested], { cwd: nested });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(root, '.goal-notes', 'goal-notes.md')), true);
    assert.equal(fs.existsSync(path.join(nested, '.goal-notes', 'goal-notes.md')), false);
  });

  it('hook mode handles malformed JSON without failing or stdout', () => {
    const cwd = mkTempProject();
    const result = runNode([cliPath, 'hook', '--format', 'codex-native'], { cwd, input: '{bad json' });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /could not parse|malformed/i);
  });

  it('codex-native hook mode defaults to legacy omx storage', () => {
    const cwd = mkTempProject();
    const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd, prompt: '/goal cli hook default omx' });
    const result = runNode([cliPath, 'hook', '--format', 'codex-native'], { cwd, input: payload });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(fs.existsSync(path.join(cwd, '.omx', 'goal-notes.md')), true);
    assert.equal(fs.existsSync(path.join(cwd, '.goal-notes', 'goal-notes.md')), false);
  });

  it('codex-native hook accepts alternate event and prompt field names', () => {
    const cwd = mkTempProject();
    const payload = JSON.stringify({ hookEventName: 'UserPromptSubmit', cwd, userPrompt: 'please remember /goal alternate fields work' });
    const result = runNode([cliPath, 'hook', '--format', 'codex-native'], { cwd, input: payload });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(fs.readFileSync(path.join(cwd, '.omx', 'goal-notes.md'), 'utf8'), /alternate fields work/);
  });

  it('compatibility wrapper forces legacy omx storage even when GOAL_NOTES_STORE is universal', () => {
    const cwd = mkTempProject();
    const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd, prompt: '/goal wrapper store precedence' });
    const result = runNode([hookPath], { cwd, input: payload, env: { GOAL_NOTES_STORE: 'universal' } });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(fs.existsSync(path.join(cwd, '.omx', 'goal-notes.md')), true);
    assert.equal(fs.existsSync(path.join(cwd, '.goal-notes', 'goal-notes.md')), false);
  });

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

  it('--store takes precedence over GOAL_NOTES_STORE for capture', () => {
    const cwd = mkTempProject();
    const result = runNode([cliPath, 'capture', '--goal', 'explicit store wins', '--store', 'universal'], {
      cwd,
      env: { GOAL_NOTES_STORE: 'omx' },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(cwd, '.goal-notes', 'goal-notes.md')), true);
    assert.equal(fs.existsSync(path.join(cwd, '.omx', 'goal-notes.md')), false);
  });

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

  it('GOAL_NOTES_HOME controls universal global fallback when cwd is unavailable', () => {
    const home = mkTempDir('goal-notes-home-');
    const missing = path.join(home, 'missing-cwd');
    const result = runNode([cliPath, 'capture', '--goal', 'global fallback', '--cwd', missing], {
      cwd: home,
      home,
      env: { GOAL_NOTES_HOME: path.join(home, 'custom-goals') },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(home, 'custom-goals', 'goal-notes.md')), true);
  });

  it('omx global fallback ignores GOAL_NOTES_HOME and writes under HOME .codex', () => {
    const home = mkTempDir('goal-notes-home-');
    const missing = path.join(home, 'missing-cwd');
    const result = runNode([cliPath, 'capture', '--goal', 'omx global fallback', '--cwd', missing, '--store', 'omx'], {
      cwd: home,
      home,
      env: { GOAL_NOTES_HOME: path.join(home, 'custom-goals') },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(home, '.codex', 'goal-notes', 'goal-notes.md')), true);
    assert.equal(fs.existsSync(path.join(home, 'custom-goals', 'goal-notes.md')), false);
  });

  it('can be imported without creating note stores', () => {
    const cwd = mkTempDir();
    const script = [
      `process.chdir(${JSON.stringify(cwd)});`,
      `require(${JSON.stringify(cliPath)});`,
      `const fs = require('node:fs');`,
      `const path = require('node:path');`,
      `if (fs.existsSync(path.join(process.cwd(), '.goal-notes')) || fs.existsSync(path.join(process.cwd(), '.omx'))) process.exit(1);`,
    ].join('');
    const result = runNode(['-e', script], { cwd });

    assert.equal(result.status, 0, result.stderr);
  });
});
