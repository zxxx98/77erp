# Task 1 backend implementation report

Implemented the approved production material API contract without changing ordinary transaction tables or adding a request-controlled historical-workflow bypass.

## Behavior delivered

- Dedicated `production_material_documents` / `production_material_document_items` tables, immutable material snapshots, one pending request per production order, warehouse-scoped queries, optimistic versions and transactional request deduplication.
- Existing orders migrate to `material_workflow=0`; every newly created API order is persisted as `material_workflow=1`. Persistent `material_phase` maps the existing SQLite status constraint to draft / awaiting_materials / in_progress / completed / void.
- Initial whole-order issue, independent supplements and returns, cancellation, finished-order returns, pending-document finish guards and explicit correction prerequisites.
- Warehouse confirmation moves inventory and cost; registration consumes the issued pool; batch void restores the original quantity/cost to the pool. Returns revalidate the live unconsumed balance. Pool value uses exact BigInt aggregation so lifetime turnover cannot lose cents.
- Production permission can request and cancel; warehouse direction permission confirms and lists documents without production access. Idempotent replays recheck the stored document direction. Finance-only costs are recursively removed from document and balance fields.
- Warehouse stock history records material confirmations instead of raw-material registration/reversal deltas. Finished output and scrap history remain unchanged.
- Backup format 34 validates ledger relationships, stages, quantities and cost conservation; older backup formats initialize the historical workflow. Reset, restore, deletion and data revisions include both new tables.
- AI read schema accepts awaiting_materials, exposes issued/returned/available quantities without costs, and explains the warehouse approval and material pool rules. AI still has no production write or warehouse approval tool.

## TDD evidence

Using bundled Node v24.19.0 (`C:/Users/xiaodi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`):

1. Initial `--test tests/production-materials.test.js`: 4 tests, 0 pass, 4 fail. Missing start endpoint returned 404; direct registration before approval returned 200 instead of 409.
2. First implementation: 4 tests, 4 pass.
3. Directional replay regression: revoked sale permission while retaining purchase returned 200 instead of 403; authorization before replay corrected it.
4. Stock history / AI schema regression: history showed `production_out/-15` instead of `production_material_out/-20`, and AI status enum omitted awaiting_materials. Both passed after their integrations.
5. Pool quantity/value cap and pending-stage backup tests each reproduced incorrect 200 responses, then passed after guards.
6. Independent review reproduced lifetime issue value rounding from 3 cents to 2, and oversized batch-void pool restoration returning 200 instead of 400. Exact BigInt balance aggregation and safe remaining-value validation corrected both.

Current focused verification after the review fix:

```text
--test tests/production-materials.test.js tests/production.test.js
tests 55
pass 55
fail 0
```

Evidence is retained in `output/ui-preview/backend-production-verification.log`. The final complete Node run is retained in `output/ui-preview/backend-verification.log`.

Final full verification after the independent-review fix:

```text
--test tests/*.test.js
tests 471
pass 471
fail 0
duration_ms 36076.6102
```

## Files

- New backend ledger: `server/production-materials.js`; new API tests: `tests/production-materials.test.js`.
- Integration: `server/production.js`, `server/auth.js`, `server/data-updates.js`, `server/operations.js`, `server/product-history.js`, `server/ai.js`, `shared/production.js`.
- Regression fixtures: `tests/production.test.js` and existing AI production regressions explicitly mark their persisted test orders as historical. The new material API suite and new AI material-flow test never do so.
- Backup version expectations updated in affected Node tests: AI/BOM/catalog/commerce/imagebed/inspections/product-history/production/quality/stock-QR/transfers/users/warehouses.
- Windows verification cleanup: AI/users/notifications temp-directory hooks now run after their SQLite handles close; `server/app.js` closes the database when authentication initialization fails. These addressed observed EPERM cleanup failures and leaked test servers, independent of workflow semantics.

## Verification notes

- The first full run passed 465/466; its only failure was the existing notification restart fixture attempting to remove a still-open SQLite directory. The corrected notifications suite passed 15/15.
- The next full run passed 469/469 before the two numeric-review regression tests were added.
- After the numeric fix, one full run passed 470/471 because an existing product-version fixture received a fetch-reserved ephemeral port. Its focused rerun passed 6/6; the final complete run passed 471/471.
- `git diff --check -- server shared/production.js tests/*.test.js` passes.
- The host's default Node v22.14 lacks the `node:sqlite` backup export; tests use bundled Node v24.19. No application compatibility workaround or dependency change was introduced.
- This Windows host assigns low ephemeral ports. The new API fixture retries fetch-reserved ports, avoiding an observed environment-only `fetch failed: bad port` failure.
- No commit was created by the backend implementer. Parent owns UI/browser verification, final integration, commit and push.
