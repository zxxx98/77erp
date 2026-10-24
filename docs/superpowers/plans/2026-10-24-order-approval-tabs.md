# 入出库审批分类 Implementation Plan

> **For agentic workers:** Use subagent-driven-development for isolated queue implementation and final review; integrate and validate the shared workspace in this session.

**Goal:** 桌面和移动 Web/PWA 的确认单不再将普通记录推到页面底部。

**Architecture:** 共享 OrderApprovalWorkspace 管理记录、成品入库、退料入库、领料补料出库分类；既有审批组件显示每页十条摘要，点击后用现有 Modal 的 drawer 模式展示完整单据。沿用服务器接口、权限、版本与确认流程。

**Tech Stack:** React、现有控件和 Modal、Express/SQLite、Playwright。

## Global Constraints

- 用户已批准分类标签、紧凑列表、桌面抽屉/手机全屏详情方案，并要求直接实施更新本地测试环境。
- 在 main 完成；保留本地测试数据库及用户已录入的单据。
- 不改审批记账规则、不增加批量审批、不修改版本号。
- 标签待办数量按当前仓库和权限查询；失败显示未知和重试，不能显示成零。
- 普通记录默认打开；从生产单跳转通过 approval 和 q 查询参数选择目标分类并筛选生产单。
- 每类列表十条，审批后更新计数；末页清空回退一页；保留搜索/状态筛选及错误重试。
- 生产详情内的完整列表继续沿用，不因工作台紧凑展示改变。

## Tasks

- [x] 浏览器测试：独立数据库生成超过十张领料单，证明普通记录不会出现审批卡片、标签计数正确、分页十条、详情审批扣库并刷新数量；覆盖桌面、手机及 PWA。
- [x] 审批列表：ProductionMaterialDocuments / ProductionReceipts 接受 initialQuery，保留导出完整列表组件；增加摘要列表及 Modal 详情，审批成功关闭详情，失败保留输入；使用既有服务端幂等标识和版本。
- [x] 分类整合：新增 OrderApprovalWorkspace，包裹桌面 Orders 和移动 Orders 中普通记录内容，按权限显示计数标签并只渲染当前分类。记录分类保持原查询和导出功能。
- [x] 跳转：App.navigate 保留审批分类/搜索参数，Production 的领料、退料、成品审批入口带上分类及生产单号；刷新和浏览器返回恢复 URL 分类。
- [x] 更新现有生产审批流程浏览器测试，覆盖抽屉明细、退料与成品分开、确认和取消、失败、无权限、不同仓库和末页回退。
- [x] 运行生产领料/成品 API 测试、相关浏览器测试、构建与设计扫描；渲染检查桌面和手机；保留测试数据并更新 localhost:3201 静态构建。
- [x] 审阅最终差异、检查 AI 助手同步范围（本次无 schema/写操作变更），交付分支为 main。

## Validation commands

使用本机 bundled Node 24（系统 Node 22.14 缺少 sqlite.backup）。

```powershell
& 'C:\Users\xiaodi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests/production-materials.test.js tests/production-receipts.test.js
& 'C:\Users\xiaodi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' node_modules/@playwright/test/cli.js test tests/browser/order-approval-tabs.spec.js tests/browser/production-materials.spec.js
npm run build
git diff --check
```

浏览器测试使用独立数据库；现有 3199 测试服务占用时另用独立配置跳过全局 webServer，保留每个测试自身的内存服务。

## 验证记录

- 生产领料/成品入库 API：27 项通过。
- 分类、审批、手机返回、错误恢复、权限与 PWA 浏览器流程：10 项通过。
- 普通开单、扫码、库存与移动页面回归：6 项通过。
- 新增测试先在旧界面验证失败；移动返回键问题也已验证失败后修复通过。
- 构建成功；设计扫描无问题；独立代码审阅的返回键和安全区问题已修正并复查。
- localhost:3201 桌面和手机页面已读取新版分类，业务测试数据保留。
- AI 助手无需同步：接口、业务字段、校验及写操作未变。

