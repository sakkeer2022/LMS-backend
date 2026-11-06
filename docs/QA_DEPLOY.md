# QA deployment (temporary: Render + Supabase)

Deploy by merging into the `qa` branch; Render builds it. The QA database is a separate Supabase project.

Render web service (free tier, no shell, no pre-deploy command):

- Branch: `qa`
- Build command: `npm ci --include=dev && npm run build && npm run qa:setup`
- Start command: `npm start`
- Health check path: `/health`

`npm run qa:setup` (scripts/qa-setup.cjs) runs `prisma migrate deploy`, `prisma db seed` and `create-admin` on every deploy.
All three are idempotent. It refuses to run unless `APP_ENV=staging`.

Extra environment variables for it: `APP_ENV=staging`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`
(only used while no super_admin exists; change the password after first sign-in).
`DATABASE_URL` must be the Supabase **session pooler** string (port 5432 on the pooler host).
