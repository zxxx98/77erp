# Production PDF and scan registration implementation plan

> Use subagent-driven-development to implement and review the independent PDF and registration UI tasks.

**Goal:** Download an A4 production order PDF with a QR link that lets authorized workers open the existing registration form on desktop, mobile Web and PWA.

**Design:** Server PDFKit rendering with an embedded, redistributable Chinese font and a QR code; existing authenticated production reads determine visibility. QR links carry instance, warehouse, numeric order ID and immutable order number. The frontend resolves the current order, validates identity and authorization, then opens registration only when its current state permits it. QR codes never submit a registration or confer permissions.

## Global constraints

- Desktop Web, mobile Web and PWA must work; no native client work.
- Existing production group scoping and warehouse approvals remain authoritative. Workers see only their assigned group; employees with no group cannot open group orders.
- PDF is a production task sheet: warehouse, order number, assigned group, product/code/spec/unit, BOM snapshot reference, planned output, planned material requirements/material notes and order notes. Per user correction, exclude progress, completed/received/pending quantities, actual consumption, issued/remaining balances and registration history. Costs, selling prices and general inventory balances are excluded. Mark void records clearly. Include export time, page numbers and scanning instructions.
- A4 portrait, embedded Chinese font, repeat table headings on continued pages, wrap long content, QR with white quiet zone. No silent omission of long notes or rows.
- PDF export is read-only and uses latest saved data. GET `/api/production-orders/:id/pdf?origin=<browser origin>` returns an attachment PDF with private no-store caching; validate origin input and never fetch it.
- Shared helper contract: `productionRegistrationUrl({origin, warehouseId, orderId, number, sourceId})`; `parseProductionRegistrationUrl(value, {origin, sourceId} = {})` returns `{warehouseId, orderId, number, sourceId}` or throws a Chinese validation error. URL format `origin/?warehouse_id=W#production?register=I&warehouse=W&number=N&source=S`. Strict positive IDs, UUID source, HTTP(S) origin without credentials. Parser rejects foreign origins/instances when expected values supplied.
- Opening a link while logged out preserves destination through login. Switching warehouse must synchronize workspace and requests. Check source and order number before opening; deleted/reused IDs or foreign-group orders show a clear error. Ineligible order states show detail and a reason. No automatic writes.
- Add “扫码登记” to the production list and “导出 PDF” to detail. Reuse CameraScanner and support scanner keyboard input / pasted QR link. Preserve dirty-form protection and handle camera unavailability without trapping the user.
- Export link uses the browser's access origin; explain that phones must be able to reach that address. Do not reset the user's demo environment.
- Preserve unrelated modifications in tests/browser/bom-navigation.spec.js and tests/browser/product-production-type.spec.js.
- Check AI compatibility: no new business write operation or field; existing AI read and scope logic should remain unchanged.

## Tasks

- [x] PDF/server: install pdfkit/qrcode, bundle licensed Noto Chinese font in server assets, implement renderer and protected endpoint, allow strict workers scoped PDF reads, write API/security/layout tests.
- [x] QR/frontend: shared helper with unit tests, PDF download handling, scan modal and deep-link resolution through login/warehouse changes, desktop/mobile/PWA tests.
- [x] Integration: render sample and long PDFs, decode QR from actual PDF rendering, browser flow and permission regression checks. Run server tests and build; inspect desktop/mobile behavior. Review diff and fix important findings.
- [x] Finish: prepare local preview using a copy of existing test data, document usage/AI check, deliver scoped changes on main.

## Verification

- Node 24 server suite: 521 passed; production PDF includes seven rendering/authentication/permission regressions.
- Browser suite: 17 passed across production groups, PDF download, real decoder with a generated camera stream, desktop/mobile/PWA, login continuation, warehouse switching and dirty-form protection.
- Build succeeded. PDF rendering checked visually; the rasterized QR decodes to the expected instance/warehouse/order identity. Long notes and the final material row survive pagination; continued pages repeat the order number.
- Review fixed QR overflow for long void reasons, page footer overflow, rows split without identity, expired-login destination loss and delayed scan responses overwriting edits.
- AI check: no business fields or write APIs changed; existing AI production reads and authorization tests pass.
