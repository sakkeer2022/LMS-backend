# Frontend Architecture & UI Patterns

## Tech Stack

- **Framework**: Next.js App Router
- **Data Fetching & Caching**: RTK Query (Redux Toolkit)
- **State Management**: Redux Toolkit (for complex UI state; auth token persistence)
- **Forms & Validation**: React Hook Form + Zod
- **UI Components**: ShadCN + Tailwind CSS

## Form Handling & Validation

All forms use `react-hook-form` connected to Zod resolvers. This ensures the frontend validation logic exactly mirrors the backend API contract.

```typescript
const schema = z.object({ email: z.string().email(), password: z.string().min(8) });
const form = useForm({ resolver: zodResolver(schema) });
```

## Data Fetching (RTK Query)

We use RTK Query for all API interactions to benefit from:

- **Optimistic Updates**: When updating a user's role, the UI assumes success immediately to improve perceived latency. If the API fails, RTK Query automatically rolls back the cache.
- **Tag Invalidation**: Assigning a role to a user invalidates the `User` and `Permissions` cache tags, triggering a background refetch automatically.

## Permission-Aware UI Rendering

The frontend must securely and dynamically adapt to the user's permissions.

### 1. Route Guards

Next.js middleware or Higher-Order Components (HOCs) verify permissions before rendering page chunks.

```tsx
export default function AdminDashboard() {
  const { hasPermission } = usePermissions();
  if (!hasPermission('admin.*')) return <ForbiddenPage />;
  return <Dashboard />;
}
```

### 2. Dynamic Sidebar & Menus

Navigation links must filter themselves based on the permission engine.

```tsx
const navItems = [
  { label: 'Tickets', path: '/tickets', requiredPermission: 'ticket.read.*' },
  { label: 'Users', path: '/users', requiredPermission: 'user.read.organization' },
].filter((item) => hasPermission(item.requiredPermission));
```

### 3. Action-Level Hiding

Action buttons (e.g., "Delete User") must be wrapped in a permission guard component.

```tsx
<RequirePermission permission="user.delete">
  <Button variant="destructive">Delete User</Button>
</RequirePermission>
```

## Resilience & UX

- **Error Boundaries**: Wrap major feature boundaries to catch rendering errors without crashing the entire SPA.
- **Suspense**: Use `<Suspense fallback={<Skeleton />}>` for loading states to provide smooth transitions.
- **Accessibility (a11y)**: ShadCN primitives handle ARIA labels, keyboard navigation, and focus management automatically.

## Management UIs

The platform will include dedicated UIs for:

- **Role Management**: Creating roles and assigning granular permissions (with a searchable, paginated table).
- **User-Role Assignment**: Assigning multiple roles to users.
- **Audit Logs**: Viewing immutable system logs with filtering by date, user, or resource.
- **Feature Flags**: Toggling dynamic functionality.
