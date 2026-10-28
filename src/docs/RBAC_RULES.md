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

## Future Extensibility [Planned]

- **Wildcards** [Implemented]: Roles can be assigned wildcard permissions like `ticket.*` or `admin.*`.
- **ABAC (Attribute-Based Access Control)** [Planned]: Future integration to allow conditions on permissions, such as allowing a user to read a ticket only if `ticket.assignee_id == user.id`.
