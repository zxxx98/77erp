# Multilingual Implementation Plan

> **For agentic workers:** Use subagent-driven-development to implement the independent tasks; root integrates and reviews.

**Goal:** Deliver Chinese, English and Vietnamese across desktop/mobile/PWA with a flag language switcher.

**Architecture:** Shared i18next instance, semantic catalog entries `[zh, en, vi]`, React `useLocale()` subscription, durable account preference and bundled resources. API language is request-scoped; never mutate global server language.

**Tech Stack:** React 19, i18next, react-i18next, Ant Design, antd-mobile, Express, SQLite, Node test, Playwright.

## Global Constraints

- Keep business identifiers, stored values and user content unchanged.
- Keep existing Chinese UI compatible and translate all three languages together.
- Do not key/remount the application on language changes.
- Work on main, preserve unrelated edits, no subagent commits.
- Catalog entries have stable semantic keys and complete Chinese/English/Vietnamese translations.

## Shared interfaces

`src/i18n/index.js`: `t(key, params?)`, `getLocale()` returns `zh-CN | en | vi`, `getFormatLocale()` returns `zh-CN | en-US | vi-VN`, `setLocale(locale)`.

`src/i18n/react.jsx`: `useLocale()` subscribes components and returns `{ locale, setLocale, t }`. Call it in components rendering translated content. Module-level display metadata must store keys or translate at render time.

`src/i18n/catalogs/*.js`: default export object of `semantic.key: [Chinese, English, Vietnamese]`. The runtime explicitly imports and registers each catalog, including them in the PWA bundle. Catalog keys are prefixed by module.

## Tasks

- [x] Foundation: add failing locale resolution/format/interpolation tests, implement runtime and catalog validation; add accessible SVG flag switcher and account sync. Integrate auth/app shells/common controls and settings. Verify no remount and keyboard/mobile behavior.
- [x] Backend: add failing preference isolation/validation tests; add nullable user language, own-account PATCH `/api/auth/language` `{language}` returning `{language}`, auth status language, language-aware AI and stable warehouse error code. Localize generated artifacts with request-scoped translations; retain old contracts.
- [x] Warehouse UI: migrate `src/pages/{Dashboard,Products,Inventory,Orders,Scanner}.jsx`, `src/mobile-web/`, `src/features/{Order*,ProductDialogs,Settings,ProductionApproval*}.jsx`, `src/{StockQr,Operations,Commerce,MultiStocktake,CustomerPartNumbers,ProductHistory,InspectionPanel}.jsx`; add warehouse catalog and meaningful coverage.
- [x] Production UI: migrate all other production/BOM/quality page and feature components, including chart display labels; add production catalog and meaningful coverage. Do not translate editable template data or structural spreadsheet field names.
- [x] Root integration: remaining common/system/admin/AI/PWA strings and shared display labels, API client language and errors, date/number formatting; inspect outstanding source strings and fix omissions.
- [x] Verification: catalog coverage and semantic tests, full Node tests/build, Playwright desktop/mobile language tests plus auth and business regressions, rendered screenshots. Review final diff and AI synchronization, commit only this task's files on main and push origin/main.

## Validation commands

`node --test tests/i18n.test.js tests/auth-language.test.js` verifies locale fallback, complete catalogs, interpolation, account preference, auth and invalid-language rejection.

`npm test` and `npm run build` verify API regressions and all migrated JSX.

`npx playwright test tests/browser/i18n.spec.js tests/browser/auth.spec.js` verifies flag menu, language persistence, state preservation and narrow-screen layout using the isolated in-memory browser fixture.

## Completed validation (2026-10-25)

- Bundled Node 24.19: `npm test` — 579 passed, zero failures.
- Production build passed; PWA includes all local flags and bundled catalogs.
- Final `i18n.spec.js`, `auth.spec.js`, `workflow.spec.js` — 14 passed. Includes actual iOS WebKit form preservation, Android PWA offline switching/reconnect, English/Vietnamese product editing and the complete stock workflow.
- Earlier selected AI, mobile component, production/PWA, online quality and preference regressions passed. One workflow failure caused by a concurrent replacement of build assets was identified from HTTP 404 trace evidence and passed in the final isolated run.
- Visual inspection: English desktop, Vietnamese mobile/login (including 320px), iOS English form; production English/Vietnamese PDF rendering.
- Independent review findings resolved: cross-tab out-of-order synchronization, locale-specific chart numbers and generated series labels including source drilldown. Tests preserve same-spelled user labels and original business enum values.
- AI synchronization checked: locale-aware prompt and display projection, stable tools/confirmation payloads, additive regression tests.
- Existing unrelated `.superpowers/` files retained; generated test screenshots excluded from the commit. No application version or release tag change.
