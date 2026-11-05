# Post-processing Materials Implementation Plan

> **For agentic workers:** Use subagent-driven-development to implement task-by-task with regression tests and independent review.

**Goal:** Configure fixed material use per post-processing operation, automatically plan issuance and consume issued materials on reports.

**Architecture:** Extend operation nodes with optional materials and snapshot them on binding. Integrate deterministic report consumption into the existing production material pool; expose planned and consumed breakdowns without changing finished-product receipts.

**Tech Stack:** React, Node.js 24, SQLite, node:test and Playwright.

## Global Constraints

- Desktop Web, mobile Web and PWA are supported; no native app work.
- Existing post-processing limits, wages and finish gates remain unchanged.
- Normal production consumption and previous finished-product receipt costs remain unchanged.
- No independent fixed-quantity additional-operation feature is restored.
- Preserve existing uncommitted registration-drawer work; agents do not stage, commit or reset it.
- Run Node tests with `C:/Users/xiaodi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`.
- Root handles integration, commits and pushes on main after review.

## Task 1 — Domain and persistence

Files: server/process-routes.js, server/production-materials.js, server/production.js, shared/process-routes.js, focused shared/server helper if needed, backup/acceptance adapters, tests/post-processing-materials.test.js and relevant backup version assertions.

Interface: operation graph nodes accept `materials: [{product_id, quantity}]`, optional/empty for no material. Reads and production snapshots return material metadata (name, barcode, specification, unit, unit_round_up). Server owns additional calculated order/report fields and reports their exact names before UI handoff. Input report remains quantity-only; server calculates all fixed material use.

Agreed read contract: each post route has `post_processing_planned_runs` and `post_processing_materials` with per-run `quantity` and `planned_quantity`. Material ledger rows expose `post_processing_planned_quantity`, `post_processing_consumed_quantity`, `post_processing_consumed_cost_cents` and merged `total_planned_quantity`; `planned_quantity` retains BOM meaning. Report `post_processing_materials` contains consumed `quantity` and permitted `cost_cents`; report/order `post_processing_material_cost_cents` is a separate subtotal. Raw stored `post_materials` never enters normal API projections. Backup version is 53.

- [x] Write failing integration tests for configured materials, 110/20 => 6 runs, merged BOM and post demand, insufficient issue balance, exact cost consumption and void restoration.
- [x] Normalize material configuration and validate warehouse, activity, quantity/whole-unit rules and duplicate IDs. Snapshot configuration on order creation and recompute plan on draft quantity changes.
- [x] Add report material persistence, backup version/validation/adapters, deterministic consumption and cost permissions. Apply active report consumption to balances, rounding, cancellation and restore validation.
- [x] Test configuration changes do not change snapshots; no-material existing routes, normal production, staged production, idempotency and cost redaction stay compatible. Run focused tests and report commands/results.

## Task 2 — User interfaces and browser verification

Files: process-route node editor, PostProcessingPlan, production registration/ledger/history, production/process-route localization catalogs, focused browser test.

- [x] Add a browser regression for configuring a material and seeing the expected initial issue requirement; witness failure before implementation.
- [x] Add reusable material picker and per-run quantity controls only to post-processing nodes, following existing UI controls. Show snapshot per-run and planned quantities at order binding and deterministic consumption preview at registration.
- [x] Display consumed materials and cost only with appropriate permissions. Preserve concurrent drawer changes. Add localized labels/errors and ensure mobile layouts fit.
- [x] Run desktop/mobile/PWA workflow and targeted WebKit checks, normal production regression and production build.

## Task 3 — Integration, documentation and review

Files: server/ai.js, tests/ai.test.js, shared/error-translations.js, docs/production.md and this plan.

- [x] Update AI read descriptions/fields and regression assertions, documentation and missing server error translations.
- [x] Review domain and UI diffs against the approved design, correct findings and verify covering tests.
- [x] Run full Node suite and production build/browser checks, recording real failures and targeted reruns separately.
- [x] Stage only task changes, verify diff and commit/push to origin/main.


## Verification record

- Domain RED verified missing validation/planning/issuance before implementation; final focused suite passed 9 tests. Production/domain regression passed 154 tests before the final edge additions.
- Full Node suite passed 722/722 on Node 24, exit 0. A later registration-default regression passed 7/7 in its covering suite.
- AI integration verified template materials, planned demands, post report quantities, remaining issued balance and cost redaction. Server localization suite passed 6/6.
- Chromium integration passed 31/31; final focused workflow/regression pass covered 8 cases. iPhone 13 WebKit passed. Desktop, Pixel 7, iPhone 13 and PWA fixed-material workflow screenshots were captured and reviewed.
- Production/PWA build passed with the existing bundle-size advisory.
- Domain review found no actionable defects. Final visual review identified a false material-state warning caused by comparing an omitted public-product flag with the snapshot. The UI now compares rounding flags only when present; the server remains authoritative for current rule validation. A browser regression checks the false warning is absent.
- Preserved the concurrent desktop registration drawer commit fc46cbc. Only task files are included in delivery; local .superpowers reports/logs remain untracked.
