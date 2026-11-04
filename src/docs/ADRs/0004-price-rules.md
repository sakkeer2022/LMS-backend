# ADR-0004: Price rules per offering with an optional tutor

**Status:** Accepted
**Date:** 2026-10-29
**Deciders:** Vishnudas (LMS-58), Muhammad Sakkeer (owner of the shared schema and contract)

---

## Context

The Sprint 1 schema had `session_prices`: exactly one price per faculty assignment (tutor × curriculum), with no default price, no effective dates and no revision. The contract's resolve operation required a tutor and allowed "no fallback prices".

The screens need more:

- **Screen 29 (Pricing):** rules per tutor and full path, with the GST 18% and "Student pays" columns.
- **Screen 29b:** bulk inline edit saved together.
- **Screen 28 (detail panel)** and **faculty registration (subjects and rates):** a session price **without a tutor**, i.e. a default per offering.

`session_prices` was never populated.

## Decision

1. **`price_rules` replaces `session_prices`.** A rule targets one curriculum (the category + board + subject + level offering, ADR 0003) and optionally one tutor (`faculty_id` → `faculty_profiles.id`, the key `faculty_assignments` uses). `faculty_id` null is the **default price** for the offering.
2. **Amounts.** `session_price_paise` is the pre-GST price set by the admin (integer paise, 1 to 100,000,000). `gst_rate_bps` is stored per rule and defaults to 1800 (18%). `gst_paise = round_half_up(price × rate / 10000)` and `student_pays_paise = price + gst` are computed by one function (`computeStoredAmounts`) on every create, update and bulk update, never taken from the client. CHECK constraints enforce the same formula in the database. Currency (INR) and duration (60 minutes) are fixed and not stored.
3. **CGST/SGST** (9% + 9%) is display-only, computed in responses: CGST = ceil(GST / 2), SGST = GST − CGST. Whether IGST applies (for example to UAE students) is decision D15.
4. **Uniqueness without extensions.** At most one active rule per (curriculum, tutor) for any overlapping effective window; a null tutor counts as a value of its own. Writes lock the curriculum row (`SELECT … FOR UPDATE`) and then check for overlap, so concurrent writes cannot both pass. `btree_gist` exclusion constraints were not used (no new extensions).
5. **Resolution order.** (1) The active rule for this tutor and curriculum effective at the given time; (2) otherwise the curriculum's default rule; (3) otherwise `PRICE_NOT_CONFIGURED`. Never a zero price. Broader defaults (per category or board) are out of scope. The response names the matched rule.
6. **Concurrency.** Every rule has a `revision`. Updates and bulk updates require `expectedRevision`; a stale one returns 409. Bulk updates apply in one transaction: if any row fails, nothing is saved and the response lists the failed rows as `changes[i]`.
7. **Catalogue integration without a circular import.** The pricing module registers two hooks with the catalogue: a price provider (the detail panel shows the default price) and a usage check (moving a catalogue node whose offerings have prices returns 409, decision D16).
8. **No package, bundle or credit logic** anywhere. A unit test scans the model and the module.

## Not built now

- **Tutor rate (D1).** Whether the tutor's pay differs from the session price is open. Adding a `tutor_rate_paise` column later is additive.
- **GST from settings.** When the LMS-90 GST setting exists, new rules default from it, and a recalculation job updates `gst_rate_bps`, `gst_paise` and `student_pays_paise` on active rules (bumping `revision` and auditing each change).
- **CSV import (D13)** is out of scope.
- **Booking (M05)** will copy the resolved amounts and `matchedRuleId` onto the booking, so later price changes never alter an existing booking.

## Consequences

### Positive
- One rule shape serves screens 28, 29, 29b and faculty registration.
- Totals are computed in one place and guarded by the database.
- No extension or second migration is needed when the faculty module (LMS-77) lands, because `faculty_profiles` already exists.

### Negative
- Overlap is enforced by the service under a lock, not by a database exclusion constraint. Direct SQL writes could bypass it.
- Changing the GST rate later needs a recalculation job, because amounts are stored.
