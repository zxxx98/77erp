# Production material ledger refinement

Continue the approved production detail layout inside the existing Materials tab. The user identified duplicate issue/return and planned-material summaries.

- [x] Add browser assertions that each material appears once in a ledger, planned/issued/used/returned/pending/available values remain distinct, and details retain recipe/variance/cost information. Verify on desktop, mobile and PWA.
- [x] Add ProductionMaterialLedger.jsx with a desktop table, mobile stacked rows and expandable per-material details. Keep request quantities and closed quantities in details; keep warnings and quantity semantics unchanged. Stage direct consumption and final-product usage must retain separate labels.
- [x] Replace the two material summaries with the ledger for material-workflow orders. Keep existing historical-order and editing forms, business actions and permissions. Show material documents separately under the ledger, with pending requests immediately available.
- [x] Run affected production material/stage/tab/legacy browser cases, i18n/API tests, build, visual checks and independent review. Check AI synchronization, then commit and push main per AGENTS.md.


## Verification

- 46 production material/stage/i18n unit and API tests passed; the 5 i18n tests passed again after resolving an existing translation-key name collision.
- 18 material/stage/detail-tab Chromium cases, 2 historical production cases and 1 mobile WebKit case passed. The mobile material flow also passed a final screenshot run.
- Vite build succeeded, desktop/mobile screenshots inspected, Impeccable detector returned no findings and git diff --check passed.
- Independent review found no significant introduced issues. AI synchronization checked: this is display-only grouping with existing quantities, permissions, API rules and operations retained; no AI tool/schema change required.
