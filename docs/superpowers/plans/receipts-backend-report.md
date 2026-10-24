# Production receipts backend implementation report

Implemented the approved register → pending receipt → warehouse approval workflow. Parent owns browser/UI validation, release and main push.

## API contract

- `GET /api/production-receipts?status=all|pending|confirmed|void&q=&offset=&limit=` returns `{documents,total,has_more}`. Requires purchase permission.
- `POST /api/production-receipts/:id/confirm` accepts `{version,request_id}` and returns the receipt document directly. Purchase authorization is checked before cached response replay; finance controls cost-field visibility recursively.
- Receipt documents include linked production and batch identity, immutable product/unit/quantity/cost snapshots, `pending|confirmed|void` status, versions, creator/approver/void actor and timestamps, and product/scrap items.
- Production detail returns `receipt_documents`, `received_quantity`, `pending_receipt_quantity`; list rows include both quantities. Each batch exposes `receipt_required`, `receipt_status`, and `receipt_id` when applicable.

## Accounting and compatibility

Registration consumes the issued material pool (or raw stock for historical material workflows) and creates the pending receipt without output stock/value changes. Every future batch requires approval, even on historical orders. Multiple pending receipts do not prevent further registration or production completion. Approval posts product cost and zero-cost stock scrap atomically. Discarded scrap has no receipt movement.

Pending void cancels its receipt and restores material consumption without touching output stock. Confirmed/legacy posted void additionally requires purchase permission and reverses the original quantity and cost with inventory guards. Existing production/correction middleware remains in force. Whole-order legacy reversals and material-workflow restrictions are retained. Idempotent retries never bypass current permission checks.

Backup format is 35, with format 34 and earlier mapped to historical `receipt_required=0` batches and no invented receipt documents. Both receipt tables participate in reset/delete/restore and revision tracking. Backup validation checks linkage, one-to-one required receipt coverage, frozen snapshots, complete product/scrap rows, cost conservation, status and actor metadata. Database schema migration defaults pre-existing batches to historical and was tested twice for restart safety without moving posted stock.

Product history retains the existing event names (`production_in`, `production_scrap_in`, and matching void events). New output events use warehouse confirmation time/operator and receipt numbers. Pending output produces no stock-history entry. Purchase users can read these warehouse events without production or finance access.

AI schemas and system guidance describe pending versus received quantities and approval semantics. AI regressions verify pending → confirmed read results, nested cost redaction even for finance-authorized AI users, and absence of new AI write tools.

## TDD and verification

Runtime: `C:/Users/xiaodi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe` (Node 24; required by this repository's SQLite backup tests).

- Initial RED: `output/ui-preview/receipts-backend-red.log` records actual 5/10-unit immediate-output stock failures against the old implementation.
- Core GREEN: `output/ui-preview/receipts-backend-core-green.log` records the initial 3 passing registration/approval/reversal cases.
- Ledger RED: `output/ui-preview/receipts-backend-ledger-red.log` records backup format 34 versus expected 35 and premature stock-history failures.
- Ledger GREEN: `output/ui-preview/receipts-backend-ledger-green.log` records all 5 cases passing.
- Focused current receipt suite: `output/ui-preview/receipts-backend-focused-final.log`, 11 passed, zero failed. Includes authorization/revocation replay, stale versions, warehouse isolation, safe stock/value boundaries, scrap rollback, pending/confirmed void, deletion/reset, format 34 migration/restore, and persisted pre-migration schema/restart.
- Broader production/permissions/catalog regressions: `output/ui-preview/receipts-backend-production-second.log`, 69 passed, zero failed.
- Full Node suite before the final migration test addition: `output/ui-preview/receipts-backend-full-final.log`, 481 passed, zero failed.
- Final full-suite rerun with the migration test: `output/ui-preview/receipts-backend-full-482.log`, **482 passed, zero failed**, process exit 0 (45.3 seconds).

Existing posted-accounting production tests now approve receipts through the real warehouse API and refresh detail before stock assertions. Fixtures retain explicit historical material workflow only; no request flag or test-only production path bypasses receipt approval. Stock overflow expectations moved to receipt approval and are covered by the dedicated atomic rollback tests. All backup version assertions and the exhaustive route authorization inventory are updated.

Initial full-suite iteration also encountered a Windows ephemeral reserved-port failure in an unrelated catalog fixture; its rerun passed, and the subsequent full 481-case run had no failures. Receipt fixtures explicitly avoid fetch-blocked ephemeral ports.
