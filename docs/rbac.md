# Access control (RBAC) for the admin portal

Roles are created and edited in the admin UI (Roles) and stored in the database. Permissions are defined in code and synced to the
`permissions` table. A person can hold several roles; what they may do is the union of their active roles' permissions. There are no
deny rules. The API denies by default; the UI only hides or disables what the API would refuse.

**Scope.** Only the admin portal changes. Student and faculty sessions keep reading permissions from their token, exactly as before
(`authenticate` re-reads the database only when the token's `portal` is `admin` and `RBAC_LIVE_ADMIN=true`).

## Register a permission

1. Add one line to `PERMISSIONS` in `src/core/security/rbac.ts`, named `resource.action` (lower case, underscores):
   `permission('payout.approve', 'Approve a tutor payout')`. The description is what admins read in the role editor, so write it
   in plain words.
2. Guard the route with it. That is all: the key is upserted into `permissions` when the server starts (`syncPermissionRegistry`),
   `super_admin` holds `*` so it has the new key at once, and the role editor lists it under its module (`payout`).

`tests/unit/rbac.test.ts` fails if a guard uses an unregistered key.

## Protect a route

```ts
router.use(authenticate);
router.post('/:id/approve', requirePermission('payout.approve'), controller.approve);
```

Self-service admin routes that act only on the signed-in account use `requireAdminPortalUser` instead.
`tests/unit/route-guards.test.ts` fails CI for any route that is not guarded, public by design, or self-only, so an unmapped route
cannot be added by accident. Missing or invalid token: 401. Valid token without the permission: 403.

## Log activity

```ts
import { logActivity } from '@modules/audit/index.js';
await logActivity({ actor: req, action: 'payout.approve', entityType: 'payout', entityId: id, before, after });
```

Entries are append-only and hash-chained (`audit_logs`), show in Activity log (`audit.read`) and have no edit or delete API.
Automatically logged: role created, edited, deleted; role permissions changed; roles assigned, removed, replaced; user activated,
deactivated, deleted; login success and failure; refused system-role changes.

## Roles screen

Roles and their permissions are shown as cards in plain language (`amentorz-admin/src/features/roles/permission-copy.ts`). That file only
dresses the catalogue for people: a permission or area it does not know still shows, using its registered description, so registering a key
needs no change there. `GET /roles?audience=admin` leaves out the student and faculty portal roles; the Roles screen and the user role picker
use it. The Roles screen is cards with search and no pagination footer, a deliberate exception to "every list matches Students" because there
are only a handful of roles. A Super Admin can change what the Admin role can do (not its name); only the `super_admin` role is fully locked.

## Guardrails

- The last active `super_admin` cannot be deactivated, deleted or have the role removed.
- Nobody can change their own roles.
- A role that users hold cannot be deleted (409 with a plain message).
- The `super_admin` role cannot be edited, deactivated or deleted. Other system roles can be changed only by `super_admin`.
- Nobody but `super_admin` can grant a permission they do not hold.
- Any role that is not `student` or `faculty` lets its holder sign in to the admin portal (`roleInPortal`); the portal then shows what
  their permissions allow, and a role with none sees a "no access" page.

## Reserved, not implemented

`user_roles.expires_at` and `user_roles.scope` exist but nothing reads, validates or writes them. Do not rely on them until a ticket
defines their behaviour.

## Roll out

1. Deploy with `RBAC_LIVE_ADMIN=false` (the default). Behaviour is unchanged except the new guardrails, audit entries and screens.
2. Make sure the three owners hold `super_admin` (staff who should keep access hold `admin` or a new role):
   `SELECT u.email, r.name FROM user_roles ur JOIN users u ON u.id = ur.user_id JOIN roles r ON r.id = ur.role_id WHERE r.name IN ('super_admin','admin');`
   Staff with no role get no access until configured.
3. Create the roles in the UI, assign them, then set `RBAC_LIVE_ADMIN=true` and restart. From then on an admin request is checked
   against the database: a removed permission, a deactivated role or a deactivated user blocks the very next request, with no re-login.
4. **Roll back:** set `RBAC_LIVE_ADMIN=false` and restart. The migration only adds two nullable columns; its down script is
   `prisma/rollbacks/20261113090000_user_roles_reserved_columns.down.sql`.

There is no cache: each admin request makes a few indexed queries. Add one only with invalidation that works across instances.

## Make the audit log append-only in the database (ops, once per environment)

The application never updates or deletes `audit_logs`. To enforce it in Postgres, run as the owner, with the app's role name:

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM <app_role>;
```

Not part of a migration: the role name differs per environment, and test databases truncate this table. Note that `audit_logs.actor_id`
has `ON DELETE SET NULL`, which would need the owner role if a user row were ever hard-deleted (users are soft-deleted).

## Activity log noise

The request-level audit middleware no longer records successful reads (browsing), and it skips 401 (an expired session). Reads of the audit log itself are still recorded, as the contract requires; 403 and 5xx on any request are still recorded.
`GET /audit` takes `view`: `activity` (default) lists named actions (`entity.verb`) and any SECURITY or CRITICAL entry; `requests` lists the raw API request entries. An explicit `action` filter ignores `view`. A record's own history (for example a tutor's approval) is `GET /audit?entity=faculty_profile&resourceId=<id>`; the tutor review drawer shows it to anyone with `audit.read`.
Old raw entries stay (the log is append-only); they now sit under "API requests".

## Users list

`GET /users` takes `audience=admin` (leaves out accounts that hold only the student or faculty role; someone with no role still shows) and `roleId`. Each row now lists its roles.

## Creating a user

`POST /users` takes optional `roleIds`. They pass the same checks as assigning roles later (an admin role needs a Super Admin; the creator can only grant permissions they hold), and nothing is created if a check fails. The account is created email-verified, because an admin typed the address and handed over the password; before this, a new user could not sign in ("Email address is not verified") and had no way to verify. A `user.create` activity entry is written.
Not done: forcing the new user to change the temporary password at first sign-in.

## Admin-set passwords

A new user (and a user after "Reset password") is `PENDING_ACTIVATION`. While the admin portal's live access is on (`RBAC_LIVE_ADMIN`), such an account can only call `/auth/*` and `/admin/me/*`; everything else answers 403 "Change your password to continue". `GET /admin/me/permissions` returns `mustChangePassword`, and the admin app sends the person to My profile with the change-password dialog open. Changing the password makes the account `ACTIVE` and ends its sessions.
`POST /users/:id/reset-password` (permission `user.update`) sets a random password, emails it (never returned), ends the user's sessions and sets them back to pending. It refuses yourself, and an admin account unless you are a Super Admin.
Known limit: with `RBAC_LIVE_ADMIN` off the server does not enforce the forced change; the app still redirects.
