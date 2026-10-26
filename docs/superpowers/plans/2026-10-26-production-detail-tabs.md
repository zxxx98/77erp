# Production Detail Tabs Implementation Plan

**Goal:** Shorten production details with five task tabs and a horizontal snapshot tree.

**Architecture:** Keep order/editor state in Production. Group existing sections into accessible tab panels, preserving visited panels. Add an opt-in horizontal renderer to BomStructure so its existing calculation, search, branching and detail behavior stay shared.

**Tech Stack:** React 19, existing CSS, Playwright, Node test runner.

## Global Constraints

- Desktop Web, mobile Web and PWA; no native Android work.
- Preserve existing business rules, permissions, translations and AI compatibility.
- Work on main per AGENTS.md and preserve unrelated .superpowers files.

## Tasks

- [x] Add browser regression coverage in tests/browser/production-detail-tabs.spec.js for five panels, horizontal hierarchy, search/details, mobile overflow, keyboard selection and batch receipt focus. Run `npx playwright test tests/browser/production-detail-tabs.spec.js --max-failures=1` to demonstrate the missing tabs.
- [x] Group detail sections in src/pages/Production.jsx using src/features/ProductionDetailTabs.jsx. Maintain controlled active tab across editor transitions and reset for another order. Keep identity and common operations outside panels. Add translated labels/empty states in src/i18n/catalogs/production.js.
- [x] Add src/features/BomHorizontalTree.jsx and CSS. Feed the existing calculated nodes and selection callbacks from BomStructure. Use nested horizontal branches with connector lines, bounded scrolling, depth controls and matching ancestor paths; preserve the mobile details drawer.
- [x] Run the new browser coverage, update existing production browser flows to select the relevant tabs, and run affected production/BOM/browser and unit tests plus `npm run build`.
- [x] Inspect desktop/mobile screenshots and run Impeccable detector on changed UI targets. Review AI compatibility and git diff, commit and push to origin/main.


## Verification

- Node 24: 98 production/BOM/material/receipt/i18n unit and API tests passed.
- Chromium: all 71 selected browser cases passed (68 in the full run; the final three batch-correction cases passed after updating their navigation to the Overview tab).
- WebKit: desktop and mobile tab/tree cases passed (2 cases).
- The new viewport assertion reproduced offscreen mobile search matches before the horizontal-scroll fix and passed afterward.
- Browser-run Vite build succeeded; desktop and mobile screenshots inspected; Impeccable detector returned no findings; git diff --check passed.
- Independent review findings (new-order tab reset and horizontal search positioning) resolved and re-reviewed.
- AI synchronization checked: no API fields, validation rules, write operations or tool contracts changed; server/ai.js, src/AiAssistant.jsx and tests/ai.test.js require no updates.
