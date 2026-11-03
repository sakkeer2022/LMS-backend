# Amentorz Database — Schema Data Dictionary

**Document Version:** 1.1  
**Date:** October 27, 2026 (1.1: student onboarding UI alignment, migration `20261027090000_student_onboarding`)  
**Implementation Stage:** Post-Gate 4 Baseline (Sprint 1 Foundation)  
**Database System:** PostgreSQL 16  
**ORM:** Prisma v7.8.0  
**Scope:** Complete technical reference of all 33 deployed database tables, fields, constraints, defaults, and enforcement mechanisms.

---

## Table of Contents

1. [Enums Dictionary](#1-enums-dictionary)
2. [Domain 1: Identity, Auth & RBAC](#2-domain-1-identity-auth--rbac)
   - [users](#21-users)
   - [roles](#22-roles)
   - [permissions](#23-permissions)
   - [user_roles](#24-user_roles)
   - [role_permissions](#25-role_permissions)
   - [refresh_tokens](#26-refresh_tokens)
   - [email_challenges](#27-email_challenges)
   - [password_reset_grants](#28-password_reset_grants)
3. [Domain 2: Student Domain](#3-domain-2-student-domain)
   - [student_profiles](#31-student_profiles)
   - [student_subjects](#32-student_subjects)
   - [teaching_languages](#33-teaching_languages)
   - [policy_documents](#34-policy_documents)
   - [policy_acceptances](#35-policy_acceptances)
   - [guardian_consents](#36-guardian_consents)
4. [Domain 3: Faculty Domain](#4-domain-3-faculty-domain)
   - [faculty_profiles](#41-faculty_profiles)
   - [faculty_qualifications](#42-faculty_qualifications)
   - [faculty_experiences](#43-faculty_experiences)
   - [faculty_documents](#44-faculty_documents)
   - [faculty_terms](#45-faculty_terms)
   - [faculty_terms_acceptances](#46-faculty_terms_acceptances)
5. [Domain 4: Catalogue & Pricing](#5-domain-4-catalogue--pricing)
   - [categories](#51-categories)
   - [boards](#52-boards)
   - [subjects](#53-subjects)
   - [levels](#54-levels)
   - [curricula](#55-curricula)
   - [faculty_assignments](#56-faculty_assignments)
   - [price_rules](#57-price_rules)
6. [Domain 5: Library & Moderation](#6-domain-5-library--moderation)
   - [library_materials](#61-library_materials)
   - [library_reviews](#62-library_reviews)
7. [Domain 6: Platform Governance & System](#7-domain-6-platform-governance--system)
   - [audit_logs](#71-audit_logs)
   - [system_settings](#72-system_settings)
   - [feature_flags](#73-feature_flags)
   - [notifications](#74-notifications)

---

## 1. Enums Dictionary

| Enum Name | Values | Business Context & Usage |
|---|---|---|
| `UserStatus` | `ACTIVE`, `INACTIVE`, `SUSPENDED`, `PENDING_ACTIVATION` | Master lifecycle state of platform users across all three portals. |
| `ChallengePurpose` | `REGISTRATION`, `PASSWORD_RECOVERY`, `ACCOUNT_ACTIVATION` | Validates intention of short-lived OTP challenges. |
| `FacultyApprovalStatus` | `PENDING`, `APPROVED`, `REJECTED`, `CHANGES_REQUESTED` | Governs administrative screening and onboarding lifecycle of tutors. |
| `FacultyDocumentType` | `GOVERNMENT_ID`, `DEGREE_CERTIFICATE`, `EXPERIENCE_LETTER`, `BACKGROUND_CHECK`, `OTHER` | Classifies private verification evidence submitted during tutor screening. |
| `DocumentScanStatus` | `PENDING`, `CLEAN`, `INFECTED`, `FAILED` | Antivirus / quarantine status of private uploaded documents. |
| `LibraryMaterialKind` | `DOCUMENT`, `LINK` | Identifies whether a library resource is a binary uploaded file or external HTTPS link. |
| `LibraryMaterialAudience` | `STUDENT`, `FACULTY`, `ALL` | Access control target for published study resources. |
| `LibraryModerationStatus` | `PENDING`, `APPROVED`, `REJECTED`, `WITHDRAWN` | State machine governing administrative review of study resources. |
| `GuardianRelationship` | `FATHER`, `MOTHER`, `LEGAL_GUARDIAN`, `GRANDPARENT`, `SIBLING`, `OTHER` | Onboarding step 3 relationship dropdown. Final option list pending from the UI owner. |
| `PolicyType` | `TERMS_OF_USE`, `PRIVACY_POLICY`, `CHILD_SAFETY_POLICY`, `STUDENT_TERMS` | Client-supplied legal texts accepted in onboarding step 4 and signed in the consent modal. SOW A1.8 also lists a data protection policy and a refund and cancellation policy; adding them is pending (`docs/PENDING_DECISIONS.md`). |
| `SignatureMode` | `DRAW`, `TYPE` | How the guardian signed the Student Terms (canvas drawing or typed name). |

---

## 2. Domain 1: Identity, Auth & RBAC

### 2.1 `users`
- **Purpose:** Primary identity table representing students, tutors, and administrators.
- **Physical Table:** `users`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `email` | `VARCHAR(255)` | No | — | Unique normalized lowercase email address | Database (`users_email_key`) |
| `password_hash` | `VARCHAR(255)` | No | — | Bcrypt hashed password | Application |
| `full_name` | `VARCHAR(150)` | No | — | Single full-name field (onboarding step 1); replaced `first_name`/`last_name` for every role | Application |
| `mobile_number` | `VARCHAR(16)` | Yes | `NULL` | E.164 mobile number; required for students by the API, not OTP-verified, not unique | Application |
| `timezone` | `VARCHAR(64)` | Yes | `NULL` | IANA time zone captured from the browser at registration | Application |
| `is_active` | `BOOLEAN` | No | `true` | Backwards-compatibility active flag | Database |
| `status` | `UserStatus` | No | `ACTIVE` | Master account status | Database |
| `email_verified_at` | `TIMESTAMP(3)` | Yes | `NULL` | Timestamp when email was verified via OTP | Application |
| `security_version` | `INTEGER` | No | `1` | Token family revocation counter | Application |
| `failed_login_attempts` | `INTEGER` | No | `0` | Lockout threshold counter | Application |
| `locked_until` | `TIMESTAMP(3)` | Yes | `NULL` | Lockout expiry time | Application |
| `last_login_at` | `TIMESTAMP(3)` | Yes | `NULL` | Most recent login timestamp | Application |
| `last_login_ip` | `VARCHAR(45)` | Yes | `NULL` | IPv4/IPv6 login address | Application |
| `last_login_country` | `VARCHAR(2)` | Yes | `NULL` | ISO country code from GeoIP lookup | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Account creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Auto-updating row modification timestamp | Prisma / Database |
| `deleted_at` | `TIMESTAMP(3)` | Yes | `NULL` | Soft delete marker | Application |

- **Indexes & Constraints:**
  - `users_pkey` (PRIMARY KEY, `id`)
  - `users_email_key` (UNIQUE, `email`)

---

### 2.2 `roles`
- **Purpose:** Role hierarchy definition (e.g. `super_admin`, `admin`, `faculty`, `student`).
- **Physical Table:** `roles`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `name` | `VARCHAR(100)` | No | — | Unique role identifier | Database (`roles_name_key`) |
| `description` | `TEXT` | Yes | `NULL` | Role purpose description | Application |
| `is_system` | `BOOLEAN` | No | `false` | System role flag preventing deletion | Application |
| `is_active` | `BOOLEAN` | No | `true` | Role activation flag | Database |
| `parent_id` | `UUID` | Yes | `NULL` | Self-referencing role inheritance FK | Database (`roles_parent_id_fkey`) |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |
| `deleted_at` | `TIMESTAMP(3)` | Yes | `NULL` | Soft delete timestamp | Application |

- **Indexes & Constraints:**
  - `roles_pkey` (PRIMARY KEY, `id`)
  - `roles_name_key` (UNIQUE, `name`)
  - `roles_parent_id_fkey` (FOREIGN KEY, `parent_id` → `roles.id`, ON DELETE SET NULL)

---

### 2.3 `permissions`
- **Purpose:** Atomic system permissions structured as `resource:action` (e.g. `faculty:approve`).
- **Physical Table:** `permissions`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `name` | `VARCHAR(150)` | No | — | Unique permission string (`resource:action`) | Database (`permissions_name_key`) |
| `resource` | `VARCHAR(100)` | No | — | Target entity domain | Application |
| `action` | `VARCHAR(50)` | No | — | Allowed action (`create`, `read`, `update`, `delete`, `manage`) | Application |
| `description` | `TEXT` | Yes | `NULL` | Human readable explanation | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `permissions_pkey` (PRIMARY KEY, `id`)
  - `permissions_name_key` (UNIQUE, `name`)

---

### 2.4 `user_roles`
- **Purpose:** Junction table mapping users to assigned roles with assigner tracking.
- **Physical Table:** `user_roles`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `user_id` | `UUID` | No | — | Foreign Key to `users` | Database (`user_roles_user_id_fkey`) |
| `role_id` | `UUID` | No | — | Foreign Key to `roles` | Database (`user_roles_role_id_fkey`) |
| `assigned_by` | `UUID` | Yes | `NULL` | Foreign Key to `users` (admin who assigned) | Database (`user_roles_assigned_by_fkey`) |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Assignment timestamp | Database |

- **Indexes & Constraints:**
  - `user_roles_pkey` (COMPOSITE PRIMARY KEY, `[user_id, role_id]`)
  - `user_roles_user_id_fkey` (FOREIGN KEY, `user_id` → `users.id`, ON DELETE CASCADE)
  - `user_roles_role_id_fkey` (FOREIGN KEY, `role_id` → `roles.id`, ON DELETE CASCADE)
  - `user_roles_assigned_by_fkey` (FOREIGN KEY, `assigned_by` → `users.id`, ON DELETE SET NULL)

---

### 2.5 `role_permissions`
- **Purpose:** Junction table mapping roles to permissions with optional ABAC conditions.
- **Physical Table:** `role_permissions`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `role_id` | `UUID` | No | — | Foreign Key to `roles` | Database (`role_permissions_role_id_fkey`) |
| `permission_id` | `UUID` | No | — | Foreign Key to `permissions` | Database (`role_permissions_permission_id_fkey`) |
| `conditions` | `JSON` | Yes | `NULL` | ABAC rule conditions | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |

- **Indexes & Constraints:**
  - `role_permissions_pkey` (COMPOSITE PRIMARY KEY, `[role_id, permission_id]`)
  - `role_permissions_role_id_fkey` (FOREIGN KEY, `role_id` → `roles.id`, ON DELETE CASCADE)
  - `role_permissions_permission_id_fkey` (FOREIGN KEY, `permission_id` → `permissions.id`, ON DELETE CASCADE)

---

### 2.6 `refresh_tokens`
- **Purpose:** Persisted cryptographic session families and refresh tokens.
- **Physical Table:** `refresh_tokens`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `user_id` | `UUID` | No | — | Foreign Key to `users` | Database (`refresh_tokens_user_id_fkey`) |
| `token_hash` | `VARCHAR(64)` | No | — | SHA-256 hash of refresh token | Application |
| `jti` | `VARCHAR(100)` | Yes | `NULL` | Unique session identifier | Database (`refresh_tokens_jti_key`) |
| `used` | `BOOLEAN` | No | `false` | Consumption status (detects replay attacks) | Application |
| `portal` | `VARCHAR(20)` | Yes | `NULL` | Origin portal (`student`, `faculty`, `admin`) | Application |
| `family_id` | `VARCHAR(100)` | Yes | `NULL` | Token family chain ID | Application |
| `reauthenticated_at` | `TIMESTAMP(3)` | Yes | `NULL` | Step-up reauthentication timestamp | Application |
| `revoked_at` | `TIMESTAMP(3)` | Yes | `NULL` | Explicit logout/revocation timestamp | Application |
| `ip_address` | `VARCHAR(45)` | Yes | `NULL` | Client IP | Application |
| `user_agent` | `TEXT` | Yes | `NULL` | Client User-Agent | Application |
| `device_fingerprint`| `VARCHAR(64)` | Yes | `NULL` | Client device signature | Application |
| `expires_at` | `TIMESTAMP(3)` | No | — | Session absolute expiration timestamp | Database / Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Issuance timestamp | Database |

- **Indexes & Constraints:**
  - `refresh_tokens_pkey` (PRIMARY KEY, `id`)
  - `refresh_tokens_jti_key` (UNIQUE, `jti`)
  - `refresh_tokens_user_id_used_idx` (INDEX, `[user_id, used]`)
  - `refresh_tokens_family_id_idx` (INDEX, `[family_id]`)
  - `refresh_tokens_user_id_fkey` (FOREIGN KEY, `user_id` → `users.id`, ON DELETE CASCADE)

---

### 2.7 `email_challenges`
- **Purpose:** Stores hashed OTP challenges for registration, login verification, and recovery.
- **Physical Table:** `email_challenges`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `user_id` | `UUID` | Yes | `NULL` | Optional FK to `users` (null for unverified emails) | Database (`email_challenges_user_id_fkey`) |
| `email` | `VARCHAR(255)` | No | — | Recipient email address | Application |
| `otp_hash` | `VARCHAR(64)` | No | — | SHA-256 hash of OTP code | Application |
| `purpose` | `ChallengePurpose` | No | — | Purpose of challenge | Database |
| `attempts_remaining` | `INTEGER` | No | `3` | Countdown of allowable incorrect attempts | Application |
| `expires_at` | `TIMESTAMP(3)` | No | — | Challenge expiration timestamp (e.g. 10m) | Database / Application |
| `consumed_at` | `TIMESTAMP(3)` | Yes | `NULL` | Verification timestamp (atomic one-time use) | Application |
| `resend_cooldown_until` | `TIMESTAMP(3)` | No | — | Throttling timestamp preventing rapid resends | Application |
| `registration_token_hash` | `VARCHAR(64)` | Yes | `NULL` | SHA-256 of the single-use registration token issued when a pre-account `REGISTRATION` OTP is verified | Database (`email_challenges_registration_token_hash_key`) |
| `registration_token_expires_at` | `TIMESTAMP(3)` | Yes | `NULL` | Registration token expiry | Application |
| `registration_token_consumed_at` | `TIMESTAMP(3)` | Yes | `NULL` | Set when `POST /auth/register` consumes the token | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Challenge generation timestamp | Database |

- **Indexes & Constraints:**
  - `email_challenges_pkey` (PRIMARY KEY, `id`)
  - `email_challenges_registration_token_hash_key` (UNIQUE, `registration_token_hash`)
  - `email_challenges_email_purpose_idx` (INDEX, `[email, purpose]`)
  - `email_challenges_expires_at_idx` (INDEX, `[expires_at]`)
  - `email_challenges_user_id_fkey` (FOREIGN KEY, `user_id` → `users.id`, ON DELETE CASCADE)

---

### 2.8 `password_reset_grants`
- **Purpose:** One-time reset tokens granted strictly after successful recovery OTP verification.
- **Physical Table:** `password_reset_grants`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `user_id` | `UUID` | No | — | Foreign Key to `users` | Database (`password_reset_grants_user_id_fkey`) |
| `grant_hash` | `VARCHAR(64)` | No | — | Unique SHA-256 hash of reset grant | Database (`password_reset_grants_grant_hash_key`) |
| `expires_at` | `TIMESTAMP(3)` | No | — | Expiration timestamp (short-lived, 5m) | Application |
| `consumed_at` | `TIMESTAMP(3)` | Yes | `NULL` | Atomic consumption timestamp | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Grant timestamp | Database |

- **Indexes & Constraints:**
  - `password_reset_grants_pkey` (PRIMARY KEY, `id`)
  - `password_reset_grants_grant_hash_key` (UNIQUE, `grant_hash`)
  - `password_reset_grants_user_id_idx` (INDEX, `[user_id]`)
  - `password_reset_grants_expires_at_idx` (INDEX, `[expires_at]`)
  - `password_reset_grants_user_id_fkey` (FOREIGN KEY, `user_id` → `users.id`, ON DELETE CASCADE)

---

## 3. Domain 2: Student Domain

### 3.1 `student_profiles`
- **Purpose:** Student onboarding steps 1–3: date of birth, learning profile and guardian contact. Minor status is always computed from `date_of_birth`; no stored flag. The guardian is a contact only, not an account (SOW).
- **Physical Table:** `student_profiles`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `user_id` | `UUID` | No | — | 1:1 Unique Foreign Key to `users` | Database (`student_profiles_user_id_key`) |
| `date_of_birth` | `DATE` | No | — | Student date of birth (step 1) | Database |
| `category_id` | `UUID` | No | — | Learning category (step 2) | Database (FK → `categories`) |
| `board_id` | `UUID` | Yes | `NULL` | Board; required only when the category `requires_board` (School) | Database (FK → `boards`) / Application |
| `level_id` | `UUID` | No | — | Class level (step 2) | Database (FK → `levels`) |
| `teaching_language_id` | `UUID` | No | — | Preferred teaching language (step 2) | Database (FK → `teaching_languages`) |
| `guardian_name` | `VARCHAR(150)` | Yes | `NULL` | Guardian full name; required under 18 | Application |
| `guardian_relationship` | `GuardianRelationship` | Yes | `NULL` | Guardian relationship; required under 18 | Database / Application |
| `guardian_mobile_number` | `VARCHAR(16)` | Yes | `NULL` | Guardian E.164 mobile; required under 18 | Application |
| `guardian_email` | `VARCHAR(255)` | Yes | `NULL` | Guardian email; required under 18, must differ from the student email | Application |
| `guardian_receives_reports` | `BOOLEAN` | No | `false` | "Also send progress reports and payment receipts to the guardian" | Database |
| `country` | `VARCHAR(2)` | No | `'IN'` | ISO country for revenue reports; derived from the mobile number's country code for now (decided 2026-10-29), IP-based or form capture may follow. The SOW also reports by region, which is not stored yet (`src/docs/REGIONS.md`) | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Profile creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Removed in 1.1:** `is_under_18`, `guardian_phone` (renamed `guardian_mobile_number`), `guardian_consent_signed`, `guardian_consent_document`, `guardian_consent_signed_at` (moved to `guardian_consents`), `grade_level` (replaced by `level_id`), `school_name`, `city`, `state` (not collected by the UI).
- **Indexes & Constraints:**
  - `student_profiles_pkey` (PRIMARY KEY, `id`)
  - `student_profiles_user_id_key` (UNIQUE, `user_id`)
  - `student_profiles_category_id_board_id_level_id_idx` (INDEX, `[category_id, board_id, level_id]`)
  - `student_profiles_user_id_fkey` (FOREIGN KEY, `user_id` → `users.id`, ON DELETE CASCADE)
  - `category_id`, `board_id`, `level_id`, `teaching_language_id` foreign keys, ON DELETE RESTRICT

---

### 3.2 `student_subjects`
- **Purpose:** Step 2 subject multi-select. Each row points to a curriculum (one subject within a category/board/level), so a selection is valid for the profile's combination; the service checks the curriculum matches the profile.
- **Physical Table:** `student_subjects`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `student_id` | `UUID` | No | — | FK to `student_profiles` | Database |
| `curriculum_id` | `UUID` | No | — | FK to `curricula` | Database |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Selection timestamp | Database |

- **Indexes & Constraints:**
  - `student_subjects_pkey` (PRIMARY KEY, `[student_id, curriculum_id]`)
  - `student_subjects_curriculum_id_idx` (INDEX, `[curriculum_id]`)
  - `student_id` → `student_profiles.id` ON DELETE CASCADE; `curriculum_id` → `curricula.id` ON DELETE RESTRICT

---

### 3.3 `teaching_languages`
- **Purpose:** Admin-managed options for step 2 "Preferred teaching language" (e.g. "English & Hindi"). `language_codes` also backs faculty search by language (SOW).
- **Physical Table:** `teaching_languages`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `code` | `VARCHAR(50)` | No | — | Unique code | Database (`teaching_languages_code_key`) |
| `name` | `VARCHAR(100)` | No | — | Display label | Application |
| `language_codes` | `VARCHAR(8)[]` | — | — | ISO 639 codes covered, e.g. `{en,hi}` | Application |
| `is_active` | `BOOLEAN` | No | `true` | Archive flag | Database |
| `display_order` | `INTEGER` | No | `0` | Dropdown order | Database |
| `created_at` / `updated_at` | `TIMESTAMP(3)` | No | — | Timestamps | Database / Prisma |

---

### 3.4 `policy_documents`
- **Purpose:** Versioned client-supplied legal texts (Terms of Use, Privacy Policy, Child Safety Policy, Student Terms) with the blank PDF used for preview and signing. One current version per type, enforced by the service.
- **Physical Table:** `policy_documents`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `type` | `PolicyType` | No | — | Policy type | Database |
| `version` | `VARCHAR(20)` | No | — | Version label, e.g. `1.0` | Database (unique with `type`) |
| `title` | `VARCHAR(200)` | No | — | Display title | Application |
| `effective_at` | `TIMESTAMP(3)` | No | — | Effective date shown in the modal | Application |
| `storage_key` | `VARCHAR(255)` | No | — | Private storage key of the PDF | Database (unique) |
| `sha256` | `VARCHAR(64)` | No | — | SHA-256 of the PDF bytes | Application |
| `is_current` | `BOOLEAN` | No | `false` | Current version flag | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Upload timestamp | Database |

- **Indexes & Constraints:** `policy_documents_type_version_key` (UNIQUE, `[type, version]`), `policy_documents_storage_key_key` (UNIQUE), `policy_documents_type_is_current_idx` (INDEX).
- **Note:** overlaps `faculty_terms`; merging the two is follow-up work.

---

### 3.5 `policy_acceptances`
- **Purpose:** Step 4 checkbox acceptances, one row per user and policy version.
- **Physical Table:** `policy_acceptances`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `user_id` | `UUID` | No | — | FK to `users`, ON DELETE CASCADE | Database |
| `policy_id` | `UUID` | No | — | FK to `policy_documents`, ON DELETE RESTRICT | Database |
| `ip_address` | `VARCHAR(45)` | Yes | `NULL` | Client IP at acceptance | Application |
| `user_agent` | `TEXT` | Yes | `NULL` | Browser user agent | Application |
| `accepted_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Server acceptance time (UTC) | Database |

- **Indexes & Constraints:** `policy_acceptances_user_id_policy_id_key` (UNIQUE, `[user_id, policy_id]`).

---

### 3.6 `guardian_consents`
- **Purpose:** Parent/guardian signature on the Student Terms, made in the date-of-birth popup **before the account exists**. Signing stores the flattened signed PDF and returns a single-use consent token (only its hash is stored). `POST /auth/register` links the row to the profile. Unlinked rows past `expires_at` are purged together with their PDFs. Not a cryptographic or identity-verified signature (project plan R4 accepted on 2026-10-29; written acceptance to be filed).
- **Physical Table:** `guardian_consents`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `student_id` | `UUID` | Yes | `NULL` | FK to `student_profiles`; null until registration links it | Database |
| `policy_id` | `UUID` | No | — | Student Terms version signed | Database (FK → `policy_documents`) |
| `token_hash` | `VARCHAR(64)` | No | — | SHA-256 of the consent token | Database (unique) |
| `student_full_name` | `VARCHAR(150)` | No | — | Step 1 name signed for; registration must match | Application |
| `student_date_of_birth` | `DATE` | No | — | Step 1 date of birth signed for; registration must match | Application |
| `signature_mode` | `SignatureMode` | No | — | Draw or type | Database |
| `typed_name` | `VARCHAR(150)` | Yes | `NULL` | Typed signature text (type mode) | Application |
| `signed_pdf_storage_key` | `VARCHAR(255)` | No | — | Private storage key of the signed PDF; new object per signing | Database (unique) |
| `signed_pdf_sha256` | `VARCHAR(64)` | No | — | SHA-256 of the signed PDF (tamper evidence) | Application |
| `ip_address` | `VARCHAR(45)` | No | — | Client IP from trusted proxy configuration | Application |
| `user_agent` | `TEXT` | Yes | `NULL` | Browser user agent | Application |
| `signed_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Signing time (UTC) | Database |
| `expires_at` | `TIMESTAMP(3)` | No | — | Deadline to link before purge | Application |
| `linked_at` | `TIMESTAMP(3)` | Yes | `NULL` | When registration linked the consent | Application |
| `guardian_name` | `VARCHAR(150)` | Yes | `NULL` | Copied from step 3 at linking | Application |
| `guardian_relationship` | `GuardianRelationship` | Yes | `NULL` | Copied from step 3 at linking | Application |

- **Indexes & Constraints:**
  - `guardian_consents_token_hash_key`, `guardian_consents_signed_pdf_storage_key_key` (UNIQUE)
  - `guardian_consents_student_id_policy_id_key` (UNIQUE, `[student_id, policy_id]`): one linked consent per student and version, so re-signing returns 409
  - `guardian_consents_expires_at_linked_at_idx` (INDEX, cleanup job)
  - `student_id` → `student_profiles.id` ON DELETE CASCADE; `policy_id` → `policy_documents.id` ON DELETE RESTRICT

---

## 4. Domain 3: Faculty Domain

### 4.1 `faculty_profiles`
- **Purpose:** Onboarded tutor profiles, administrative approval, ratings, and public visibility.
- **Physical Table:** `faculty_profiles`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `user_id` | `UUID` | No | — | 1:1 Unique Foreign Key to `users` | Database (`faculty_profiles_user_id_key`) |
| `headline` | `VARCHAR(200)` | Yes | `NULL` | Professional headline | Application |
| `bio` | `TEXT` | Yes | `NULL` | Tutor biography | Application |
| `experience_years` | `DECIMAL(4,1)` | Yes | `NULL` | Years of teaching experience | Application |
| `primary_subject` | `VARCHAR(100)` | Yes | `NULL` | Main teaching subject | Application |
| `approval_status` | `FacultyApprovalStatus` | No | `PENDING` | Screening status | Database |
| `is_published` | `BOOLEAN` | No | `false` | Public discovery visibility flag | Database |
| `is_active` | `BOOLEAN` | No | `true` | Account operational flag | Database |
| `rejection_reason` | `TEXT` | Yes | `NULL` | Administrative rejection comments | Application |
| `approved_at` | `TIMESTAMP(3)` | Yes | `NULL` | Approval timestamp | Application |
| `approved_by` | `UUID` | Yes | `NULL` | Foreign Key to `users` (admin approver) | Database (`faculty_profiles_approved_by_fkey`) |
| `revision` | `INTEGER` | No | `1` | Optimistic locking revision counter | Application |
| `ratings_average` | `DECIMAL(3,2)` | No | `0.00` | Aggregate tutor rating (0.00–5.00) | Database |
| `ratings_count` | `INTEGER` | No | `0` | Count of published student reviews | Database |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `faculty_profiles_pkey` (PRIMARY KEY, `id`)
  - `faculty_profiles_user_id_key` (UNIQUE, `user_id`)
  - `faculty_profiles_approval_status_is_published_is_active_idx` (INDEX, `[approval_status, is_published, is_active]`)
  - `faculty_profiles_user_id_fkey` (FOREIGN KEY, `user_id` → `users.id`, ON DELETE CASCADE)
  - `faculty_profiles_approved_by_fkey` (FOREIGN KEY, `approved_by` → `users.id`, ON DELETE SET NULL)

---

### 4.2 `faculty_qualifications`
- **Purpose:** Academic degrees and certifications submitted by tutors.
- **Physical Table:** `faculty_qualifications`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `faculty_id` | `UUID` | No | — | Foreign Key to `faculty_profiles` | Database (`faculty_qualifications_faculty_id_fkey`) |
| `degree` | `VARCHAR(150)` | No | — | Degree title (e.g. 'B.Sc. Mathematics') | Application |
| `field_of_study` | `VARCHAR(150)` | No | — | Major / Specialization | Application |
| `institution` | `VARCHAR(200)` | No | — | University or college name | Application |
| `year_of_passing` | `INTEGER` | No | — | Graduation year | Application |
| `is_verified` | `BOOLEAN` | No | `false` | Administrative verification status | Database |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `faculty_qualifications_pkey` (PRIMARY KEY, `id`)
  - `faculty_qualifications_faculty_id_idx` (INDEX, `faculty_id`)
  - `faculty_qualifications_faculty_id_fkey` (FOREIGN KEY, `faculty_id` → `faculty_profiles.id`, ON DELETE CASCADE)

---

### 4.3 `faculty_experiences`
- **Purpose:** Past teaching and professional work history.
- **Physical Table:** `faculty_experiences`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `faculty_id` | `UUID` | No | — | Foreign Key to `faculty_profiles` | Database (`faculty_experiences_faculty_id_fkey`) |
| `organization` | `VARCHAR(200)` | No | — | School / Institute / Company | Application |
| `designation` | `VARCHAR(150)` | No | — | Role title | Application |
| `start_year` | `INTEGER` | No | — | Start year | Application |
| `end_year` | `INTEGER` | Yes | `NULL` | End year (null if current) | Application |
| `is_current` | `BOOLEAN` | No | `false` | Flag indicating current position | Application |
| `description` | `TEXT` | Yes | `NULL` | Roles and responsibilities | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `faculty_experiences_pkey` (PRIMARY KEY, `id`)
  - `faculty_experiences_faculty_id_idx` (INDEX, `faculty_id`)
  - `faculty_experiences_faculty_id_fkey` (FOREIGN KEY, `faculty_id` → `faculty_profiles.id`, ON DELETE CASCADE)

---

### 4.4 `faculty_documents`
- **Purpose:** Private verification files (IDs, degrees, background checks) with quarantine scan status.
- **Physical Table:** `faculty_documents`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `faculty_id` | `UUID` | No | — | Foreign Key to `faculty_profiles` | Database (`faculty_documents_faculty_id_fkey`) |
| `document_type` | `FacultyDocumentType` | No | — | Classification of document | Database |
| `original_file_name`| `VARCHAR(255)` | No | — | Client uploaded file name | Application |
| `file_size` | `INTEGER` | No | — | Size in bytes | Application |
| `mime_type` | `VARCHAR(100)` | No | — | Validated MIME type | Application |
| `storage_key` | `VARCHAR(255)` | No | — | Unique private storage key | Database (`faculty_documents_storage_key_key`) |
| `scan_status` | `DocumentScanStatus` | No | `PENDING` | Quarantine antivirus status | Database |
| `scan_result` | `TEXT` | Yes | `NULL` | Antivirus scanner output | Application |
| `is_verified` | `BOOLEAN` | No | `false` | Admin verification status | Database |
| `verified_at` | `TIMESTAMP(3)` | Yes | `NULL` | Verification timestamp | Application |
| `verified_by` | `UUID` | Yes | `NULL` | Foreign Key to `users` (admin verifier) | Database (`faculty_documents_verified_by_fkey`) |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `faculty_documents_pkey` (PRIMARY KEY, `id`)
  - `faculty_documents_storage_key_key` (UNIQUE, `storage_key`)
  - `faculty_documents_faculty_id_idx` (INDEX, `faculty_id`)
  - `faculty_documents_scan_status_idx` (INDEX, `scan_status`)
  - `faculty_documents_faculty_id_fkey` (FOREIGN KEY, `faculty_id` → `faculty_profiles.id`, ON DELETE CASCADE)
  - `faculty_documents_verified_by_fkey` (FOREIGN KEY, `verified_by` → `users.id`, ON DELETE SET NULL)

---

### 4.5 `faculty_terms`
- **Purpose:** Immutable legal agreement versions that tutors must accept.
- **Physical Table:** `faculty_terms`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `version` | `VARCHAR(20)` | No | — | Unique terms version string (e.g. 'v1.0') | Database (`faculty_terms_version_key`) |
| `title` | `VARCHAR(200)` | No | — | Agreement title | Application |
| `content` | `TEXT` | No | — | Legal agreement text | Application |
| `effective_at` | `TIMESTAMP(3)` | No | — | Date when version becomes legally active | Database / Application |
| `is_current` | `BOOLEAN` | No | `false` | Indicates active governing version | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |

- **Indexes & Constraints:**
  - `faculty_terms_pkey` (PRIMARY KEY, `id`)
  - `faculty_terms_version_key` (UNIQUE, `version`)

---

### 4.6 `faculty_terms_acceptances`
- **Purpose:** Audit record capturing tutor acceptance of terms on first login.
- **Physical Table:** `faculty_terms_acceptances`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `faculty_id` | `UUID` | No | — | Foreign Key to `faculty_profiles` | Database (`faculty_terms_acceptances_faculty_id_fkey`) |
| `terms_id` | `UUID` | No | — | Foreign Key to `faculty_terms` | Database (`faculty_terms_acceptances_terms_id_fkey`) |
| `terms_version` | `VARCHAR(20)` | No | — | Snapshot of version string at acceptance | Application |
| `ip_address` | `VARCHAR(45)` | Yes | `NULL` | Client IP address at signing | Application |
| `user_agent` | `TEXT` | Yes | `NULL` | Client browser user-agent | Application |
| `accepted_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Exact acceptance timestamp | Database |

- **Indexes & Constraints:**
  - `faculty_terms_acceptances_pkey` (PRIMARY KEY, `id`)
  - `faculty_terms_acceptances_faculty_id_terms_id_key` (UNIQUE, `[faculty_id, terms_id]`)
  - `faculty_terms_acceptances_faculty_id_fkey` (FOREIGN KEY, `faculty_id` → `faculty_profiles.id`, ON DELETE CASCADE)
  - `faculty_terms_acceptances_terms_id_fkey` (FOREIGN KEY, `terms_id` → `faculty_terms.id`, ON DELETE RESTRICT)

---

### 4.7 `faculty_invitations`
- **Purpose:** Admin invitations to join as a tutor (LMS-79). The user and faculty profile are created when the invitee completes onboarding.
- **Physical Table:** `faculty_invitations`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `email` | `VARCHAR(255)` | No | — | Invitee email, trimmed and lowercased | Database (`faculty_invitations_email_normalized_check`) |
| `token_hash` | `VARCHAR(64)` | No | — | SHA-256 hex of the single-use token; the token itself is never stored | Database (unique, hex CHECK) |
| `status` | `FacultyInvitationStatus` | No | `PENDING` | PENDING, ACCEPTED, REVOKED, EXPIRED | Database |
| `delivery_method` | `FacultyInvitationDelivery` | No | `EMAIL` | EMAIL (sent) or LINK (Copy link) | Database |
| `sent_at` | `TIMESTAMP(3)` | Yes | `NULL` | When the provider accepted the email | Application |
| `expires_at` | `TIMESTAMP(3)` | No | — | Creation + `FACULTY_INVITE_TTL_HOURS` | Database (`faculty_invitations_expiry_check`) |
| `accepted_at` | `TIMESTAMP(3)` | Yes | `NULL` | Set when onboarding completes (LMS-81) | Application |
| `revoked_at` | `TIMESTAMP(3)` | Yes | `NULL` | Revocation time | Application |
| `revoked_reason` | `VARCHAR(50)` | Yes | `NULL` | e.g. `DELIVERY_FAILED` | Application |
| `delivery_error` | `VARCHAR(255)` | Yes | `NULL` | Provider error summary, no secrets | Application |
| `invited_by_id` | `UUID` | Yes | `NULL` | Foreign Key to `users` (inviting admin) | Database (`faculty_invitations_invited_by_id_fkey`, ON DELETE SET NULL) |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `faculty_invitations_token_hash_key` (UNIQUE, `token_hash`)
  - `faculty_invitations_one_pending_per_email` (UNIQUE partial, `email` WHERE `status = 'PENDING'`; hand-written, not in `schema.prisma`)
  - `faculty_invitations_email_status_idx`, `faculty_invitations_status_expires_at_idx` (INDEX)

---

## 5. Domain 4: Catalogue & Pricing

### 5.1 `categories`
- **Purpose:** Top-level learning categories (School, University, JEE/NEET, Research & Skill Learning).
- **Physical Table:** `categories`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `code` | `VARCHAR(50)` | No | — | Unique category code | Database (`categories_code_key`) |
| `name` | `VARCHAR(100)` | No | — | Display title | Application |
| `description` | `TEXT` | Yes | `NULL` | Category overview | Application |
| `requires_board` | `BOOLEAN` | No | `false` | True for School category requiring board | Application |
| `is_active` | `BOOLEAN` | No | `true` | Active flag | Database |
| `display_order` | `INTEGER` | No | `0` | Frontline UI sorting order | Database |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `categories_pkey` (PRIMARY KEY, `id`)
  - `categories_code_key` (UNIQUE, `code`)

---

### 5.2 `boards`
- **Purpose:** Educational boards. The SOW names NCERT, ICSE and State Board; others (for example IB or Cambridge, common in UAE schools) are admin-configured data, not fixed by the schema.
- **Physical Table:** `boards`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `code` | `VARCHAR(50)` | No | — | Unique board code | Database (`boards_code_key`) |
| `name` | `VARCHAR(100)` | No | — | Full board name | Application |
| `country` | `VARCHAR(2)` | No | `'IN'` | ISO country code | Database |
| `state` | `VARCHAR(100)` | Yes | `NULL` | Applicable state for State Boards | Application |
| `is_active` | `BOOLEAN` | No | `true` | Active flag | Database |
| `sort_order` | `INTEGER` | No | `0` | Dropdown order; ties sort by name (LMS-53) | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `boards_pkey` (PRIMARY KEY, `id`)
  - `boards_code_key` (UNIQUE, `code`)

---

### 5.3 `subjects`
- **Purpose:** Subject master table (e.g. Mathematics, Physics, Chemistry, Biology, Computer Science).
- **Physical Table:** `subjects`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `code` | `VARCHAR(50)` | No | — | Unique subject code | Database (`subjects_code_key`) |
| `name` | `VARCHAR(100)` | No | — | Subject title | Application |
| `description` | `TEXT` | Yes | `NULL` | Subject summary | Application |
| `is_active` | `BOOLEAN` | No | `true` | Active flag | Database |
| `sort_order` | `INTEGER` | No | `0` | Dropdown order; ties sort by name (LMS-53) | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `subjects_pkey` (PRIMARY KEY, `id`)
  - `subjects_code_key` (UNIQUE, `code`)

---

### 5.4 `levels`
- **Purpose:** Grade and academic levels (e.g. Class 10, Class 12, Undergraduate, Beginner, Advanced).
- **Physical Table:** `levels`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `code` | `VARCHAR(50)` | No | — | Unique level code | Database (`levels_code_key`) |
| `name` | `VARCHAR(100)` | No | — | Level title | Application |
| `description` | `TEXT` | Yes | `NULL` | Level scope | Application |
| `is_active` | `BOOLEAN` | No | `true` | Active flag | Database |
| `category_id` | `UUID` | Yes | `NULL` | Optional category scope for dropdowns; Foreign Key to `categories` (LMS-53) | Database (`levels_category_id_fkey`) |
| `sort_order` | `INTEGER` | No | `0` | Order within the category, so Class 2 sorts before Class 10 (LMS-53) | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `levels_pkey` (PRIMARY KEY, `id`)
  - `levels_code_key` (UNIQUE, `code`)
  - `levels_category_id_sort_order_idx` (INDEX, `[category_id, sort_order]`)
  - `levels_category_id_fkey` (FOREIGN KEY, `category_id` → `categories.id`, ON DELETE RESTRICT)

---

### 5.5 `curricula`
- **Purpose:** Concrete 4-tuple linking Category, Board, Subject, and Level with syllabus text.
- **Physical Table:** `curricula`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `category_id` | `UUID` | No | — | Foreign Key to `categories` | Database (`curricula_category_id_fkey`) |
| `board_id` | `UUID` | Yes | `NULL` | Foreign Key to `boards` (null for non-school) | Database (`curricula_board_id_fkey`) |
| `subject_id` | `UUID` | No | — | Foreign Key to `subjects` | Database (`curricula_subject_id_fkey`) |
| `level_id` | `UUID` | No | — | Foreign Key to `levels` | Database (`curricula_level_id_fkey`) |
| `syllabus` | `TEXT` | Yes | `NULL` | Syllabus outline text | Application |
| `is_active` | `BOOLEAN` | No | `true` | Active flag | Database |
| `node_id` | `UUID` | Yes | `NULL` | LEVEL leaf in `catalogue_nodes` that owns this offering; tuple columns are copied from its ancestors by the catalogue service (ADR 0003) | Database (`curricula_node_id_key`, `curricula_node_id_fkey`) |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `curricula_pkey` (PRIMARY KEY, `id`)
  - `curricula_category_id_board_id_subject_id_level_id_key` (UNIQUE `NULLS NOT DISTINCT`, `[category_id, board_id, subject_id, level_id]`)
  - `curricula_category_id_fkey` (FOREIGN KEY, `category_id` → `categories.id`, ON DELETE RESTRICT)
  - `curricula_board_id_fkey` (FOREIGN KEY, `board_id` → `boards.id`, ON DELETE RESTRICT)
  - `curricula_subject_id_fkey` (FOREIGN KEY, `subject_id` → `subjects.id`, ON DELETE RESTRICT)
  - `curricula_level_id_fkey` (FOREIGN KEY, `level_id` → `levels.id`, ON DELETE RESTRICT)
  - `curricula_node_id_key` (UNIQUE, `node_id`): one curriculum per leaf
  - `curricula_node_id_fkey` (FOREIGN KEY, `node_id` → `catalogue_nodes.id`, ON DELETE RESTRICT)


---

### 5.5.1 `catalogue_nodes`
- **Purpose:** Categories & Content tree (screen 28): category → subsection → board → subject → level. SUBSECTION and BOARD may be skipped. Each LEVEL leaf owns one `curricula` row. See ADR 0003.
- **Physical Table:** `catalogue_nodes`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `parent_id` | `UUID` | Yes | `NULL` | Parent node; null only for CATEGORY roots | Database (`catalogue_nodes_parent_id_fkey`, `catalogue_nodes_parent_check`) |
| `root_id` | `UUID` | No | — | CATEGORY node this node belongs to; equals `id` for roots; never changes | Database (`catalogue_nodes_root_id_fkey`, `catalogue_nodes_root_check`) |
| `type` | `CatalogueNodeType` | No | — | `CATEGORY`, `SUBSECTION`, `BOARD`, `SUBJECT`, `LEVEL`; a child's type comes after its parent's | Database enum / Application order |
| `name` | `VARCHAR(200)` | No | — | Display name | Application |
| `slug` | `VARCHAR(64)` | No | — | Unique among siblings | Database (`catalogue_nodes_parent_id_slug_key`) |
| `status` | `CatalogueNodeStatus` | No | `DRAFT` | `DRAFT`, `PUBLISHED`, `ARCHIVED`; public reads need the node and every ancestor PUBLISHED | Database enum / Application |
| `sort_order` | `INTEGER` | No | `0` | Order among siblings, ≥ 0 | Database (`catalogue_nodes_sort_order_check`) |
| `category_id` | `UUID` | Yes | `NULL` | Set only on CATEGORY nodes; one node per category | Database (`catalogue_nodes_category_id_key`, `catalogue_nodes_master_ref_check`) |
| `board_id` | `UUID` | Yes | `NULL` | Set only on BOARD nodes | Database (`catalogue_nodes_master_ref_check`) |
| `subject_id` | `UUID` | Yes | `NULL` | Set only on SUBJECT nodes | Database (`catalogue_nodes_master_ref_check`) |
| `level_id` | `UUID` | Yes | `NULL` | Set only on LEVEL nodes | Database (`catalogue_nodes_master_ref_check`) |
| `booking_enabled` | `BOOLEAN` | No | `true` | "Book a session" option; meaningful on CATEGORY nodes | Application |
| `archived_at` | `TIMESTAMP(3)` | Yes | `NULL` | Set when archived; nothing is hard-deleted | Application |
| `created_by_id` | `UUID` | Yes | `NULL` | Acting user; no FK, users are never deleted | Application |
| `updated_by_id` | `UUID` | Yes | `NULL` | Acting user; no FK | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `catalogue_nodes_pkey` (PRIMARY KEY, `id`)
  - `catalogue_nodes_parent_id_slug_key`, `catalogue_nodes_parent_id_board_id_key`, `catalogue_nodes_parent_id_subject_id_key`, `catalogue_nodes_parent_id_level_id_key` (UNIQUE): one node per slug and per master value among siblings
  - `catalogue_nodes_root_id_parent_id_sort_order_idx` (INDEX): loads a whole category in one query
  - `catalogue_nodes_parent_check`, `catalogue_nodes_master_ref_check`, `catalogue_nodes_root_check`, `catalogue_nodes_sort_order_check` (CHECK, hand-written in migration `20261029090000_catalogue_tree`)
  - All foreign keys ON DELETE RESTRICT

---

### 5.6 `faculty_assignments`
- **Purpose:** Authorizes a specific tutor to teach a specific curriculum tuple.
- **Physical Table:** `faculty_assignments`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `faculty_id` | `UUID` | No | — | Foreign Key to `faculty_profiles` | Database (`faculty_assignments_faculty_id_fkey`) |
| `curriculum_id`| `UUID` | No | — | Foreign Key to `curricula` | Database (`faculty_assignments_curriculum_id_fkey`) |
| `is_active` | `BOOLEAN` | No | `true` | Assignment status | Database |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `faculty_assignments_pkey` (PRIMARY KEY, `id`)
  - `faculty_assignments_faculty_id_curriculum_id_key` (UNIQUE, `[faculty_id, curriculum_id]`)
  - `faculty_assignments_faculty_id_fkey` (FOREIGN KEY, `faculty_id` → `faculty_profiles.id`, ON DELETE CASCADE)
  - `faculty_assignments_curriculum_id_fkey` (FOREIGN KEY, `curriculum_id` → `curricula.id`, ON DELETE RESTRICT)

---

### 5.7 `price_rules`
- **Purpose:** Admin-set session price for one offering (curriculum), optionally for one tutor. `faculty_id` null is the default price for the offering. Replaces `session_prices` (ADR 0004). Currency INR and 60-minute sessions are fixed and not stored.
- **Physical Table:** `price_rules`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `curriculum_id` | `UUID` | No | — | Offering priced; Foreign Key to `curricula` | Database (`price_rules_curriculum_id_fkey`) |
| `faculty_id` | `UUID` | Yes | `NULL` | Tutor (`faculty_profiles.id`); null = default price | Database (`price_rules_faculty_id_fkey`) |
| `session_price_paise` | `INTEGER` | No | — | Pre-GST price set by admin; 1 to 100,000,000 | Database (`price_rules_session_price_check`) |
| `gst_rate_bps` | `INTEGER` | No | `1800` | GST rate in basis points (1800 = 18%); 0 to 10000 | Database (`price_rules_gst_rate_check`) |
| `gst_paise` | `INTEGER` | No | — | Server-computed: round_half_up(price × rate / 10000) | Database (`price_rules_amounts_check`) |
| `student_pays_paise` | `INTEGER` | No | — | Server-computed: price + GST | Database (`price_rules_amounts_check`) |
| `effective_from` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Start of the window (inclusive) | Application |
| `effective_to` | `TIMESTAMP(3)` | Yes | `NULL` | End of the window (exclusive); null = open-ended | Database (`price_rules_window_check`) |
| `is_active` | `BOOLEAN` | No | `true` | Inactive rules never resolve and never block others | Application |
| `revision` | `INTEGER` | No | `1` | Optimistic concurrency; writes send `expectedRevision` | Database (`price_rules_revision_check`) / Application |
| `created_by_id` | `UUID` | Yes | `NULL` | Acting user; no FK | Application |
| `updated_by_id` | `UUID` | Yes | `NULL` | Acting user; no FK | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `price_rules_pkey` (PRIMARY KEY, `id`)
  - `price_rules_curriculum_id_faculty_id_is_active_idx` (INDEX): resolution lookups
  - `price_rules_faculty_id_idx` (INDEX)
  - `price_rules_curriculum_id_fkey`, `price_rules_faculty_id_fkey` (FOREIGN KEY, ON DELETE RESTRICT)
  - CHECK constraints listed above (hand-written in migration `20261029100000_price_rules`)
  - At most one active rule per curriculum and tutor for any overlapping window: enforced by the pricing service under a row lock on the curriculum
---

## 6. Domain 5: Library & Moderation

### 6.1 `library_materials`
- **Purpose:** Free study resources (PDFs, docs, worksheets, approved links) with quarantine scanning.
- **Physical Table:** `library_materials`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `title` | `VARCHAR(255)` | No | — | Material title | Application |
| `description` | `TEXT` | Yes | `NULL` | Content description | Application |
| `kind` | `LibraryMaterialKind`| No | — | `DOCUMENT` or `LINK` | Database |
| `audience` | `LibraryMaterialAudience`| No | `STUDENT` | Access audience | Database |
| `status` | `LibraryModerationStatus`| No | `PENDING` | Pre-publication review state | Database |
| `curriculum_id`| `UUID` | Yes | `NULL` | Optional FK to `curricula` | Database (`library_materials_curriculum_id_fkey`) |
| `storage_key` | `VARCHAR(255)` | Yes | `NULL` | S3 / private storage key for binary documents | Application |
| `file_size` | `INTEGER` | Yes | `NULL` | File size in bytes | Application |
| `mime_type` | `VARCHAR(100)` | Yes | `NULL` | Document MIME type | Application |
| `external_url` | `TEXT` | Yes | `NULL` | Target URL for external resource links | Application |
| `scan_status` | `DocumentScanStatus`| No | `PENDING` | Antivirus quarantine status | Database |
| `uploaded_by` | `UUID` | No | — | Foreign Key to `users` (uploader) | Database (`library_materials_uploaded_by_fkey`) |
| `revision` | `INTEGER` | No | `1` | Material edit revision counter | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Upload timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `library_materials_pkey` (PRIMARY KEY, `id`)
  - `library_materials_status_audience_idx` (INDEX, `[status, audience]`)
  - `library_materials_curriculum_id_idx` (INDEX, `curriculum_id`)
  - `library_materials_uploaded_by_fkey` (FOREIGN KEY, `uploaded_by` → `users.id`, ON DELETE RESTRICT)
  - `library_materials_curriculum_id_fkey` (FOREIGN KEY, `curriculum_id` → `curricula.id`, ON DELETE SET NULL)

---

### 6.2 `library_reviews`
- **Purpose:** Immutable administrative moderation actions and approval notes for library materials.
- **Physical Table:** `library_reviews`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `material_id` | `UUID` | No | — | Foreign Key to `library_materials` | Database (`library_reviews_material_id_fkey`) |
| `reviewer_id` | `UUID` | No | — | Foreign Key to `users` (admin moderator) | Database (`library_reviews_reviewer_id_fkey`) |
| `decision` | `LibraryModerationStatus`| No | — | Moderation outcome (`APPROVED`, `REJECTED`) | Database |
| `notes` | `TEXT` | Yes | `NULL` | Moderator commentary | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Decision timestamp | Database |

- **Indexes & Constraints:**
  - `library_reviews_pkey` (PRIMARY KEY, `id`)
  - `library_reviews_material_id_idx` (INDEX, `material_id`)
  - `library_reviews_material_id_fkey` (FOREIGN KEY, `material_id` → `library_materials.id`, ON DELETE CASCADE)
  - `library_reviews_reviewer_id_fkey` (FOREIGN KEY, `reviewer_id` → `users.id`, ON DELETE RESTRICT)

---

## 7. Domain 6: Platform Governance & System

### 7.1 `audit_logs`
- **Purpose:** Cryptographically hashed immutable audit ledger tracking security and domain events.
- **Physical Table:** `audit_logs`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `trace_id` | `VARCHAR(100)` | No | — | Distributed trace correlation ID | Application |
| `correlation_id`| `VARCHAR(100)` | No | — | Request correlation ID | Application |
| `actor_id` | `UUID` | Yes | `NULL` | Foreign Key to `users` (null for unauthenticated) | Database (`audit_logs_actor_id_fkey`) |
| `ip_address` | `VARCHAR(45)` | No | — | Client IP address | Application |
| `user_agent` | `TEXT` | No | — | Client User-Agent | Application |
| `device_fingerprint`| `VARCHAR(64)` | Yes | `NULL` | Device hash | Application |
| `severity` | `VARCHAR(20)` | No | — | Severity (`INFO`, `WARN`, `SECURITY`, `CRITICAL`) | Application |
| `entity` | `VARCHAR(100)` | No | — | Target entity name (e.g. 'user', 'price') | Application |
| `action` | `VARCHAR(100)` | No | — | Action name (e.g. 'update', 'login') | Application |
| `resource_id` | `VARCHAR(100)` | Yes | `NULL` | Identifier of modified record | Application |
| `previous_value`| `JSON` | Yes | `NULL` | Pre-mutation JSON snapshot | Application |
| `new_value` | `JSON` | Yes | `NULL` | Post-mutation JSON snapshot | Application |
| `hash` | `VARCHAR(64)` | No | — | SHA-256 hash of this record | Application |
| `previous_hash`| `VARCHAR(64)` | No | — | SHA-256 hash of preceding record (hash chain) | Application |
| `sequence` | `BIGINT` | No | `nextval('audit_logs_sequence_seq')` | Position in the hash chain. Linking and verification follow `sequence`, never `created_at`; chain writes are serialised with a Postgres advisory lock (LMS-102) | Database + Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Event timestamp | Database |

- **Indexes & Constraints:**
  - `audit_logs_pkey` (PRIMARY KEY, `id`)
  - `audit_logs_actor_id_fkey` (FOREIGN KEY, `actor_id` → `users.id`, ON DELETE SET NULL)
  - `audit_logs_sequence_key` (UNIQUE, `sequence`)

---

### 7.2 `system_settings`
- **Purpose:** Dynamic runtime configuration (e.g. OTP TTLs, session thresholds, fee percentages).
- **Physical Table:** `system_settings`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `key` | `VARCHAR(100)` | No | — | Unique configuration key | Database (`system_settings_key_key`) |
| `value` | `JSONB` | No | — | Typed setting value (JSONB) | Database |
| `description` | `TEXT` | Yes | `NULL` | Setting explanation | Application |
| `revision` | `INTEGER` | No | `1` | Optimistic locking revision counter | Application |
| `updated_by` | `UUID` | Yes | `NULL` | Foreign Key to `users` (admin who updated) | Database (`system_settings_updated_by_fkey`) |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `system_settings_pkey` (PRIMARY KEY, `id`)
  - `system_settings_key_key` (UNIQUE, `key`)
  - `system_settings_updated_by_fkey` (FOREIGN KEY, `updated_by` → `users.id`, ON DELETE SET NULL)

---

### 7.3 `feature_flags`
- **Purpose:** Dynamic runtime feature toggles with percentage rollout and JSON conditions.
- **Physical Table:** `feature_flags`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `name` | `VARCHAR(100)` | No | — | Unique flag name | Database (`feature_flags_name_key`) |
| `description` | `TEXT` | Yes | `NULL` | Flag description | Application |
| `is_enabled` | `BOOLEAN` | No | `false` | Global enable/disable toggle | Database |
| `rollout_percentage`| `INTEGER` | No | `0` | Percentage rollout (0–100) | Database |
| `conditions` | `JSON` | Yes | `NULL` | Targeting rules | Application |
| `created_by` | `UUID` | Yes | `NULL` | Administrator ID who created the flag | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `feature_flags_pkey` (PRIMARY KEY, `id`)
  - `feature_flags_name_key` (UNIQUE, `name`)

---

### 7.4 `notifications`
- **Purpose:** System notification definition placeholder.
- **Physical Table:** `notifications`

| Column | Type | Nullable | Default | Description & Constraints | Enforcement |
|---|---|:---:|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key | Database |
| `name` | `VARCHAR(100)` | No | — | Unique notification identifier | Database (`notifications_name_key`) |
| `description` | `TEXT` | Yes | `NULL` | Notification template description | Application |
| `created_at` | `TIMESTAMP(3)` | No | `CURRENT_TIMESTAMP` | Creation timestamp | Database |
| `updated_at` | `TIMESTAMP(3)` | No | — | Modification timestamp | Prisma / Database |

- **Indexes & Constraints:**
  - `notifications_pkey` (PRIMARY KEY, `id`)
  - `notifications_name_key` (UNIQUE, `name`)
