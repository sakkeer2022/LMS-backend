# ADR-0005: Category tree replaces the typed catalogue tree

**Status:** Accepted (supersedes ADR-0003)
**Date:** 2026-11-02
**Deciders:** Vishnudas (LMS-0, ticket number to be assigned)

---

## Context

ADR-0003 built the Categories & Content tree as `catalogue_nodes`: typed nodes
(CATEGORY > SUBSECTION > BOARD > SUBJECT > LEVEL), each LEVEL leaf owning one
`curricula` row. Product has since issued a schema proposal that changes the model:

- The tree is made of **categories only**. Board, level and subject are lookup
  tables attached to leaves, not tree nodes.
- **Only leaves are bookable.** Curricula, bookings and student profiles reference a
  bookable leaf.
- The tree has new roots, **Academic** and **Non-academic**. The current frontline tabs
  (School, University, JEE / NEET, Research & Skill) become their children.
- Nodes carry a materialised `path` and `depth`, and a `version` for optimistic
  concurrency.

## Decision

1. **`categories` becomes the tree.** New columns: `parent_id` (self FK), `path`
   (varchar 500, unique), `depth`, `is_bookable`, `requires_level` and `version`.
   `requires_board`, `is_active` and `display_order` already existed. The global unique
   index on `code` becomes a sibling-unique index, `(parent_id, code) NULLS NOT DISTINCT`,
   so roots are unique too.
2. **`category_levels (category_id, level_id)`** lists the levels a leaf allows.
3. **A curriculum is an offering of a leaf:** `(category_id = leaf, board_id?,
   subject_id, level_id?)`. The natural key keeps its existing `NULLS NOT DISTINCT`
   unique index. A composite FK, `(category_id, level_id) → category_levels`, enforces
   the allowed levels. A leaf's subject and board options are the distinct values in
   its active curricula.
4. **The database enforces the invariants.** The service still checks first, so users
   get clear messages.
   - CHECK constraints: a root has depth 0 and no parent; the path ends with the code;
     the code format is valid; a node is not its own parent.
   - A deferred constraint trigger, `categories_tree_check`, runs at commit. It checks
     each changed row against its parent (path, depth, parent not bookable) and against
     its children (paths and depths match, no children while bookable). Depth strictly
     increases along every parent edge, so a consistent tree cannot contain a cycle.
     The trigger takes `FOR SHARE` on the parent, which makes concurrent create-and-move
     and create-and-make-bookable safe: one of the two transactions fails.
   - Contract phase: deferred triggers on `curricula` and `student_profiles` require a
     bookable category and enforce `requires_board` and `requires_level`. The category
     trigger refuses flag changes that would invalidate existing references.
5. **Moves rebuild the subtree in one statement.** The service locks the moved node, the
   new parent and the whole subtree with `SELECT … FOR UPDATE`, checks the version and
   the cycle rule inside the transaction, then rewrites `path` and `depth` for the
   subtree. Changing a node's code uses the same rebuild.
6. **Deleting is guarded.** A node with children, curricula, student profiles, scoped
   levels or a legacy `catalogue_nodes` link cannot be hard-deleted. The API returns the
   reason, and the admin deactivates the node instead. Deactivation hides the whole
   subtree from learners: the learner queries exclude any node that has an inactive
   ancestor (a path-prefix check served by a partial index).
7. **Migration: expand, then contract.**
   - `…_category_tree_expand` is additive. It backfills and verifies, and aborts the
     whole migration if any check fails.
   - `…_category_tree_contract` re-verifies, makes `curricula.level_id` nullable, and
     adds the reference triggers and the level FK.
   - Each migration has a rollback script in `prisma/rollbacks/`.
8. **The legacy tree is frozen, not dropped.** After the expand step, the
   `catalogue_nodes` write endpoints return 409 `CATALOGUE_TREE_MIGRATED`, because their
   curriculum sync would rewrite `curricula.category_id` back to the tabs. Their reads
   still work. The old category and curriculum filters (onboarding dropdowns, pricing)
   now match a category and its whole subtree, so callers that pass a tab id get the
   same rows as before. Dropping `catalogue_nodes` is a later ticket, once the new tree
   is verified in production.
9. **The new learner read path is behind the feature flag `catalogue.category_tree`.**
   While it is off, `/catalogue/category-tree/*` returns 404.

## Backfill mapping

| Before | After |
|---|---|
| — | Roots `academic` and `non-academic` (depth 0, not bookable) |
| Tab category `research-skill` | `non-academic/research-skill` |
| Every other tab category | `academic/<code>` |
| SUBSECTION node (e.g. K-12) | Child category with the **same id**, code = slug, active = PUBLISHED |
| Curriculum owned by a LEVEL leaf under a subsection | `category_id` = that subsection |
| Curriculum pointing at a tab that now has children | Moved to a new `general` leaf under the tab |
| Every childless node | `is_bookable = true`, `requires_level = true`, `requires_board` from the tab |
| Allowed levels of a leaf | Levels scoped to its tab plus levels its curricula use |
| Student profile on a non-leaf tab | The tab's only bookable leaf, or the leaf of all the student's subjects; otherwise the migration aborts |

## Consequences

- Board, subject and level ordering, the Move picker and status all work for any depth.
- One SQL aggregate loads the whole admin tree with child and curricula counts. There
  is no per-category round trip.
- `curricula.level_id` becomes nullable. Pricing and offering labels handle a null level.
- Prisma cannot express the `text_pattern_ops` index, the `NULLS NOT DISTINCT` sibling
  index, the CHECK constraints or the triggers. Review `migrate dev --create-only`
  output and remove any statement that drops or rebuilds them (same rule as the
  curricula index in `findings.md`).
- There is no bookings table yet. `resolveBookableOffering()` in the category-tree
  module is the check a future bookings module must call. Its DB trigger should mirror
  the curricula one.
