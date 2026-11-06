# QA deployment (temporary: Render + Supabase)

Deploy by merging into the `qa` branch; Render builds it. The QA database is a separate Supabase project.

Render web service (free tier, no shell, no pre-deploy command):

- Branch: `qa`
- Build command: `npm ci --include=dev && npm run build && npm run qa:setup`
- Start command: `npm start`
- Health check path: `/health`

`npm run qa:setup` (scripts/qa-setup.cjs) runs `prisma migrate deploy`, `prisma db seed`, placeholder policies (not in production) and `create-admin` on every deploy.
All three are idempotent. It refuses to run unless `APP_ENV=staging`.

Extra environment variables for it: `APP_ENV=staging`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`
(only used while no super_admin exists; change the password after first sign-in).
`DATABASE_URL` must be the Supabase **session pooler** string (port 5432 on the pooler host).

## File storage on Dropbox (temporary QA only)

Render's free disk is wiped on every deploy and restart, so signed consents and policy PDFs go to a Dropbox app folder.
Production uses S3 (`STORAGE_DRIVER=s3` is required when `NODE_ENV=production`); keys are the same, so moving is a file copy.

1. Dropbox App Console → Create app → Scoped access → **App folder** → name it, for example `amentorz-qa`.
2. Permissions tab: tick `files.content.write` and `files.content.read`, then Submit. Do this before step 3.
3. Settings tab: note the App key and App secret. Open this in a browser, allow access, and copy the code it shows:
   `https://www.dropbox.com/oauth2/authorize?client_id=<APP_KEY>&token_access_type=offline&response_type=code`
4. Exchange the code for a refresh token (run once; the response holds `refresh_token`):
   `curl -X POST https://api.dropbox.com/oauth2/token -d code=<CODE> -d grant_type=authorization_code -u <APP_KEY>:<APP_SECRET>`
5. Render environment: `STORAGE_DRIVER=dropbox`, `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`
   (optional `DROPBOX_PATH_PREFIX=/qa`). Never commit these.

Files already written to local disk are not moved; the placeholder policies are recreated on the next deploy only
if their database rows are missing, so see "Existing policies" below.

Existing policies: the placeholder rows created before this change point at files that no longer exist. Delete the
rows of the affected policies in the Supabase table editor (`policy_documents`) or upload fresh versions from the
admin Legal page, then redeploy.
