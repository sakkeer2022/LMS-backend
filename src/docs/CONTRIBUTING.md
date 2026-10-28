# Contributing Guidelines

How the team works on this repository: setup, branches, commits, pull requests and the files that need extra care when two developers work in parallel.

## Engineering Rigor

We value maintainability, predictability, and stability over speed. Do not skip engineering rigor to deliver features faster.

## Local Setup

Follow sections 2 to 4 of the [README](../../README.md): copy `.env.example` to `.env` (before installing, because `npm ci` runs `prisma generate`, which needs `DATABASE_URL`), install with `npm ci`, create `amentorz_dev` and `amentorz_test`, apply migrations with `npx prisma migrate deploy` and seed.

- **`.env` is git-ignored** and must never be committed. Shared values (for example provider keys) are handed over privately, never through git, Jira or chat history.
- **Each developer owns their local databases.** After pulling `development`, run `npx prisma migrate deploy` against `amentorz_dev`, and again with `DATABASE_URL` pointing at `amentorz_test` before running integration tests.
- **`npm run test` does not need a `.env` file.** `tests/env-setup.ts` injects fake deterministic values. Never rely on your private `.env` to make tests pass.

## Branches

| Branch | Purpose | Rules |
|---|---|---|
| `main` | Production-ready code | Pull requests only, from `development` or `hotfix/*` |
| `development` | Integration branch; every work branch starts here | Pull requests only |
| `<type>/LMS-<ticket>-<description>` | One branch per Jira ticket | Branch from `development`, merge back by pull request |

Work branch names use one of Bitbucket's branch types, the Jira key and a short kebab-case description:

```
feature/LMS-38-student-registration
bugfix/LMS-61-otp-expiry
hotfix/LMS-70-login-lockout
release/LMS-80-sprint-1
```

- Types: `feature` (new work), `bugfix` (fix found during development), `hotfix` (urgent production fix, branched from `main`), `release` (release preparation).
- The Jira key links the branch, its commits and its pull request to the ticket. Jira's "Create branch" button produces a valid name.
- The `pre-push` hook (`scripts/check-branch-name.cjs`) rejects any other name.
- Keep branches short-lived. Update from `development` at least daily (`git pull --rebase origin development` before you push for review).

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/) with a mandatory Jira footer:

```
<type>(<scope>): <summary in the imperative, lower case, no full stop>

<optional body: why the change was made, wrapped at 72 characters>

Refs: LMS-<ticket>
```

Example:

```
feat(auth): add registration email OTP

Sends a one-time code before the account exists so the student can
verify their email from the first onboarding step.

Refs: LMS-38
```

- **Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `style`, `revert`.
- **Scope:** the module or area touched, for example `auth`, `catalogue`, `faculty`, `db`, `contract`.
- **Footer:** `Refs: LMS-<ticket>`; list several as `Refs: LMS-38, LMS-52`. The key must be uppercase.
- **No AI attribution:** do not add `Co-Authored-By` trailers for AI tools (Claude, Copilot, Gemini and others). Co-author trailers for people are fine.
- One logical change per commit. Keep generated files (contract, migration) in the same commit as the change that produced them.
- The `commit-msg` hook runs commitlint (`commitlint.config.js`) and blocks messages that break these rules.

## Pull Requests

1. Push your branch and open a pull request into `development`. The title follows the commit format, for example `feat(auth): student registration (LMS-38)`.
2. The other developer reviews. At least one approval and a green Bitbucket Pipelines build are required before merging.
3. Merge with a merge commit or squash, then delete the branch.

Before asking for review, check every item:

- [ ] Matches the final UI and the API contract (`docs/openapi.yaml`); any mismatch with the project documents is raised in Jira, not silently resolved.
- [ ] Follows the module rules in [.agents/AGENTS.md](../../.agents/AGENTS.md) (controller → service → dto → routes, module `index.ts`, no imports of another module's internals).
- [ ] Every request input is validated with Zod; new routes have `@openapi` JSDoc.
- [ ] Unit and integration tests cover success, 401/403, validation errors and CSRF; `npm run test:unit` and `npm run test:integration` pass locally.
- [ ] Schema changes come with exactly one reviewed migration, and the docs in `docs/database/` are updated.
- [ ] Contract changes are made in `docs/build-contract-draft.py` and regenerated; `npm run contract:validate` passes.
- [ ] `npm run lint`, `npm run typecheck` and `npm run build` pass.
- [ ] `progress.md` is updated, and `findings.md` too if a decision was made.
- [ ] No secrets, `.env` files, build output or uploaded files are committed.

## Shared Files

Two developers working in parallel will meet in a few files. These rules keep conflicts small and safe.

| File | Rule |
|---|---|
| `prisma/schema.prisma` and `prisma/migrations/` | Rebase on `development` before generating a migration. One migration per pull request. If `development` gained a migration before you merge, rebase, delete your migration folder and generate it again. Never edit a migration that is already on `development`. |
| `docs/openapi.yaml`, `docs/sprint-1-endpoints.md` | Generated files: never merge them by hand. Resolve the conflict in `docs/build-contract-draft.py`, then regenerate (`cd docs && python3 -I build-contract-draft.py`). |
| `src/routes/index.ts`, `prisma/seed.ts` | Add your lines in their own block; keep pull requests small so these merge cleanly. |
| `progress.md`, `findings.md` | Add new entries at the end with the date and Jira key. On conflict keep both entries. |

## Code Standards

- **TypeScript Strict Mode**: Enabled everywhere. Absolutely no `any` types. Use `unknown` with runtime type narrowing if dynamic data is unavoidable.
- **Formatters & Linters**: `ESLint` and `Prettier` are strictly enforced. Line endings are LF everywhere (`.gitattributes`).
- **Git Hooks**: `Husky` runs lint-staged on commit, commitlint on the commit message, and the branch-name check, lint, build and unit tests before push.

## Architectural Guidelines

1. **No Business Logic in Controllers**: Controllers must be thin, delegating all operations to the Service layer.
2. **DTOs Everywhere**: Requests must be validated and transformed into Data Transfer Objects using Zod before reaching the Service layer.
3. **Schema Changes via Prisma**: Generate versioned migrations (`prisma migrate dev --create-only`), review the SQL, then apply. Manual database changes are forbidden.
4. **Prisma Client**: Always import `{ prisma }` from `@infrastructure/database/index`. Never instantiate `new PrismaClient()` directly outside of `connection.ts`.
5. **Transactions**: Wrap multi-table mutations in `prisma.$transaction(async (tx) => { ... })` and pass `tx` to sub-operations.
6. **Seeding**: Default roles, permissions, and system entities belong in `prisma/seed.ts`. Do not seed invented business values.

## Branch Protection & CI Pipeline

- **No Direct Pushes**: `main` and `development` accept changes only through pull requests (Bitbucket branch restrictions).
- **Status Checks**: Bitbucket Pipelines (`bitbucket-pipelines.yml`) runs lint, typecheck, contract validation, build, migrations and the unit and integration suites on every pull request. It must pass before merging.
- **Pre-Push Checks**: The branch-name check, lint, build and unit tests run before every push. Integration tests run in CI.
