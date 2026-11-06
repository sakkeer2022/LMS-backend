# ADR-0003: Catalogue tree bridged to the existing curricula

**Status:** Superseded by [ADR-0005](0005-category-tree.md) (2026-11-02). The `catalogue_nodes` write endpoints are frozen; its reads remain until the table is dropped.
**Date:** 2026-10-29
**Deciders:** Vishnudas (LMS-53), Muhammad Sakkeer (owner of the identity and student onboarding schema)

---

## Context

The Categories & Content screens (28, 28a) show a tree: **category tab → subsection → board → subject → level**. The depth differs by category: University and JEE/NEET have no board, and Research may skip the subsection. Admins add, edit, move, archive and reorder nodes, and add whole paths by choosing existing boards, subjects and levels.

The Sprint 1 schema (migration `20261022125538_add_amentorz_domain`) already holds flat master tables (`categories`, `boards`, `subjects`, `levels`) and `curricula`, one row per (category, board?, subject, level) offering. Student onboarding (LMS-95) references `categories`, `boards` and `levels` from `student_profiles`, and `curricula` from `student_subjects`. `faculty_assignments` and `library_materials` also reference `curricula`. The contract (`docs/openapi.yaml`) exposes these tables, and student registration (LMS-99) depends on them.

Options considered:

| Option | Summary | Outcome |
|---|---|---|
| New typed catalogue tables (`CatalogueBoard`, …) | Fresh master lists plus a tree | Rejected: two sources of truth for boards, subjects and levels |
| Flat curricula only, plus a `subsections` table | Least change | Rejected: intermediate levels cannot carry their own status, order or Move, so screen 28 cannot be built |
| Repoint every reference to tree leaf ids and drop `curricula` | Cleanest model | Rejected for now: changes the student onboarding schema and LMS-99's contract |
| **Tree bridged to `curricula`** | New `catalogue_nodes`; each LEVEL leaf owns one `curricula` row | **Chosen** |

## Decision

1. **Master lists stay where they are.** `categories`, `boards`, `subjects` and `levels` are the single source of truth. `code` is the slug and `isActive` is the status. Additive columns only: `boards.sort_order`, `subjects.sort_order`, `levels.sort_order` and `levels.category_id` (optional category scope for dropdowns).
2. **`catalogue_nodes` holds the tree.** Types are ordered CATEGORY > SUBSECTION > BOARD > SUBJECT > LEVEL. SUBSECTION and BOARD may be skipped, and a child's type must come after its parent's. Status is DRAFT / PUBLISHED / ARCHIVED. A CATEGORY, BOARD, SUBJECT or LEVEL node references exactly one master row. A SUBSECTION has only a name.
3. **The leaf owns the offering.** Each LEVEL node owns exactly one `curricula` row (`curricula.node_id`, unique). The tuple columns of that row are copied from the leaf's ancestors. `curricula.is_active` is true only while the leaf and every ancestor are PUBLISHED. Everything that already references `curricula.id` keeps doing so.
4. **A combination appears once.** The `curricula` unique key is unchanged, so the same (category, board, subject, level) cannot sit under two subsections. Adding it a second time returns 409. This is a known limitation pending decision D11 (whether "Competitive" exists under School).
5. **Storage: adjacency list plus `root_id`.** No materialised path and no Postgres extension. `root_id` is the CATEGORY node a node belongs to. It never changes, because moves stay inside one category (levels and the board rule are category-scoped). One indexed query loads a whole category (at most a few thousand rows), and the tree, child counts and cycle checks are computed in memory. A Move therefore updates one node row plus the affected `curricula` rows.
6. **Board rule.** BOARD nodes are allowed only under categories with `requires_board = true` (School), and every School leaf needs a BOARD ancestor. This matches the contract rule "board is null outside School".
7. **Integrity in the database where possible.** The migration adds hand-written CHECK constraints: a node has a parent if and only if it is not a CATEGORY, each type carries only its own master reference, and the sort order is not negative. Prisma does not model CHECK constraints and ignores them when diffing. Foreign keys are `ON DELETE RESTRICT`; nothing is hard-deleted.
8. **Actor columns without FKs.** `created_by_id` and `updated_by_id` are plain UUIDs, so the identity schema (`users`) needs no new relation fields. Users are deactivated, never deleted.

## Policies carried by the service (LMS-54)

- New nodes start as DRAFT (decision D10).
- Archive is **blocked** while the node has children that are not archived (decision D3). Archiving sets `archived_at` and deactivates the leaf's curriculum.
- Move returns 409 while any curriculum in the subtree is referenced by a student subject, faculty assignment, price rule or library item. This follows the contract rule "reject structural reparenting of referenced curricula", pending decision D16.

## Consequences

### Positive
- No change to the student onboarding tables or LMS-99's contract.
- Screen 28's statuses, ordering, Move and per-category depth are all possible.
- Pricing and faculty assignments keep a single stable offering id (`curricula.id`).

### Negative
- The offering tuple is stored twice (tree ancestry and `curricula` columns). The catalogue service is the only writer and keeps both in sync in one transaction.
- `POST`/`PUT /admin/catalogue/curricula` no longer fit, because curricula are created through the tree. They are removed from the contract in LMS-54.
- The once-per-combination limit (point 4) may need revisiting once D11 is decided.
