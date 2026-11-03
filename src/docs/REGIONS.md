# Regional Support: India and UAE

Phase 1 serves students and faculty in **India (`IN`)** and the **United Arab Emirates (`AE`)** from one platform and one shared database. Every feature must work correctly for both countries. Read this before building anything that shows content, validates contact details, handles dates and times, or applies age, consent or legal rules.

## Rules for every feature

1. **Never hard-code a country.** No `'+91'`, `'IN'`, `Asia/Kolkata` or India-only rules inside a module. Country data and helpers live in one shared place (`src/shared/regions/`, see below) and every module uses them.
2. **Country is a property of the user,** stored as an ISO 3166-1 alpha-2 code (`IN`, `AE`). Behaviour that differs by country is decided from that code, never from IP address or browser language.
3. **Store neutral values, present local ones:**

   | Data           | Stored as                                                           | Shown as                                           |
   | -------------- | ------------------------------------------------------------------- | -------------------------------------------------- |
   | Mobile numbers | E.164, for example `+919876543210`, `+971501234567` (`VARCHAR(16)`) | National format for the user's country             |
   | Timestamps     | UTC                                                                 | The user's time zone (`users.timezone`, IANA name) |
   | Country        | ISO 3166-1 alpha-2                                                  | Country name                                       |
   | Money          | INR paise (integer)                                                 | INR, for every country (see Currency)              |

4. **Country-specific content is selected by country** (policies, consent documents and other legal text). If a document does not exist for the user's country, fail clearly; never silently show another country's legal text.
5. **Tests cover both countries** wherever behaviour differs: at least one Indian and one UAE case.
6. **When the client documents are silent, do not guess.** Add the question to the open decisions below and to `findings.md`.

## Country reference

| Concern                                    | India (`IN`)                                 | UAE (`AE`)                                                                 | Source and status                                                                                                                         |
| ------------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Dialling code                              | `+91`                                        | `+971`                                                                     | Standard                                                                                                                                  |
| Mobile numbers                             | 10 digits after `+91`, starting 6, 7, 8 or 9 | 9 digits after `+971`, starting 5                                          | Standard; validate per country in the shared helper                                                                                       |
| Default time zone                          | `Asia/Kolkata` (UTC+5:30)                    | `Asia/Dubai` (UTC+4)                                                       | Standard; the user can change it                                                                                                          |
| Currency                                   | INR                                          | **INR**                                                                    | Project plan: every student, including UAE-based, is charged in INR only; no multi-currency                                               |
| Language                                   | English                                      | English                                                                    | Client documents mention no other language for Phase 1                                                                                    |
| Policies and consent documents             | India versions                               | UAE versions                                                               | Client supplies both; placeholders in development (see below)                                                                             |
| Data protection law                        | Digital Personal Data Protection Act 2023    | Federal Decree-Law No. 45 of 2021 (PDPL)                                   | Client or legal to confirm what each requires of the platform                                                                             |
| Age below which guardian consent is needed | Under 18                                     | Under 18                                                                   | Team decision 2026-10-29; client confirmation pending (`docs/PENDING_DECISIONS.md` C8). Read it from the country data, never hard-code it |
| School boards                              | CBSE, ICSE, state boards                     | Schools follow several curricula (for example CBSE, British, American, IB) | Catalogue data is configured by admins per country (`boards.country`); never hard-coded                                                   |
| Taxes on payments                          | To confirm (Payments, M10)                   | To confirm (Payments, M10)                                                 | Not needed in Sprint 1                                                                                                                    |

## Shared region data (planned)

Built with the first feature that needs it (LMS-99), designed so a new country is a data change, not a code change.

**Database: a `countries` reference table** (source of truth, seeded with `IN` and `AE`):

| Column                          | Example (`IN` / `AE`)         | Purpose                                                                                   |
| ------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| `code` (PK, ISO 3166-1 alpha-2) | `IN` / `AE`                   | Referenced by `student_profiles.country`, `boards.country` and `policy_documents.country` |
| `name`                          | India / United Arab Emirates  | Display                                                                                   |
| `dial_code`                     | `+91` / `+971`                | Mobile numbers and deriving the country from a number                                     |
| `mobile_pattern`                | National-number pattern       | Validation                                                                                |
| `default_timezone`              | `Asia/Kolkata` / `Asia/Dubai` | New users' default time zone                                                              |
| `guardian_consent_age`          | `18` / `18`                   | Age below which guardian consent is needed                                                |
| `is_active`, `display_order`    |                               | Enable a country without a deployment                                                     |

A `country_regions` table (Indian states, UAE emirates) is added only once the client answers what "region" means for reports (`docs/PENDING_DECISIONS.md` C10).

**Code:**

- `src/modules/regions/` reads the table (cached) and exports `getCountry(code)`, `countryFromMobile(e164)`, `isValidMobile(e164, country?)`, `defaultTimezone(code)`, `guardianConsentAge(code)` and a Zod schema for an active country code.
- Pure helpers with no database access (E.164 parsing) go in `src/shared/`.
- Modules use these functions; none of them reads country rules from anywhere else.

## How the country is captured

- **Now:** derived from the mobile number's dialling code at registration (`+91` → `IN`, `+971` → `AE`). No new form field, so the onboarding UI does not change.
- **Later:** may switch to IP-based detection or a form field without changing how the country is stored or used.
- **Region:** a mobile number does not identify an Indian state or a UAE emirate, so region stays empty until C10 is answered.

## Scalability without UI changes

Backend changes made for scalability (reference tables, configuration, extra columns) must not change what the UI shows or collects. If a scalability change would need a UI change (a new field, a different validation message, a new step), raise it as a pending decision instead of making it.

## Current state in the schema

- `users.mobile_number` (E.164), `users.timezone` (IANA) and `boards.country` exist.
- `student_profiles.country` has no default: registration sets it from the mobile number's dialling code (see above). `boards.country` still defaults to `IN` until the catalogue API (LMS-54) asks for a country; remove that default then.
- `policy_documents` has **no country** yet. Country-specific consent and policies (LMS-99) need a `country` column and a unique `(type, country, version)` with a migration.

## Open decisions

Tracked in `docs/PENDING_DECISIONS.md`: consent age confirmation (C8), policy documents per country (C7), region meaning (C10), hosting region (C11) and, later, tax treatment for each country (payments).
