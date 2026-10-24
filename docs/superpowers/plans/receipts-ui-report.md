# Production receipt UI and release verification

## Implementation

- Shared production receipt queue on desktop inbound and mobile Web/PWA order pages, with search, status, pagination, expandable product/scrap details and warehouse confirmation.
- Production detail separates cumulative production, received and pending quantities. Registration and finish copy makes approval timing explicit; per-batch receipt buttons focus the corresponding document without changing the application's hash route.
- Warehouse users need inbound permission but no production or finance permission to approve. Finance fields remain hidden. Reversal actions distinguish pending batches and posted batches requiring inbound permission.
- Scrap display distinguishes recorded inbound disposition from warehouse posting. No visual-system replacement or dependencies added.
- Version and lock updated to 1.15.20, with an announcement covering approval, multiple pending batches, historical compatibility and reversal rules.

## Evidence

- Browser RED: registration expected zero finished stock but received 4 under the prior implementation (output/ui-preview/receipts-ui-red.log).
- Initial browser regression: 19/27 passed. The eight failures were test adaptations: API-switching accounts without reloading the UI's authenticated state (two), and an unscoped 已作废 selector matching both the production and receipt states (six). Fixed fixture reload and selector scope; application changes were not required.
- Final built source includes the receipt navigation and permission adjustments (Production chunk generated at 18:32:12, after source changes at 18:31:41). Vite/PWA compilation passed; existing large-chunk warnings remain.
- Desktop, mobile and PWA receipt screenshots were visually inspected; new flows assert no horizontal overflow. The same shared queue and production page serve all three surfaces.
- Independent UI and whole-change reviews identified no actionable findings. Reviews covered receipt accounting, permission/retry checks, history, legacy migration, backup35 validation, AI redaction and UI integration.
- Full Node test suite: 482 passed, 0 failed, using bundled Node v24.19.0 (output/ui-preview/receipts-backend-full-482.log).
- Final browser suite: all 42 passed (3.0 minutes), covering production, material and finished-goods approvals, ordinary commerce, internal units and announcements on desktop/mobile/PWA (output/ui-preview/receipts-browser-final.log).
- After clarifying the inbound/correction permission descriptions, the focused account and release-announcement suite passed 17/17; permission keys and checks are unchanged.
- Final release build after all changes passed with PWA precache generation (output/ui-preview/receipts-release-build.log); only the existing large-chunk warning remains.
- Package, lockfile and release announcement version consistency and git diff --check passed.

Generated screenshots, traces and detailed logs remain in ignored output/ui-preview and test-results.
