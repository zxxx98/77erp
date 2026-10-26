# BOM process overview implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for isolated API implementation and review; integrate the shared UI in this session. Track each task below.

**Goal:** Show grouped parent/child routes in BOM and immutable production progress overviews.

**Architecture:** Read-only warehouse-scoped BOM endpoint returns layers and route definitions. A shared pure model normalizes production snapshots and lays out grouped graphs; a shared React view handles scope, search, zoom and responsive lists. Existing registration screens remain responsible for mutations.

**Tech Stack:** Existing React, Express, SQLite, node:test and Playwright; no new dependencies.

## Global constraints

Keep main and preserve `.superpowers/`. Cover desktop, mobile Web and PWA. Supply edges target group inlets and impose no execution rules. Current BOM data and immutable production data stay separate. No schema migration or version bump. Chinese/English/Vietnamese copy. Inspect AI explanation before commit.

## Task 1 — read-only BOM model and API

Files: `server/bom.js`, `tests/process-routes.test.js` (or dedicated overview tests).
Interface: `GET /api/boms/:id/process-overview` returns `{bom_id,layers}`. Each layer contains `path,parent_path,name,barcode,bom_id,bom_name,unit,enabled,product_active,route_source,route,materials`; route is null or `{id,name,version,enabled,graph}`, source is `bom`/`product`/null. Materials are direct stock inputs with name/unit/quantity. Root path is empty, parent null. Repeated references use distinct paths.

- [ ] Add HTTP tests expecting the endpoint, default/override, stock exclusion, inactive/missing route, permissions and warehouse isolation. Run `node --test tests/process-routes.test.js`, observe missing endpoint failure.
- [ ] Reuse `buildBomNodes(...,{availability:false,scrapRules:false})`, cached `getBom`, a read transaction and existing BOM route permission wrapper. Validate all graphs, fail if configured binding is missing or belongs to another warehouse; never return partial success.
- [ ] Run API tests including cycle/capacity and repeated reference coverage; review against interface.

## Task 2 — pure shared overview model

Files: `shared/process-overview.js`, `tests/process-overview.test.js`.
Interfaces: `productionOverviewLayers(order)` maps immutable stages/routes; `layoutOverview(layers)` returns group rectangles, positioned operation nodes and supply edges. `overviewScope(layers,scope,query,page)` returns a bounded subset for both views.

- [ ] Write tests for repeated node IDs, parallel edges, supply targets, missing routes, immutable production values and bounded large views. Run `node --test tests/process-overview.test.js` and confirm failure before implementing.
- [ ] Implement pure functions using existing graph validation/arrangement. Keep operation IDs qualified by path, preserve original IDs for selection, retain per-layer units and final output totals.
- [ ] Run model tests and review graph semantics.

## Task 3 — shared UI and entry points

Files: `src/features/ProcessOverview.jsx`, `src/features/process-overview.css`, `src/pages/Bom.jsx`, `src/pages/Production.jsx`, `src/features/ProductionStages.jsx`, `src/i18n/catalogs/process-routes.js`, `tests/browser/process-routes.spec.js`.

- [ ] Add browser checks for BOM list/edit entry, immutable production overview and entering/returning from a layer, graph/list toggle, search, zoom and mobile overflow. Run focused Playwright tests and observe absent controls.
- [ ] Add grouped graph with real internal edges and dashed supply edges, per-layer list, selection details, branch navigation/collapse, bounded rendering, explicit search/paging, localized labels and accessible buttons.
- [ ] BOM list opens a read-only view using useQuery; editor opens saved view only when clean and retains editor state on return. Production uses saved snapshots and opens existing layer registration, preserving overview on return.
- [ ] Run desktop/iPhone/Android/PWA scenarios, inspect screenshots and adjust layout once for observed issues.

## Task 4 — integration, documentation and delivery

Files: docs/features/process-routes.md, docs/ai-assistant.md and server/ai.js explanation if relevant; existing tests/ai.test.js only if explanation contract changes.

- [ ] Inspect AI tool schemas and explain the new read-only UI without claiming new AI writes.
- [ ] Run full `npm test`, `npm run build`, focused browser tests and design detector. Record actual counts and any engine limitation.
- [ ] Review final diff for permission/warehouse/snapshot safety, rendering limits and requirement coverage; fix concrete findings and recheck affected tests.
- [ ] Commit only task files on main and push origin/main per repository instruction; verify status and remote equality.
