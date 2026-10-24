# Production Material Flow Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Start production, approve warehouse issues, record production without double deductions, and return unused materials.

**Architecture:** Isolated production material document ledger plus existing production batches. New orders opt into the workflow at creation; historical orders retain their original stock semantics. Warehouse pages show a dedicated production document queue beside ordinary orders.

**Tech Stack:** React, Express, node:sqlite, Node test runner, Playwright.

## Global Constraints

- Desktop Web and mobile Web/PWA receive the same workflow.
- Commit on main and push origin/main; preserve unrelated work.
- No native Android changes, no new packages, no version bump requested.
- Four-decimal material quantities and existing whole-unit rules remain.
- Every write is transactional, versioned and idempotent; costs require finance permission.
- Confirmed design: docs/superpowers/specs/2026-10-24-production-material-flow-design.md.

### Task 1: Production material ledger and backend integration

Files: create server/production-materials.js and tests/production-materials.test.js; modify server/production.js, auth.js, data-updates.js, backup/restore integration, shared/production.js, server/ai.js and affected Node tests. Backend implementer owns server/**, shared/production.js and tests/*.test.js only.

Interfaces: implement the exact API and response fields in the design, send parent any required deviations before implementation. The parent owns all src files, shared/permissions.js and browser tests. Avoid ordinary orders table changes; queue is independently queried by UI.

- [x] Write a real API test creating BOM and order; assert start produces awaiting_materials and unchanged stock; warehouse confirm decreases stock once; complete consumes issued pool without decreasing stock again.
  ```js
  assert.equal(started.status, 'awaiting_materials');
  assert.equal(stockAfterStart, initialStock);
  assert.equal(stockAfterConfirmation, initialStock - issued);
  assert.equal(stockAfterRegistration, stockAfterConfirmation);
  ```
- [x] Run `node --test tests/production-materials.test.js` and record expected missing-endpoint/behavior failure.
- [x] Implement migrations, material documents, production balance/cost allocation and API guards. Costs are allocated from available quantity/value with existing allocate helper; reversals restore original batch cost to pool.
- [x] Add and run negative, permissions, retry, pool-cost, return, cancellation, migration, old workflow and backup tests. Preserve old tests as explicit historical fixtures where necessary; never add a request option to bypass new workflow.
- [x] Update AI read schema/prompt and backup validation; run affected Node tests and record exact output in task-1-report.md. Do not commit while parent has parallel edits; parent will stage exact files after review.

### Task 2: Warehouse and production UI

Files: src/pages/Production.jsx, src/features/ProductionMaterialDocuments.jsx, src/pages/Orders.jsx, src/mobile-web/MobileShell.jsx, navigation and labels, shared/permissions.js; tests/browser/production-materials.spec.js.

Interfaces: consume production detail material_workflow/material_documents/item balances and material document APIs from task 1. useBusiness provides request IDs and retry handling; useQuery provides scoped refresh.

- [x] Add Playwright flow for desktop and mobile with API fixtures and user clicks. Run it to observe absence of Start Production and queue.
- [x] Add start, request supplements/returns, refresh status and document displays. Gate registration by actual state; use pool balance instead of warehouse stock to show shortages for new workflow.
- [x] Add warehouse material queue with status/search/pagination, inline details, confirmation/cancellation, contextual stock/cost permissions and clear empty/loading/error states.
- [x] Rename warehouse navigation and entry labels consistently; reuse existing components/styles with responsive layouts.
- [x] Run focused browser tests and `npm run build`; update old browser tests to explicitly exercise historical orders when testing old stock semantics.

### Task 3: Cross-cutting review and delivery

Files: docs/production.md, review fixes and this progress checklist.

- [x] Run `npm test`, `npm run build`, relevant Playwright desktop/mobile suites. Resolve failures based on evidence.
- [x] Request independent code review with the complete diff and API/browser test evidence; address correctness and integration findings.
- [x] Review AI synchronization, backup safety, stock/cost invariants and legacy data behavior.
- Delivery: commit scoped changes on main and push origin/main; report the verified commit and push result in the final response.
