#!/usr/bin/env node
// Pre-push guard: every branch being pushed must follow the naming convention in
// src/docs/CONTRIBUTING.md, and local backup refs must never reach the remote.
// Git passes "<local ref> <local sha> <remote ref> <remote sha>" lines on stdin.
const fs = require('fs');
const { execSync } = require('child_process');

const LONG_LIVED = ['main', 'development', 'qa'];
const WORK_BRANCH = /^(feature|bugfix|hotfix|release)\/LMS-\d+-[a-z0-9]+(-[a-z0-9]+)*$/;
const DELETE_SHA = /^0+$/;

function isAllowedBranch(name) {
  return LONG_LIVED.includes(name) || WORK_BRANCH.test(name);
}

function pushedRefs() {
  if (process.stdin.isTTY) return null;
  const input = fs.readFileSync(0, 'utf8').trim();
  if (!input) return null;
  return input.split('\n').map((line) => {
    const [, localSha, remoteRef] = line.trim().split(/\s+/);
    return { localSha, remoteRef };
  });
}

const errors = [];
const refs = pushedRefs();

if (refs) {
  for (const { localSha, remoteRef } of refs) {
    if (DELETE_SHA.test(localSha)) continue;
    if (remoteRef.startsWith('refs/tags/')) {
      const tag = remoteRef.slice('refs/tags/'.length);
      if (tag.startsWith('backup/'))
        errors.push(`Tag "${tag}" is a local backup and must not be pushed.`);
      continue;
    }
    const branch = remoteRef.replace(/^refs\/heads\//, '');
    if (!isAllowedBranch(branch))
      errors.push(`Branch "${branch}" does not follow the naming convention.`);
  }
} else {
  // Run by hand (no stdin): check the current branch.
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  if (branch !== 'HEAD' && !isAllowedBranch(branch)) {
    errors.push(`Branch "${branch}" does not follow the naming convention.`);
  }
}

if (errors.length > 0) {
  for (const message of errors) console.error(message);
  console.error(
    'Branches: main, development, qa or <feature|bugfix|hotfix|release>/LMS-<ticket>-<short-kebab-description>,'
  );
  console.error('for example feature/LMS-38-student-registration. See src/docs/CONTRIBUTING.md.');
  process.exit(1);
}
