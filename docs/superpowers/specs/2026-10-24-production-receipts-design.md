# Production batch warehouse receipt approval

The user approved batch registration followed by warehouse approval, on desktop Web, mobile Web and PWA, with version/announcement update and push to origin/main.

## Behavior

Every newly registered batch creates one pending production receipt. Registration records output and actual material consumption but does not add finished-product warehouse stock or value. Stock-disposition scrap from that batch is included in the same receipt at zero value; discarded scrap has no warehouse movement. Warehouse users with purchase (inbound) permission confirm the whole receipt, posting output stock/value exactly once. They do not need production or finance permission. Finance fields remain redacted.

Each batch is independently approvable. Production may continue or finish with outstanding receipts. Production detail shows cumulative production, received and pending quantities, per-batch receipt state and linked receipt documents. Completed production with outstanding receipts explicitly says production ended, awaiting receipt. Warehouse inbound pages show a dedicated production receipt queue with search/status/paging and confirmation; ordinary purchases and material returns retain their existing accounting.

Historical batches already posted before this migration remain posted and are never posted again. Receipt tracking is per batch; future registration on an existing order uses approval too. Material-workflow compatibility remains independent: historical orders consume raw warehouse materials at registration, newer orders consume their issued material pool.

Voiding a pending batch voids its receipt and restores material consumption without removing output stock that was never posted. Voiding a confirmed batch removes the exact posted output/value and scrap and restores consumption atomically, requires inbound permission in addition to the existing production/correction permissions, and rejects insufficient stock/value. Receipts cannot be independently deleted or cancelled into an orphaned active batch; corrections go through batch void. Existing whole-order void restrictions remain, with equivalent receipt-aware reversal for legacy orders. Pending receipts block destructive operations through existing production references.

## Architecture and integrity

Use a separate production receipt ledger linked one-to-one to production_batches, not commercial orders or the single-pending-material-document queue. Preserve immutable product/unit/quantity/value snapshots and approver metadata. Add batch receipt tracking defaulting to legacy for migrated rows and set it server-side for new registrations. Registration, approval, reversal, version checks, idempotency and stock notification remain transactional. An approval updates the production version so open client detail refreshes safely. Reject stale requests, unit changes, missing/disabled products and unsafe stock/value totals before committing.

Include ledger in backup/restore validation and format migration, reset/deletion, data revisions and product history. History shows finished stock movement at receipt confirmation, not registration; old history stays valid. AI read tools describe pending/received quantities and approval semantics, with no new AI writes.

## Acceptance

API tests prove registration leaves output stock/value unchanged, multiple pending batches can finish production, approval posts exact costs once, permission and stale request guards, pending/confirmed reversal, scrap posting, legacy migration, backup validation and restore. Browser tests cover desktop/mobile/PWA registration → pending receipt → warehouse confirmation and separate production/warehouse roles. Run full Node suite, relevant browser regression and build, independent review, then update package/package-lock and release-notes to 1.15.20. Commit and push main without a tag.
