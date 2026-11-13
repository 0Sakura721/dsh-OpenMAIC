#!/usr/bin/env node
/**
 * Publish the working tree to GitHub through the Git Data API.
 *
 * Git's transport on this machine cannot complete a TLS handshake to github.com
 * (Schannel refuses the revocation check and ignores both the git config and the
 * environment override), while `gh api` works. So the commit is assembled the way
 * the API expects it: blobs, one tree, one commit, then the branch is pointed at
 * it.
 *
 *   node scripts/publish-gh.mjs [owner/repo] [branch]
 *
 * Files come from `git ls-files`, so ignored paths are excluded by construction.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const repo = process.argv[2] ?? '0Sakura721/dsh-OpenMAIC';
const branch = process.argv[3] ?? 'main';
const log = (m) => console.log(`[publish] ${m}`);

const gh = (args, input) =>
  execFileSync('gh', args, {
    input: input === undefined ? undefined : JSON.stringify(input),
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
  });

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && statSync(line, { throwIfNoEntry: false })?.isFile());

log(`${files.length} tracked files`);

const commitMessage = execFileSync('git', ['log', '-1', '--pretty=%B'], { encoding: 'utf8' }).trim();

/**
 * A brand-new repository has no commit, and the Git Data API answers 409
 * "Git Repository is empty" to every blob/tree/commit write until one exists.
 * The Contents API is the exception: it creates the first commit itself, so it
 * seeds the branch and everything after it can use the blob path.
 */
function seedIfEmpty() {
  try {
    const ref = JSON.parse(gh(['api', `repos/${repo}/git/ref/heads/${branch}`]));
    log(`${branch} already exists at ${ref.object.sha.slice(0, 8)}`);
    return ref.object.sha;
  } catch {
    const seedPath = files.includes('README.md') ? 'README.md' : files[0];
    const bytes = readFileSync(seedPath);
    const created = JSON.parse(
      gh(
        ['api', '--method', 'PUT', `repos/${repo}/contents/${encodeURIComponent(seedPath)}`, '--input', '-'],
        { message: `${commitMessage}\n\n(seed commit)`, content: bytes.toString('base64'), branch },
      ),
    );
    log(`seeded ${seedPath} as ${created.commit.sha.slice(0, 8)}`);
    return created.commit.sha;
  }
}

const seedSha = seedIfEmpty();
// Every tracked file, including README: the tree below replaces the whole root
// rather than merging, so anything omitted would be deleted from the repository.
const remaining = files;
log(`${remaining.length} files to publish`);

// 1) Blobs. Text goes as utf8; anything with a NUL byte goes as base64.
const entries = [];
for (const path of remaining) {
  const bytes = readFileSync(path);
  const payload = bytes.includes(0)
    ? { content: bytes.toString('base64'), encoding: 'base64' }
    : { content: bytes.toString('utf8'), encoding: 'utf-8' };
  const blob = JSON.parse(
    gh(['api', '--method', 'POST', `repos/${repo}/git/blobs`, '--input', '-'], payload),
  );
  entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  log(`blob ${path}`);
}

// 2) A COMPLETE tree, deliberately without `base_tree`.
//
// Merging onto the previous tree is what left deleted modules (lib/db.mjs,
// lib/proxy.mjs, ...) alive on the remote after a rewrite: a merge only adds and
// overwrites. Publishing the full list makes the remote match the working tree,
// deletions included.
const tree = JSON.parse(
  gh(['api', '--method', 'POST', `repos/${repo}/git/trees`, '--input', '-'], {
    tree: entries,
  }),
);
log(`tree ${tree.sha.slice(0, 8)} (complete)`);

// 3) The real commit, parented on the seed.
const commit = JSON.parse(
  gh(['api', '--method', 'POST', `repos/${repo}/git/commits`, '--input', '-'], {
    message: commitMessage,
    tree: tree.sha,
    parents: [seedSha],
  }),
);
log(`commit ${commit.sha.slice(0, 8)}`);

// 4) Point the branch at it.
gh(['api', '--method', 'PATCH', `repos/${repo}/git/refs/heads/${branch}`, '--input', '-'], {
  sha: commit.sha,
  force: true,
});

// 5) The default branch is whatever the repo was created with; align it.
try {
  gh(['api', '--method', 'PATCH', `repos/${repo}`, '--input', '-'], { default_branch: branch });
} catch (error) {
  log(`could not set the default branch: ${String(error?.message ?? error).split(String.fromCharCode(10))[0]}`);
}

log(`published ${commit.sha.slice(0, 8)} to ${repo}@${branch}`);
