#!/usr/bin/env node
// QA bootstrap for hosts without shell access (Render free tier): run it in the build command.
// Applies committed migrations, seeds reference data and creates the first super_admin.
// Every step is idempotent. APP_ENV=staging is required so it can never run against another environment by accident.
const { execSync } = require('child_process');

if (process.env.APP_ENV !== 'staging') {
  console.error('qa-setup refused: set APP_ENV=staging on the QA service (it is not set here).');
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

run('npx prisma migrate deploy');
run('npx prisma db seed');

// Signup needs a current policy of every type for each country; real ones come from the admin Legal page.
// shortcut: files go to local storage, which Render wipes on each deploy, so use STORAGE_DRIVER=s3 to keep them.
if (process.env.NODE_ENV === 'production') {
  console.log('NODE_ENV=production: skipping placeholder policies.');
} else {
  run('npx tsx prisma/load-policies.ts --placeholders'); // skips countries and types that already have one
}

if (process.env.INITIAL_ADMIN_EMAIL && process.env.INITIAL_ADMIN_PASSWORD) {
  run('npx tsx prisma/create-admin.ts'); // does nothing when a super_admin already exists
} else {
  console.log('INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD not set: skipping create-admin.');
}
