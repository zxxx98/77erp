# Post-processing Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement and review these tasks continuously.

**Goal:** Bind optional post-processing operations to production orders with actual-output based limits and completion gates.

**Architecture:** Extend existing independent operation snapshots without changing legacy additional operations. Keep exact arithmetic and all limit/finish checks authoritative on the server; UI consumes calculated state.

**Tech Stack:** React, Express, SQLite, Node test runner, Playwright.

## Global Constraints

- Follow approved spec `docs/superpowers/specs/2026-11-05-post-processing-design.md`.
- Desktop and mobile Web/PWA supported; no native Android work.
- Preserve untracked `.superpowers/`; work on main. Root agent commits/pushes after verification.
- No new dependencies. Preserve legacy routes/orders/backup restore compatibility.

## Task 1: Domain/API and persistence

- [x] Add focused failing tests for actual-output limits, integer reporting, independent bindings, completion gate, rollback, payroll and backups.
- [x] Implement shared exact arithmetic helper `shared/post-processing.js`; migrate route kind, binding coefficient and explicit output completion state. Keep existing additional operation behavior.
- [x] Extend route CRUD/filter/binding validation and production creation/read/report/finish/void/reopen paths in `server/process-routes.js`, `server/production.js`, `server/production-stages.js` and a focused server helper as needed.
- [x] Update backup version/defaults/validation and payroll units. Test all finalization routes including `finish_order` compatibility.
- [x] Run focused Node tests and report interface field names to UI task.

## Task 2: Desktop/mobile UI

- [x] Add failing browser cases for template classification, binding coefficients, progress and disabled finish action.
- [x] Update route editor/list, production create form, progress/quick registration/operation views and completion actions using domain fields from Task 1.
- [x] Add localized labels including per-operation gaps, coefficient explanation, unit 次, explicit output completion confirmation. Preserve existing layout patterns and accessible mobile controls.
- [x] Run targeted browser tests and production build.

## Task 3: Integration, AI and documentation

- [x] Update `server/ai.js` and AI tests for route kind/filter and read-only snapshot fields/rules; no new writable production tools.
- [x] Update production/process route docs; review code independently for spec and quality.
- [x] Run full Node suite, relevant desktop/mobile/PWA Playwright cases, build and git diff checks. Fix findings, then commit and push main.

## Verification record

- Node v24.22.1: full suite 718/718 passed; final registration and localization checks 17/17 passed.
- Chromium: 8/8 cases passed (new post-processing and existing additional operations on desktop, Pixel, iPhone viewport and PWA).
- WebKit: iPhone post-processing flow 1/1 passed.
- Production/PWA build passed; existing bundle-size warning remains.
- Desktop and mobile screenshots inspected; independent backend and UI reviews found no blocking issues.
- AI read-only route queries, coefficient/limit explanations and tests updated; no production write tools added.
