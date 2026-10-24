# Production groups and restricted production work

> **For agentic workers:** Use subagent-driven-development and tests-first implementation. User approved continuing production groups/dispatch and adding “仅生产作业”.

**Goal:** Optional employee group membership, production dispatch, own-group registration and an isolated production-only workspace while warehouse approvals remain across groups.

**Architecture:** Keep existing `production` permission as full management/all orders for compatibility. Add `production_register` for own-group list/detail/batch registration only. `positions.access_mode` is `standard` (existing behavior) or `production_only` (requires exactly `production_register`). Group membership grants no permissions by itself. Admin always has full access.

**Stack:** Express, SQLite, React; desktop Web and mobile Web/PWA.

## Global constraints and interfaces

- Existing employee/position permissions remain unchanged. A transactional startup migration `production_groups_v1` creates group schema once. Employees and old orders initially have null groups. Do not re-run employee_positions_v1.
- `production_groups`: id, unique name (1–60 chars), description (max 200), version, created_at, updated_at. `users.production_group_id` nullable single group. `production_orders.production_group_id` nullable group; `production_group_name` snapshot text default ''. `production_batches` add `created_by`, `production_group_id`, `production_group_name` snapshots; preserve its existing `created_by_name`.
- Shared exports `isProductionOnly(user)` and `canViewProduction(user)`. Public user includes access_mode, production_group_id, production_group_name. hasPermission defensively limits production_only users to production_register.
- Group routes GET/POST /api/production-groups, PUT/DELETE /:id. GET admin/full production manager; writes admin only. Editing/deleting requires version. Cannot delete groups referenced by employees or production orders. PUT /api/users/:id/production-group accepts {production_group_id: null|id, version: permissions_version}. Creating user accepts optional production_group_id. Membership change bumps permissions_version and audits.
- POST /api/production-orders/:id/assign accepts {production_group_id:null|id, version, request_id, schema_version:2}; full production management only, before any start/activity. Creation may accept group. Assignment invalidates member permission versions of old/new groups. No automatic legacy order assignment.
- Registration-only workers see only orders where group_id equals current employee group (ungrouped sees none); cannot create/edit/start/request materials/finish/void/delete/assign. POST :id/complete permits batch registration with finish_order:false only. Authorization must precede request replay lookup. Warehouse purchase/sale approvals remain independent and cross-group.
- listProductionOrders(db, warehouseId, query={}, costs=false, user) and getProductionOrder(db,warehouseId,id,costs=false,user) accept optional user for scoped external reads; internal existing calls may omit user only after route authorization. AI callers must supply user.
- Restricted routes: auth status/password/logout; GET workspace/style/updates; GET production-orders list and numeric detail; POST numeric production-orders/:id/complete. All other API business routes deny. Workspace supplies minimal bootstrap (no categories, business/financial settings, stock expressions); details contain material identity and production quantities, no raw inventory/cost data. Static upload route must be considered.
- Position/group/order permission changes must clear stale UI production views even when editing; server always rechecks. AI context versions invalidate on membership/dispatch changes. Backups never bind cross-instance group/user IDs accidentally.
- Preserve unrelated tests/browser/bom-navigation.spec.js and product-production-type.spec.js changes. No version bump. Root handles final commit/push to main.

## Task 1 — organization/auth foundation (root)
- [x] Write/run failing migration, group CRUD/membership, position mode and API isolation tests in tests/production-groups.test.js.
- [x] Implement shared permissions, server/production-groups.js, server/positions.js, auth.js, minimal workspace and data revision support.
- [x] Verify migration rerun and old permissions preservation; keep explicit route inventory tests current.

## Task 2 — production scope/dispatch (production agent)
Ownership: server/production.js, production-materials.js, production-receipts.js, optional server/production-access.js, tests/production-group-orders.test.js. Root supplies schema via migration; do not edit shared/auth/schema group module.
- [x] Tests-first cross-group list/detail/register denial, ungrouped empty, warehouse approvals across groups, dispatch concurrency/start restrictions and replay revocation.
- [x] Implement scoped queries and pre-replay checks; dispatch endpoint; actor/group batch snapshots; restricted material projection. Include group names in approval list/detail when useful.
- [x] Verify existing production/receipt/material tests and own tests with Node24. Report API/interface decisions and any dependencies in local ignored report.

## Task 3 — desktop/mobile UI (UI agent)
Ownership: src/** except AiAssistant.jsx; tests/browser/production-groups.spec.js. No unrelated files.
- [x] Read applicable impeccable skill and existing patterns. Add group configuration in settings, nullable employee group select/create input, position access_mode selection with strict permission enforcement.
- [x] Managers dispatch draft orders to group. Group registrants get list/detail/register only, no management actions; batch form never finishes order. Show group and registration actor.
- [x] Production-only shell on desktop/mobile/PWA offers own-group orders, own password/logout and required warehouse context; no business navigation/AI/scanner/announcements. Clear stale views on authorization version changes.
- [x] Build and add/run meaningful browser coverage desktop+mobile with isolated server fixture. Document testing results.

## Task 4 — AI and backup integration (integration agent)
Ownership: server/ai.js, src/AiAssistant.jsx, server/operations.js, server/product-history.js, tests/ai.test.js, tests/operations.test.js (or new scoped test).
- [x] Ensure production_register users with AI in standard mode cannot query other-group production via tools; supply user to scoped query functions; permissions digest includes group/mode/version. Production-only has no AI.
- [x] Update business backup format as required for nullable group and actor snapshots; cross-instance restore clears association IDs and preserves historical names; same-instance resolve existing IDs. Validate schema and legacy compatibility, full DB remains complete.
- [x] Review product history leakage: registration-only must not accidentally get other-group production entries; standard baseline other business reads remain intentional.
- [x] Run targeted tests and report.

## Final verification
- [x] Full Node24 test suite, production build, relevant browser desktop/mobile/PWA tests.
- [x] Independent security/spec/code review; fix substantive findings and recheck.
- [x] README usage/migration instructions, final git diff check; commit/push main preserving unrelated changes.

## Verification record

- Node 24: 511/511 tests passed with test concurrency 4. A prior default-concurrency run encountered two transient local fetch bad-port errors; the complete reduced-concurrency rerun is clean.
- Production Vite/PWA build passed, 110 precache entries.
- Browser: 12/12 user/position/group cases passed; final new-group rerun 4/4 passed, including mobile and service worker.
- Independent review approved after legacy-stock error disclosure and restricted-bootstrap financial settings were corrected.
- AI synchronization checked: scoped queries, authorization context and regression coverage updated; no new AI mutations introduced.
