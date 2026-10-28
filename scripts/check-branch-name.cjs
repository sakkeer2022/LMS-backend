#!/usr/bin/env node
// Rejects pushes from branches that do not follow the naming convention in src/docs/CONTRIBUTING.md.
const { execSync } = require('child_process');

const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();

const LONG_LIVED = ['main', 'development'];
const WORK_BRANCH = /^(feature|bugfix|hotfix|release)\/LMS-\d+-[a-z0-9]+(-[a-z0-9]+)*$/;

if (branch === 'HEAD' || LONG_LIVED.includes(branch) || WORK_BRANCH.test(branch)) {
  process.exit(0);
}

console.error(`Branch "${branch}" does not follow the naming convention.`);
console.error('Use <feature|bugfix|hotfix|release>/LMS-<ticket>-<short-kebab-description>,');
console.error('for example feature/LMS-38-student-registration. See src/docs/CONTRIBUTING.md.');
process.exit(1);
