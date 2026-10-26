# Process graph gestures implementation plan

> Use executing-plans to implement the following steps in this session.

**Goal:** Directly create connected operations from node handles, create independent nodes from the canvas menu, and insert operations from an edge menu.

**Architecture:** Keep graph mutations in a small pure client helper. ProcessGraph owns transient gestures and menus; ProcessRoutes applies each request atomically and selects the new operation. Existing API, validation, and read-only consumers stay compatible.

**Tech Stack:** React, pointer events, SVG, existing CSS and i18n catalogs, Node tests, Playwright.

## Constraints

Work on main as requested by AGENTS.md; preserve existing .superpowers files. Cover desktop, mobile Web and PWA. No new dependency or version bump. Check AI synchronization before commit: graph schema and AI read-only tools remain unchanged.

## Tasks

- [x] Add `tests/process-graph-editing.test.js` for predecessor/successor direction, edge replacement, independent placement, collision avoidance and limits. Run `node --test tests/process-graph-editing.test.js` and observe missing implementation failure.
- [x] Implement `src/features/process-graph-editing.js`: `addProcessNode(graph, node, {anchorId, direction, edge})` returns an immutable updated graph, keeps other edges and enforces size limits; clamp coordinates and avoid overlap.
- [x] Add browser scenarios in `tests/browser/process-routes.spec.js` for graph gestures, menu insertion and persistence. Run the desktop scenario before UI implementation and observe missing handle failure.
- [x] Implement pointer gestures in `src/features/useProcessGraphGestures.js` and an accessible context menu in `src/features/ProcessGraphMenu.jsx`; wire both into `src/features/ProcessGraph.jsx`. Capture drag pointer, preview without mutating graph, commit on valid release only; cancel gestures and timers on dismissal/unmount. Add expanded invisible touch targets around visible circular handles and SVG hit paths.
- [x] Wire `onCreate` in `src/pages/ProcessRoutes.jsx`, including busy guards, atomic graph update, new selection and connection mode reset. Translate hints/menu/handle names and limits in `src/i18n/catalogs/process-routes.js`; update `src/features/process-routes.css` and `docs/features/process-routes.md`.
- [x] Run focused Node tests, full process-route browser tests, production build, AI tests and i18n tests with Node 24. Inspect desktop/mobile screenshots, run the UI detector and review diff. Delivery follows the repository's main commit/push convention.

## Runtime

Use `C:/Users/xiaodi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`; put its directory first in PATH for Playwright's webServer build. The system Node 22 lacks the SQLite backup export required by the existing server.

## Review fixes

- Kept old compact layouts interactive by narrowing overlapping handle targets; auto arrange now prefers 240px columns and 140px rows.
- Bounded automatic column spacing by maximum route depth; a 50-node chain still passes route validation after arrangement.
- Limited editable node names to two display lines and reserved 124px vertical separation; full name remains in the inspector and title.
- Kept a 24px boundary margin for complete handles. Added browser coverage for compact ports, long names, cancellation, scrolling and read-only production graphs.

## Verification results

Node 24 full suite: 624 passed. Process-route Chromium suite: 26 passed. Final targeted recheck: 8 Chromium and 7 WebKit passed. Vite/PWA production build passed. UI detector returned no findings; desktop/mobile renders inspected. AI tools and saved graph schema remain unchanged.
