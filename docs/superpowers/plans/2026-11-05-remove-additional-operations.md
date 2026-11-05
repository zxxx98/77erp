# Remove Additional Operations

**Goal:** Remove the unused additional-operation feature, keeping ordinary production routes and the new post-processing feature.

**User-approved scope:** Remove it entirely; no conversion or legacy compatibility is required for additional-operation data because the feature has not been used. Preserve unrelated production, material issuance, supplemental materials, post-processing and concurrent payroll work.

- [x] Remove creation/reporting/finish and consumption logic, dedicated helpers and persisted fields; retain ordinary operation report/acceptance behavior and post-processing count limits.
- [x] Remove backup adapters specific to additional operations, adjust current schema validation and test expectations. Do not migrate additional operations to post-processing or repair their old records.
- [x] Remove frontend entry points, material breakdowns, registration branches, labels and dedicated tests. Keep the shared picker for post-processing.
- [x] Remove AI descriptions and assertions, outdated active documentation and error translations. Add regression coverage for absence of the retired capability and continued post-processing functionality.
- [x] Run focused tests, full Node suite, desktop/mobile/PWA post-processing browser checks and production build; review only this task's changes for delivery on main.

## Validation

- Focused backend suite: 151 passed. AI checks: 2 passed. Registration and localization: 12 passed.
- Final full Node run: 713 tests, 712 passed, one failed because the test server received a random port rejected by Node fetch (`bad port`). The affected imagebed configuration test passed immediately when rerun alone. The preceding full run's three failures had the same random-port cause, and those three also passed on targeted rerun. No business assertion failures were observed.
- Browser checks: Chromium desktop, Pixel 7, iPhone 13 and PWA post-processing flows passed (4); WebKit iPhone 13 passed (1); ordinary fractional reporting and material supplement/cancellation passed (2).
- Production/PWA build passed with the existing bundle-size warning.
- Independent code review found no actionable defects. Concurrent payroll chart changes were preserved.
