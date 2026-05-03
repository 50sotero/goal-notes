#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function warn(message) {
  try {
    process.stderr.write(`[goal-notes] ${message}\n`);
  } catch {
    // Preserve best-effort hook behavior even when stderr is unavailable.
  }
}

try {
  const input = fs.readFileSync(0, 'utf8');
  const cli = path.join(__dirname, 'goal-notes.js');
  const result = spawnSync(process.execPath, [cli, 'hook', '--format', 'codex-native', '--store', 'omx', '--quiet'], {
    input,
    encoding: 'utf8',
    env: process.env,
    cwd: process.cwd(),
  });

  if (result && result.stderr) process.stderr.write(result.stderr);
  if (result && result.error) warn(result.error.message || String(result.error));
} catch (error) {
  warn(error && error.message ? error.message : String(error));
}
