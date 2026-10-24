# Production Stage Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在同一生产单内登记子 BOM 的产量、直接投入与进度，半成品只在单内流转。

**Architecture:** 现有根层批次、材料审批与成品入库继续使用。新增层级批次、直属投入及来源分配账，根层完工保存原料追溯投影，材料池只减各层直接投入。分层服务独立于页面；桌面、手机/PWA 和扫码入口使用同一组件。

**Tech Stack:** Node.js、SQLite、Express、React、现有控件、node:test、Playwright。

## Global Constraints

- 按已批准的 `docs/superpowers/specs/2026-10-24-production-stage-registration-design.md` 实现。
- 半成品留在本单供上层使用，不进入仓库库存。
- 桌面 Web、移动 Web 和 PWA 使用相同规则。
- 不自动推算旧单历史进度；未开工无作业记录的旧多层草稿可显式启用。
- 原材料仅消耗一次；成本与数量逐笔守恒；上层依赖阻止下层作废；有半成品结余不能结束。
- 使用 main；保留原有未提交的两个浏览器测试文件，不把它们混入提交。
- AI 生产操作保持只读；后台逐请求检查岗位、仓库、组、版本和幂等权限。

## Task 1: 分层核算服务及 API

**Files:** 新建 `server/production-stages.js`、`shared/production-stages.js`、`tests/production-stages.test.js`；修改 `server/production.js`、`server/production-materials.js`、`server/app.js` 必要权限入口。

**Interfaces:**

生产详情返回 `stage_workflow: 1` 与 `stages`，每层 `{path,parent_path,product_id,name,unit,unit_round_up,planned_quantity,completed_quantity,consumed_quantity,available_quantity,available_cost_cents,items}`。
`items` 保存直属 BOM 节点 `{path,product_id,name,unit,unit_round_up,usage_mode,quantity,quantity_fraction,loss_rate,bom_base_quantity,loss_method,available_quantity}`。
各层读写使用路径 body/query 参数，根层 `path: ''`。所有新写请求包含 `stage_schema_version: 1`、`schema_version: 2`、`version`、`request_id`。

```js
// POST /production-orders/:id/stages/complete
{path:'1',completed_quantity:12,items:[{path:'1.1',quantity:36,variance_reason:''}],scraps:[],note:'',finish_order:false}
// GET /production-orders/:id/stages/batches?path=1&offset=0&limit=20
// => {batches:[{id,path,batch_number,completed_quantity,status,created_by_name,created_at,note,items,total_cost_cents,root_batch_id}],total,has_more}
// POST /production-orders/:id/stages/batches/:batchId/void
{reason:'登记错误'}
// POST /production-orders/:id/stages/enable
// => fresh production detail; accepts only untouched material_workflow=1 drafts
```

- [x] 先写 A→B→C 真 API 测试，断言分层标志与层级；`node --test tests/production-stages.test.js` 观察新功能缺失失败。
- [x] 实现迁移、快照派生、输入校验、单内批次、FIFO 分配和成本组成。用版本事务覆盖创建、读取、登记、根层投影、作废、结束和删除。
- [x] 增加无半成品拒绝、余额超额、重复提交、原料只耗一次、依赖回退、成本尾差、多层多路径和旧单保护测试。示例核心断言：

```js
assert.equal(order.stages.find(s => s.path === '1').available_quantity, 2);
assert.equal(order.items.find(i => i.product_id === rawId).available_quantity, 24);
assert.equal(order.completed_quantity, 5);
assert.equal(stock(halfId).stock, 0);
assert.equal(order.receipt_documents.length, 1);
```

- [x] 运行新测试及 `node --test tests/production-materials.test.js tests/production-receipts.test.js tests/production.test.js`，兼容回归 fixture 明确保留旧语义。

## Task 2: 桌面、移动与扫码分层登记

**Files:** 新建 `src/features/ProductionStages.jsx`、`src/features/production-stages.css`、`tests/browser/production-stages.spec.js`；修改 `src/pages/Production.jsx`、`server/production-pdf.js`。

**Interfaces:** 使用 Task 1 返回字段与端点；导出 `ProductionStages({order,data,canRegister,canVoid,management,busy,onSaved,onBack})`，请求使用既有 `send` 自动幂等。组件自己管理层选择、表单、历史和作废，保存通过 `onSaved(order,message)` 刷新主详情。主页面分层单登记/扫码转到此组件；旧单入口不变。

- [x] 增加桌面和手机尺寸浏览器流程测试：建立主子 BOM、开工审批、登记 B、登记 A、检查 B 剩余及 A 待入库；先运行确认入口缺失。
- [x] 直属投入用标准计算带出，字段同时展示可用余额；通过现有表单及按钮实现提交校验、错误和离开确认。根层可登记继续或结束，半成品只登记继续。
- [x] 加入路径、进度、批次分页、依赖错误与作废理由；扫码保留层选择，PDF 文案同步。
- [x] 用 `npx playwright test tests/browser/production-stages.spec.js` 验证两端流程和无横向溢出；执行 `npm run build`。

## Task 3: 备份恢复、权限和 AI 同步

**Files:** `server/operations.js`、`server/data-updates.js`、分层备份校验模块、`server/ai.js`、`tests/ai.test.js`、`tests/production-stages.test.js`。

**Interfaces:** 新增层级表加入 `productionTables`；版本 38 业务备份；小于 38 的备份填入空层级表和 `stage_workflow=0`。API 与材料余额使用同一分层校验。

- [x] 写备份往返、旧备份导入、恶意分配跨单/超量/错误成本拒绝测试，观察缺口。
- [x] 同步引用清理、外键顺序、跨实例人员身份清除与更新推送；校验来源关联、根层投影、余额及金额守恒。
- [x] AI 查询解释分层数量、单内余额、根层产量和原料使用口径，新增真实返回测试，确认不扩大写权限。
- [x] 验证登记岗位的端点白名单、跨组/仓拒绝与嵌套成本过滤。

## Task 4: 集成审阅与交付

- [x] 执行 `npm test`、`npm run build`、生产/BOM/扫码相关 Playwright 测试；处理有证据的回归。
- [x] 独立代码审阅数量成本守恒、作废依赖、旧单兼容、权限、备份、两端交互；修复重要问题并重跑相关测试。
- [x] 更新生产文档、设计状态与本计划复选框，检查 AI 同步范围；`git diff --check`。
- [x] 仅暂存本功能文件，提交 main 并推送 origin/main，报告测试结果及限制。

## 验证记录（2026-10-24）

- 使用 Node 24.19；系统 Node 22.14 缺少现有完整备份测试所需的 `node:sqlite` 导出。
- 全量 API / 单元回归共 541 项：535 项首次通过，6 项在创建测试服务时遇到本机随机端口 `bad port`，未进入业务断言；逐项重跑这 6 项全部通过。未更改系统动态端口配置。
- 分层账及标准计算定向测试 20/20 通过；AI 全文件 54/54 通过。
- 生产、领退料、班组、BOM、扫码、PDF、PWA 浏览器回归 61/61 通过；前端修复后新增分层与扫码生命周期合计 13/13 通过。WebKit 手机管理及生产登记岗位 2/2 通过。
- 最新 Web / PWA 构建成功；仅保留既有大包体积提示。`git diff --check` 通过。
- 独立前端复核确认扫码跨单重置、请求期间编辑保护、旧作废入口及入库权限四项修复；整体验证复核确认备份按原始 FIFO 数量、成本、原料组成回放，合法撤销后再使用仍可恢复，5 项独立定向测试通过。没有未处理的重要问题。
- 迁移使用 SAVEPOINT，失败恢复全部 DDL，外层事务保持；累计标准按有效层级产量一次重算，六位标准展示与四位实际默认值分别处理。
- AI 工具描述与查询解释、返回测试同步。`src/AiAssistant.jsx` 无新增写动作或动作卡字段，不需修改。
- 业务备份升级为格式 38；应用版本保持 1.15.21，不打发布标签。
- 用户要求关闭的本地 3201、3202 环境已停止并复查。自动化用例使用临时内存库及临时服务，结束后清理。