# Sprint 1 endpoint index

Review draft only. All paths are relative to `/api/v1`. `ready-for-review` is a review status, not evidence of approval or implementation. See [design](sprint-1-contract-review.md) for cross-cutting rules and open decisions.

## Identity

| Method | Path | Operation ID | Access | Review status |
|---|---|---|---|---|
| GET | `/auth/csrf-token` | `getCsrfToken` | public | ready-for-review |
| POST | `/auth/registration/email-otp/requests` | `requestRegistrationEmailOtp` | public | decision-required |
| POST | `/auth/registration/email-otp/verify` | `verifyRegistrationEmailOtp` | public | ready-for-review |
| POST | `/auth/register` | `registerStudent` | public | decision-required |
| POST | `/auth/email-verification/requests` | `requestEmailVerification` | public | ready-for-review |
| POST | `/auth/email-verification/verify` | `verifyEmail` | public | ready-for-review |
| POST | `/auth/student/login` | `loginStudent` | public | ready-for-review |
| POST | `/auth/faculty/login` | `loginFaculty` | public | ready-for-review |
| POST | `/auth/admin/login` | `loginAdmin` | public | ready-for-review |
| POST | `/auth/refresh` | `refreshSession` | refresh | ready-for-review |
| POST | `/auth/logout` | `logoutSession` | public | ready-for-review |
| GET | `/auth/me` | `getCurrentUser` | student, faculty or admin (self only) | ready-for-review |
| POST | `/auth/reauthenticate` | `reauthenticate` | student, faculty or admin (self only) | ready-for-review |
| PUT | `/auth/password` | `changeOwnPassword` | student, faculty or admin (self only) | ready-for-review |
| POST | `/auth/password/requests` | `requestPasswordChangeCode` | student, faculty or admin (self only) | ready-for-review |
| POST | `/auth/recovery/requests` | `requestPasswordRecovery` | public | ready-for-review |
| POST | `/auth/recovery/verify` | `verifyRecoveryOtp` | public | ready-for-review |
| POST | `/auth/recovery/reset` | `resetPassword` | public | ready-for-review |
| GET | `/auth/sessions` | `listOwnSessions` | student, faculty or admin (self only) | ready-for-review |
| DELETE | `/auth/sessions` | `revokeOtherSessions` | student, faculty or admin (self only) | ready-for-review |
| PUT | `/admin/me/profile` | `updateOwnAdminProfile` | admin (self only) | ready-for-review |
| GET | `/admin/me/activity` | `listOwnSecurityActivity` | admin (self only) | ready-for-review |
| DELETE | `/auth/sessions/{jti}` | `revokeOwnSession` | student, faculty or admin (self only) | ready-for-review |

## Consent

| Method | Path | Operation ID | Access | Review status |
|---|---|---|---|---|
| GET | `/policies/current` | `listCurrentPolicies` | public | decision-required |
| GET | `/policies/{policyId}/file` | `getPolicyFile` | public | ready-for-review |
| POST | `/consent/guardian-signatures` | `signGuardianConsent` | public | decision-required |
| GET | `/consent/guardian-signatures/file` | `getPendingGuardianConsentFile` | public | ready-for-review |
| GET | `/students/me/guardian-consent/file` | `getOwnGuardianConsentFile` | student (self only) | ready-for-review |
| GET | `/admin/students/{studentId}/guardian-consent/file` | `getStudentGuardianConsentFileAdmin` | admin; students.read | ready-for-review |

## Faculty

| Method | Path | Operation ID | Access | Review status |
|---|---|---|---|---|
| POST | `/admin/faculty` | `createFaculty` | admin; faculty.create | ready-for-review |
| GET | `/admin/faculty` | `listFacultyAdmin` | admin; faculty.read | ready-for-review |
| GET | `/admin/faculty/status-counts` | `getFacultyStatusCounts` | admin; faculty.read | ready-for-review |
| POST | `/admin/faculty/invitations` | `inviteFaculty` | admin; faculty.create | ready-for-review |
| GET | `/admin/faculty/{facultyId}` | `getFacultyAdmin` | admin; faculty.read | ready-for-review |
| PUT | `/admin/faculty/{facultyId}/profile` | `setFacultyProfileAdmin` | admin; faculty.update | ready-for-review |
| GET | `/faculty/me` | `getOwnFacultyProfile` | faculty (self only) | ready-for-review |
| PUT | `/faculty/me/profile` | `setOwnFacultyProfile` | faculty (self only); faculty.update_self | ready-for-review |
| GET | `/faculty/terms` | `getFacultyTerms` | faculty or admin | decision-required |
| POST | `/faculty/me/terms-acceptance` | `acceptFacultyTerms` | faculty (self only) | decision-required |
| PUT | `/admin/faculty/{facultyId}/review` | `reviewFaculty` | admin; faculty.approve | ready-for-review |
| PUT | `/admin/faculty/{facultyId}/documents/{documentId}/verification` | `setFacultyDocumentVerification` | admin; faculty.approve | ready-for-review |
| PUT | `/admin/faculty/{facultyId}/publication` | `setFacultyPublication` | admin; faculty.publish | ready-for-review |
| PUT | `/admin/faculty/{facultyId}/status` | `setFacultyActiveStatus` | admin; faculty.update | ready-for-review |
| GET | `/admin/faculty/{facultyId}/documents` | `listFacultyDocumentsAdmin` | admin; faculty.documents | ready-for-review |
| POST | `/admin/faculty/{facultyId}/documents` | `uploadFacultyDocument` | admin; faculty.documents | ready-for-review |
| GET | `/admin/faculty/{facultyId}/documents/{documentId}/file` | `getFacultyDocumentFileAdmin` | admin; faculty.documents | ready-for-review |
| GET | `/faculty/me/documents` | `listFacultyDocumentsSelf` | faculty (self only) | ready-for-review |
| GET | `/faculty/me/documents/{documentId}/file` | `getFacultyDocumentFileSelf` | faculty (self only) | ready-for-review |
| GET | `/faculty` | `listPublishedFaculty` | public | ready-for-review |
| GET | `/faculty/{facultyId}` | `getPublishedFaculty` | public | ready-for-review |
| GET | `/faculty/me/price-consent` | `getFacultyPriceConsent` | faculty (self only); faculty.read_self | ready-for-review |
| POST | `/faculty/me/price-consent` | `decideFacultyPriceConsent` | faculty (self only); faculty.update_self | ready-for-review |

## Faculty onboarding

| Method | Path | Operation ID | Access | Review status |
|---|---|---|---|---|
| POST | `/faculty/onboarding/session` | `startFacultyOnboarding` | public | ready-for-review |
| GET | `/faculty/onboarding/catalogue` | `getFacultyOnboardingCatalogue` | public | ready-for-review |
| POST | `/faculty/onboarding/applications` | `submitFacultyApplication` | public | ready-for-review |

## Catalogue

| Method | Path | Operation ID | Access | Review status |
|---|---|---|---|---|
| GET | `/catalogue/categories` | `listCategorys` | public | ready-for-review |
| GET | `/admin/catalogue/categories` | `listCategorysAdmin` | admin; catalogue.read | ready-for-review |
| POST | `/admin/catalogue/categories` | `createCategory` | admin; catalogue.manage | decision-required |
| PUT | `/admin/catalogue/categories/{id}` | `replaceCategory` | admin; catalogue.manage | decision-required |
| GET | `/catalogue/boards` | `listBoards` | public | ready-for-review |
| GET | `/admin/catalogue/boards` | `listBoardsAdmin` | admin; catalogue.read | ready-for-review |
| POST | `/admin/catalogue/boards` | `createBoard` | admin; catalogue.manage | decision-required |
| PUT | `/admin/catalogue/boards/{id}` | `replaceBoard` | admin; catalogue.manage | decision-required |
| GET | `/catalogue/subjects` | `listSubjects` | public | ready-for-review |
| GET | `/admin/catalogue/subjects` | `listSubjectsAdmin` | admin; catalogue.read | ready-for-review |
| POST | `/admin/catalogue/subjects` | `createSubject` | admin; catalogue.manage | decision-required |
| PUT | `/admin/catalogue/subjects/{id}` | `replaceSubject` | admin; catalogue.manage | decision-required |
| GET | `/catalogue/levels` | `listLevels` | public | ready-for-review |
| GET | `/admin/catalogue/levels` | `listLevelsAdmin` | admin; catalogue.read | ready-for-review |
| POST | `/admin/catalogue/levels` | `createLevel` | admin; catalogue.manage | decision-required |
| PUT | `/admin/catalogue/levels/{id}` | `replaceLevel` | admin; catalogue.manage | decision-required |
| GET | `/catalogue/curricula` | `listCurriculums` | public | ready-for-review |
| GET | `/admin/catalogue/curricula` | `listCurriculumsAdmin` | admin; catalogue.read | ready-for-review |
| GET | `/catalogue/teaching-languages` | `listTeachingLanguages` | public | ready-for-review |
| GET | `/admin/catalogue/teaching-languages` | `listTeachingLanguagesAdmin` | admin; catalogue.read | ready-for-review |
| POST | `/admin/catalogue/teaching-languages` | `createTeachingLanguage` | admin; catalogue.manage | ready-for-review |
| PUT | `/admin/catalogue/teaching-languages/{id}` | `replaceTeachingLanguage` | admin; catalogue.manage | ready-for-review |
| GET | `/catalogue/tree` | `getCatalogueTree` | public | ready-for-review |
| GET | `/catalogue/nodes/{nodeId}` | `getCatalogueNode` | public | ready-for-review |
| GET | `/admin/catalogue/tree` | `getCatalogueTreeAdmin` | admin; catalogue.read | ready-for-review |
| GET | `/admin/catalogue/nodes/{nodeId}` | `getCatalogueNodeAdmin` | admin; catalogue.read | ready-for-review |
| PUT | `/admin/catalogue/nodes/{nodeId}` | `updateCatalogueNode` | admin; catalogue.manage | ready-for-review |
| POST | `/admin/catalogue/paths` | `createCataloguePath` | admin; catalogue.manage | ready-for-review |
| POST | `/admin/catalogue/nodes` | `createCatalogueNode` | admin; catalogue.manage | ready-for-review |
| PUT | `/admin/catalogue/nodes/reorder` | `reorderCatalogueNodes` | admin; catalogue.manage | ready-for-review |
| PUT | `/admin/catalogue/nodes/{nodeId}/move` | `moveCatalogueNode` | admin; catalogue.manage | ready-for-review |
| PUT | `/admin/catalogue/nodes/{nodeId}/archive` | `archiveCatalogueNode` | admin; catalogue.manage | ready-for-review |
| GET | `/admin/faculty/{facultyId}/assignments` | `listFacultyAssignments` | admin; faculty.read | ready-for-review |
| POST | `/admin/faculty/{facultyId}/assignments` | `createFacultyAssignment` | admin; faculty.assign | ready-for-review |
| PUT | `/admin/faculty/{facultyId}/assignments/{assignmentId}` | `replaceFacultyAssignment` | admin; faculty.assign | ready-for-review |

## Pricing

| Method | Path | Operation ID | Access | Review status |
|---|---|---|---|---|
| GET | `/admin/prices` | `listPriceRules` | admin; pricing.read | ready-for-review |
| POST | `/admin/prices` | `createPriceRule` | admin; pricing.manage | ready-for-review |
| GET | `/admin/prices/awaiting` | `listAwaitingTutorPrices` | admin; pricing.read | ready-for-review |
| PUT | `/admin/prices/bulk` | `bulkUpdatePriceRules` | admin; pricing.manage | ready-for-review |
| PUT | `/admin/prices/{priceId}` | `updatePriceRule` | admin; pricing.manage | ready-for-review |
| GET | `/prices/resolve` | `resolveSessionPrice` | public | decision-required |
| POST | `/prices/quote` | `quoteSessionPrices` | public | decision-required |

## Category tree

| Method | Path | Operation ID | Access | Review status |
|---|---|---|---|---|
| GET | `/admin/category-tree` | `getCategoryTree` | admin; catalogue.read | ready-for-review |
| GET | `/admin/category-tree/status` | `getCategoryTreeStatus` | admin; catalogue.read | ready-for-review |
| GET | `/admin/category-tree/picker` | `getCategoryTreePicker` | admin; catalogue.read | ready-for-review |
| POST | `/admin/category-tree/roots` | `createCategoryRoot` | admin; catalogue.manage | ready-for-review |
| PUT | `/admin/category-tree/reorder` | `reorderCategories` | admin; catalogue.manage | ready-for-review |
| GET | `/admin/category-tree/{categoryId}` | `getCategoryTreeNode` | admin; catalogue.read | ready-for-review |
| PATCH | `/admin/category-tree/{categoryId}` | `updateCategoryTreeNode` | admin; catalogue.manage | ready-for-review |
| DELETE | `/admin/category-tree/{categoryId}` | `deleteCategoryTreeNode` | admin; catalogue.manage | ready-for-review |
| POST | `/admin/category-tree/{categoryId}/children` | `createCategoryChild` | admin; catalogue.manage | ready-for-review |
| PUT | `/admin/category-tree/{categoryId}/move` | `moveCategory` | admin; catalogue.manage | ready-for-review |
| GET | `/catalogue/category-tree/children` | `listLearnerCategories` | public | ready-for-review |
| GET | `/catalogue/category-tree/leaves` | `listLearnerLeaves` | public | ready-for-review |
| GET | `/catalogue/category-tree/leaves/{categoryId}` | `getLearnerLeaf` | public | ready-for-review |
| GET | `/catalogue/category-tree/leaves/{categoryId}/offering` | `resolveLearnerOffering` | public | ready-for-review |

## Library

| Method | Path | Operation ID | Access | Review status |
|---|---|---|---|---|
| POST | `/admin/library/files` | `uploadLibraryMaterial` | admin; library.upload | decision-required |
| POST | `/admin/library/links` | `submitLibraryLink` | admin; library.upload | decision-required |
| GET | `/admin/library` | `listLibraryModerationQueue` | admin; library.moderate | decision-required |
| GET | `/admin/library/{materialId}` | `getLibraryModerationRecord` | admin; library.moderate | decision-required |
| PUT | `/admin/library/{materialId}/review` | `reviewLibraryMaterial` | admin; library.moderate | decision-required |
| GET | `/library` | `listApprovedLibrary` | student | decision-required |
| GET | `/library/{materialId}` | `getApprovedLibraryResource` | student | decision-required |
| GET | `/library/{materialId}/content` | `getLibraryContentStudent` | student | decision-required |
| GET | `/admin/library/{materialId}/content` | `getLibraryContentAdmin` | admin; library.moderate | decision-required |

## Configuration

| Method | Path | Operation ID | Access | Review status |
|---|---|---|---|---|
| GET | `/admin/settings` | `listSettings` | admin; configuration.read | ready-for-review |
| GET | `/admin/settings/{key}` | `getSetting` | admin; configuration.read | ready-for-review |
| PUT | `/admin/settings/{key}` | `updateSetting` | admin; configuration.manage | decision-required |

## Audit

| Method | Path | Operation ID | Access | Review status |
|---|---|---|---|---|
| GET | `/audit` | `listAuditEvents` | admin; audit.read | ready-for-review |
