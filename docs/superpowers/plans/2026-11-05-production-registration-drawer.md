# Production registration drawer implementation plan

**Goal:** Desktop in-context reporting uses a compact right drawer while direct links and mobile keep their pages.

**Architecture:** Keep drawer state separate from Production's editor state to preserve the underlying view. Reuse ProductionQuickRegistration with an opt-in drawer presentation and the existing Modal shell. Retain all shared submission logic.

**Tech Stack:** React, existing Modal and controls, CSS, Playwright, Node test runner.

## Constraints

- Work on main; preserve unrelated .superpowers files.
- No mobile layout, API, business validation, or version changes.
- No extra confirmation needed: user approved the drawer design and implementation.

## Tasks

- [x] Add browser tests in tests/browser/production-quick-registration.spec.js for drawer lifecycle, unsaved protection, stale recovery, pinned footer and mobile page entry; run targeted tests and observe missing drawer failure.
- [x] In src/pages/Production.jsx add separate drawer/activity state; desktop beginCompletion opens it, scanner stays page-based. Update detail and list on save; close only after submitted reports, not reloads. Keep original editor and scroll intact.
- [x] In src/features/ProductionQuickRegistration.jsx add optional drawer rendering with Modal, single-column body, inline searchable picker, compact selected context, fixed footer and guarded close. Add translated completed notice in src/i18n/catalogs/process-routes.js.
- [x] Scope drawer styles in src/features/production-registration.css; verify long labels, narrow desktop and fixed action visibility.
- [x] Run quick-registration and affected production browser suites, Node tests, production build and layout detector. Inspect desktop/mobile screenshots; review diff and AI synchronization scope.
- [x] Commit task files on main and push origin/main after verification.

## Verification record

- Node 24.22.1: 713 unit tests passed. The default local Node 22.14 lacks the SQLite backup export already used by this repository.
- Browser regression: 100 production cases exercised; four stale UI expectations corrected and rerun successfully. Added progress scroll/operations restoration and nested acceptance coverage also passed.
- Final height refinement: 5 desktop/mobile tests passed, including a measured 44px picker matching the quantity field.
- Production builds passed; existing bundle-size warning remains. Impeccable detector returned no findings. Desktop and mobile screenshots reviewed.
- AI synchronization checked: no API schema, business field, validation rule, or writable operation changed; no AI tool update needed.
- Test maintenance: permit the existing optional operation_accept checkbox, wait for status inside the loaded detail, and account for automatically closed drawers and preserved expanded operations.
