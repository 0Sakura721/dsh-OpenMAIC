#!/usr/bin/env node
/**
 * One-command setup: clone/build the OpenMAIC checkout the plugin runs.
 *
 *   node scripts/setup-openmaic.mjs            # clone + install + build
 *   node scripts/setup-openmaic.mjs --skip-build
 *
 * The checkout lands in `vendor/OpenMAIC` (git-ignored, never published) unless
 * `OPENMAIC_DIR` points somewhere else. Idempotent: an existing checkout is
 * reused, and only a missing build is rebuilt.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const UPSTREAM = 'https://github.com/THU-MAIC/OpenMAIC.git';
const target = resolve(process.env.OPENMAIC_DIR ?? join(REPO_ROOT, 'vendor', 'OpenMAIC'));
const skipBuild = process.argv.includes('--skip-build');

const log = (message) => console.log(`[setup] ${message}`);
const run = (command, args, cwd) => {
  log(`$ ${command} ${args.join(' ')}  (in ${cwd})`);
  execFileSync(command, args, { cwd, stdio: 'inherit' });
};

if (!existsSync(join(target, 'package.json'))) {
  mkdirSync(target, { recursive: true });
  log(`cloning ${UPSTREAM} -> ${target}`);
  // The Windows Schannel backend often fails revocation checks behind a
  // corporate proxy; disabling the check keeps a first clone working.
  run(
    'git',
    ['-c', 'http.schannelCheckRevoke=false', 'clone', '--depth', '1', UPSTREAM, target],
    REPO_ROOT,
  );
} else {
  log(`reusing the existing checkout at ${target}`);
}

if (!existsSync(join(target, 'node_modules'))) {
  run('pnpm', ['install'], target);
}

if (!skipBuild && !existsSync(join(target, '.next', 'BUILD_ID'))) {
  run('pnpm', ['build'], target);
}

log('ready. Start the Harness, then open the Classroom panel.');
