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
| Age below which guardian consent is needed | Under 18 (current rule)                      | **To confirm**                                                             | The consent flow uses 18 today. Keep the threshold per country in the shared region data, not hard-coded, until the UAE rule is confirmed |
| School boards                              | CBSE, ICSE, state boards                     | Schools follow several curricula (for example CBSE, British, American, IB) | Catalogue data is configured by admins per country (`boards.country`); never hard-coded                                                   |
| Taxes on payments                          | To confirm (Payments, M10)                   | To confirm (Payments, M10)                                                 | Not needed in Sprint 1                                                                                                                    |

## Shared region module (planned)

Create `src/shared/regions/` with the first feature that needs it (LMS-97 or LMS-99) and use it everywhere afterwards:

- `SUPPORTED_COUNTRIES`: `IN` and `AE` with dialling code, mobile pattern, default time zone and guardian-consent age.
- `isSupportedCountry(code)`, `countryFromMobile(e164)`, `isValidMobile(e164, country?)`, `defaultTimezone(country)`.
- A Zod schema for a supported country code and for an E.164 mobile number valid for that country.

It holds data and pure functions only (no database access), so any module can import it. Add a new country by adding one entry there, not by editing modules.

## Current state in the schema

- `users.mobile_number` (E.164), `users.timezone` (IANA) and `boards.country` exist.
- `student_profiles.country` defaults to `IN` and is meant to be derived from the mobile country code until the UI collects it.
- `policy_documents` has **no country** yet. Country-specific consent and policies (LMS-98) need a `country` column and a unique `(type, country, version)` with a migration.

## Open decisions

| Decision                                                                                                                    | Needed for     |
| --------------------------------------------------------------------------------------------------------------------------- | -------------- |
| How the student's country is captured at registration: derived from the mobile number's country code, or chosen in the form | LMS-99         |
| The UAE age below which guardian consent is required, and the UAE consent requirements under PDPL                           | LMS-98, LMS-99 |
| Whether separate UAE policy documents are required at launch                                                                | LMS-98         |
| Tax treatment for each country                                                                                              | Payments (M10) |
