# BOM structure navigation implementation plan

> Execute inline using the writing-plans, test-driven-development and verification-before-completion workflows. The user approved this design on 2026-10-24.

**Goal:** Make ten-level BOMs readable on desktop Web, mobile Web and PWA.

**Architecture:** Keep existing calculation and production snapshot semantics. A shared structure browser renders compact rows, separates node details, and navigates branches with breadcrumbs. Calculation results place the existing material summary and this browser in persistent tabs. Production reuses the browser without hiding editable material inputs.

**Tech stack:** React, existing Ant Design controls, lucide icons, Playwright, Node tests.

## Constraints

- Work on main and preserve all pre-existing unrelated changes.
- No API, inventory, calculation, CSV or AI tool contract changes.
- Root materials shown initially; expand to relative level 2/3 or collapse all on desktop.
- Mobile shows one level at a time. Branch navigation and tab switching retain browsing position.
- Search names/codes throughout the snapshot, preserving repeated occurrences and ancestor context.
- Details contain path, recipe/version, base quantity, net usage, loss method/rate and child recipe; stock shortages remain only in aggregate results.

## Tasks

- [x] Add browser coverage (`tests/browser/bom-navigation.spec.js`) for a ten-level recipe, duplicate raw-material paths, default summary, desktop expansion, branch navigation, search, details, mobile overflow, PWA and production snapshots. Run a new test and confirm it fails at the missing tabs.
- [x] Replace recursive cards in `src/features/BomStructure.jsx` with compact table rows and branch browsing. Cache calculated rows/indexes; only render visible rows. Add `src/features/BomResultViews.jsx` for persistent Ant Design tabs. Style in a dedicated structure stylesheet.
- [x] Integrate tabs in `src/pages/Bom.jsx`, keep stale-result and production actions visible, replace verbose source paths with an actionable source count. Reuse the structure browser in production. Update prior multilevel browser assertions to the new controls.
- [x] Run navigation and existing BOM browser tests, BOM calculation/API and production/AI regressions, and build. Inspect desktop and mobile screenshots and fix any visual defects. Run the Impeccable detector on changed UI files.
- [x] Document navigation in `docs/bom.md`, review the scoped diff and AI synchronization needs. Deliver the scoped changes on main according to the repository convention.

## Verification commands

```powershell
npx playwright test tests/browser/bom-navigation.spec.js
npx playwright test tests/browser/bom.spec.js tests/browser/production.spec.js
node --test tests/bom-expansion.test.js tests/bom.test.js tests/production.test.js tests/ai.test.js
npm run build
git diff --check
```

Acceptance includes unchanged final material quantities and frozen production structure after child-recipe edits; no document-wide horizontal overflow at 390px or 320px; separate expand/detail targets; reachable controls by keyboard; no runtime errors.

## Implementation notes

- A structural identity key resets browser state when recipes/snapshots change; changing only production quantity preserves the branch.
- Mobile details keep the Drawer shell mounted through interrupted opening animations, then restore the explicit originating control on close. The focused regression covers quick closing in Chromium and WebKit.
- Existing BOM production scenarios used old registration labels and immediate stock posting. Their fixtures now follow the historical-order approach already used by `production.spec.js` and explicitly approve finished-goods receipts through the current API. The new navigation suite also exercises current production-order snapshots.
- AI synchronization reviewed: tool schemas, input validation, calculations and serialized snapshot fields are unchanged. The AI regression suite remains applicable without tool changes.
- Verification uses bundled Node 24.19.0 because system Node 22.14.0 lacks the existing `node:sqlite` backup export. Temporary test configs reuse the freshly built `dist` and keep WebKit results separate.

## Verification results

- 110 Node tests passed across BOM expansion/API, production and AI.
- 39 Chromium browser tests passed across the navigation, BOM and production suites, including mobile and active-service-worker PWA cases.
- 2 additional WebKit mobile tests passed, including ten-level navigation and early Drawer closure/focus restoration.
- Vite production build and PWA precache generation passed. Existing large-chunk advisory remains.
- Desktop and mobile screenshots inspected, including WebKit detail layout. Impeccable detector returned no findings; `git diff --check` passed.
- Independent read-only review found a snapshot-switch state issue, which was fixed and regression-tested; follow-up review found no remaining must-fix findings.
