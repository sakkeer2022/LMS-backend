# RBAC Rules & Definitions

## Core Entities

1. **Users** [Implemented]: The primary entities authenticated into the system.
2. **Roles** [Implemented]: Logical collections of permissions. Roles can be hierarchical.
3. **Permissions** [Implemented]: The smallest unit of authorization, defining access to a specific resource and action.
4. **Permission Groups** [Planned]: UI-friendly aggregations of permissions (e.g., "Ticket Management").
5. **Platforms** [Planned]: Allows scoping roles and permissions to specific applications (e.g., "Web App", "Admin Dashboard", "Mobile App").
6. **Tenants** [Planned]: Represents isolated organizational units. Users, roles, and permissions can be scoped to a tenant.

## Role Management [Implemented]

- **Hierarchical Roles**: Roles can inherit permissions from child roles to simplify assignments.
- **Dynamic Mapping**: Users can be assigned multiple roles. Roles map to many permissions.
- **System Roles**: Immutable root roles (e.g., SuperAdmin) that cannot be deleted or modified.

## Permission Assignments [Implemented]

- Permissions are strictly assigned to Roles, not directly to Users (to prevent maintenance overhead), though exceptions may be made for tenant-specific overrides in the future.
- Users inherit all permissions from their active roles.
- **Strict Permission Enforcement**: Route guards evaluate permissions (e.g., `requirePermission('user.create')`) rather than role names, ensuring dynamic roles work seamlessly without codebase changes. The `requireRole` middleware is deprecated.

## Permission Naming [Implemented]

- **Format: `resource.action`**, lower case with underscores, for example `user.read`, `role.assign_permission`, `feature_flags.update`. Do not use `resource:action`.
- **One source of truth:** `src/core/security/rbac.ts` lists every permission (`PERMISSIONS`) and the seeded system roles (`SYSTEM_ROLES`). `prisma/seed.ts` seeds from it.
- **Every guard must use a listed name.** `tests/unit/rbac.test.ts` scans every `requirePermission('…')` in `src/modules/**/*.routes.ts` and fails when a name is missing from the list, or when a seeded admin would fail a guard.
- **Adding a permission:** add it to `PERMISSIONS`, grant it to the roles that need it in `SYSTEM_ROLES`, use it in the route guard, and re-run `npx prisma db seed`.
- **Planned names from the Sprint 1 contract** are added by the epic that builds the endpoints: `catalogue.read`, `catalogue.manage`, `pricing.read`, `pricing.manage`, `library.upload`, `library.moderate`, `faculty.create`, `faculty.read`, `faculty.update`, `faculty.update_self`, `faculty.documents`, `faculty.approve`, `faculty.publish`, `faculty.assign`, `students.read`. (`configuration.read` and `configuration.manage` were added with the settings API, LMS-90.)

## Seeded System Roles [Implemented]

| Role          | Portal  | Permissions                                             |
| ------------- | ------- | ------------------------------------------------------- |
| `super_admin` | Admin   | `*` (everything)                                        |
| `admin`       | Admin   | Every listed permission except `feature_flags.*`        |
| `faculty`     | Faculty | None yet. Faculty endpoints (LMS-39) add theirs         |
| `student`     | Student | None yet. Student endpoints (LMS-38, LMS-42) add theirs |

- The template `viewer` role is no longer seeded. Existing databases keep it until it is deleted.
- `super_admin` is an internal operator role, not a client role. The SOW (A1.5) defines three roles (student, faculty and admin) and puts new user roles under change control, so `super_admin` is never offered in the product or the API contract.
- **System role changes (LMS-104):** only `super_admin` can assign, remove or inherit from the `super_admin` and `admin` roles, change the permissions of any system role, or edit a system role. An `admin` can still assign `student` and `faculty` and manage custom roles. Refused attempts return 403 and are written to the audit log (`user.roles_changed_denied`, `role.system_changed_denied`). Guard: `src/modules/roles/system-role-guard.ts`. Not covered: an admin can still give a custom role any permission and assign it (tracked separately).
- **Portal guard:** routes are protected by permissions, which already blocks students and faculty from admin routes. A role-based portal guard for portal-only routes (for example student-only endpoints) is added with the first such route in LMS-100.

## Access Token Claims [Implemented]

The access token carries `sub` (user id), `email`, `roles` (role names), `permissions` (resolved through role inheritance), `policies` (ABAC rules) and `jti`. **Decided (2026-10-29):** no tenant parameter and no invented tenant claims. The admin frontend currently expects a `tenantIds` claim; that gate must be removed or resolved through review during frontend integration. The backend has a single shared database with no tenants.

## Future Extensibility [Planned]

- **Wildcards** [Implemented]: `resource.*` or `resource.manage` grants every action on one resource. `*` and `admin.*` both grant **everything**: `admin.*` is a global wildcard, not "all admin actions", so never grant it by mistake.
- **ABAC (Attribute-Based Access Control)** [Planned]: Future integration to allow conditions on permissions, such as allowing a user to read a ticket only if `ticket.assignee_id == user.id`.
