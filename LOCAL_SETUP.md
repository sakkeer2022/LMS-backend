# Local setup (backend)

Runs the API on `http://127.0.0.1:3000/api/v1` with a seeded catalogue, demo prices and a
local admin you can log in with from the admin app (`amentorz-admin`, see its LOCAL_SETUP.md).

## Prerequisites

- Node.js 22+ and npm
- Docker Desktop (for Postgres 16 and Redis 7)

## 1. Install

```bash
npm install
```

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Local value |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:password@127.0.0.1:5432/amentorz_dev?schema=public` (use your `POSTGRES_PORT` if you changed it) |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET` | any long random strings, e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `APP_ENV` | `development` (required to seed the local admin) |
| `DEV_ADMIN_EMAIL` | optional, default `admin@local.test` |
| `DEV_ADMIN_PASSWORD` | choose one, 12+ characters. There is no default and it must never be committed |

The admin app verifies the same access token, so copy `JWT_SECRET` into the admin's `.env.local` too.

## 3. Start Postgres and Redis

```bash
docker compose up -d postgres redis
```

If port 5432 is already used (for example by a Postgres installed on Windows), pick another
host port and use it in `DATABASE_URL`:

```bash
POSTGRES_PORT=5434 docker compose up -d postgres redis
```

## 4. Migrate and seed

```bash
npm run db:setup
```

This runs, in order:

1. `prisma migrate deploy`: the schema
2. `npm run db:seed`: roles, permissions (`catalogue.*`, `pricing.*`) and the catalogue reference data
3. `npm run db:seed:demo`: demo catalogue paths and default prices (Pricing and Categories & content show real rows)
4. `npm run db:seed:users`: the local admin (`admin` role) from `DEV_ADMIN_EMAIL` / `DEV_ADMIN_PASSWORD`

Every step can be re-run safely. Re-running `db:seed:users` resets the admin's password to the
current `DEV_ADMIN_PASSWORD` and unlocks the account.

## 5. Run

```bash
npm run dev
```

Check it: `curl http://127.0.0.1:3000/health` returns `{"status":"ok",...}`.

## 6. Log in

Start the admin app (see `amentorz-admin/LOCAL_SETUP.md`), open `http://localhost:3001/login`
and sign in with `DEV_ADMIN_EMAIL` and `DEV_ADMIN_PASSWORD`.

To check the API directly:

```bash
B=http://127.0.0.1:3000/api/v1
T=$(curl -s -c jar -b jar $B/auth/csrf-token | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.csrfToken')
curl -s -c jar -b jar -H "x-csrf-token: $T" -H 'content-type: application/json' \
  -d '{"email":"admin@local.test","password":"<your DEV_ADMIN_PASSWORD>"}' $B/auth/login
curl -s -b jar "$B/admin/prices?limit=5"
```

Login sets HttpOnly `accessToken` / `refreshToken` cookies; `GET /auth/me` returns the profile.

## Tests

```bash
npm run test:unit
# Integration suites truncate their database; point them at a separate one:
TEST_DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/amentorz_test?schema=public npm run test:integration
```

The compose Postgres creates `amentorz_test` on first start (`scripts/init-test-db.sql`); migrate it once
with `DATABASE_URL=<TEST_DATABASE_URL> npx prisma migrate deploy`.

## Troubleshooting

- **`P1000: Authentication failed`**: another Postgres answers on that port. Use `POSTGRES_PORT` as above.
- **`Refusing to seed the development admin`**: set `APP_ENV=development`; it never runs with `NODE_ENV=production`.
- **Login works but admin pages say "access denied"**: the admin app's `JWT_SECRET` or `SINGLE_TENANT_ID` is missing (admin LOCAL_SETUP.md).
