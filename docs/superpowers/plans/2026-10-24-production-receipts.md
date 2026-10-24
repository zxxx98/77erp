# Production Receipts Implementation Plan

> Use subagent-driven-development for isolated backend and UI tasks and independent review.

**Goal:** Register batches without warehouse output movements, then approve receipts in warehouse inbound pages.
**Architecture:** Dedicated batch receipt ledger and per-batch historical compatibility, shared desktop/mobile UI.
**Tech Stack:** React, Express, node:sqlite, Node test runner, Playwright.

## Constraints

Follow the approved production-receipts design. Work on main, preserve existing changes, no new dependencies. Parent handles final commit/push and release 1.15.20. AI synchronization required. Node v24.19 bundled runtime is available at C:/Users/xiaodi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe.

## Task 1: API and accounting

Own server/**, shared/production*.js and tests/*.test.js. Create server/production-receipts.js and tests/production-receipts.test.js. Integrate production, operations backup, auth, revisions, history and AI.

- [ ] Write and run failing tests for pending output, approval, permissions and reversal.
- [ ] Implement ledger migration, registration snapshots, receipt listing/approval and receipt-aware batch reversal; agree exact API with parent before UI integration.
- [ ] Add negative/idempotency/cost/scrap/legacy/backup tests; run focused and full Node suites. Keep existing fixtures explicitly historical where appropriate.
- [ ] Report RED/GREEN results and limitations to parent; do not commit concurrent changes.

## Task 2: UI and browser tests

Parent owns src/** and tests/browser/**. Create a production receipt queue beside the existing material queue in desktop Orders and mobile MobileShell; integrate production quantity/status/copy and per-batch receipt links.

- [ ] Add browser regressions on desktop, mobile and PWA; observe pending-stock failure.
- [ ] Implement queue approval/search/paging and production status/counts using agreed API; preserve existing UI conventions.
- [ ] Verify rendered states and no mobile horizontal overflow; run browser regressions and build.

## Task 3: Review and release

- [ ] Independent review covers accounting/permissions/migrations/AI and UI; resolve findings with tests.
- [ ] Update docs, package and lock version to 1.15.20 and release announcement.
- [ ] Confirm full Node, relevant browser tests, build and diff checks; commit and push origin/main and report verified result.
