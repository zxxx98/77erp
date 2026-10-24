# Production material UI and integration verification

## Delivered behavior

- Desktop Web, mobile Web and PWA share the start → awaiting materials → warehouse approval → in progress → registration workflow.
- Outbound and inbound pages include independently queried production material documents, with direction-specific permissions, search, status filters, pagination, details and approval.
- Production supports supplements, returns, cancellation, issued-material balances and refresh after warehouse changes. Registration consumes the issued pool without a second warehouse deduction.
- Navigation and forms use 入库/出库; the production action uses 登记. Historical production orders retain their original inventory semantics.
- AI read tools and descriptions, finance redaction, backup migration/restore and stock history were reviewed with backend integration.

## Verification

- Full Node suite: 471 passed, 0 failed, using bundled Node v24.19.0. See task-1-report.md for backend RED/GREEN evidence.
- Production ledger plus historical production: 55 passed.
- Production build succeeded through the Playwright web-server build command; existing large-chunk warnings remain.
- Relevant browser regression run: 72 of 73 passed initially. The sole failure used a historical six-decimal product threshold, incompatible with the repository's existing four-decimal quantity validation. Correcting that fixture to 0.1234 required no application change.
- Final workflow and new-material rerun: all 11 passed, including the corrected workflow case and all 5 new material-flow cases. Thus all 73 distinct selected browser cases were verified successfully.
- New browser coverage includes desktop, mobile and service-worker-enabled PWA issue/registration/return flows, warehouse-only authorization, supplements and cancellation.
- Manual desktop and mobile screenshots showed no horizontal overflow.
- Independent UI and full code reviews passed after fixes. UI review found a warehouse-stock shortage warning after materials were already issued; the fix uses issued-pool availability and has a regression assertion. Backend review found extreme lifetime cost precision and batch reversal overflow issues, both fixed with regression tests.
- Final whitespace validation: git diff --check passed.

Local logs and visual evidence are retained in ignored output/ui-preview; no generated assets or runtime dependencies are included in the commit. No version bump, tag or deployment was requested.
