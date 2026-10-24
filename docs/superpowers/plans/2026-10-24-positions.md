# 岗位配置与一次性迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 配置岗位权限、员工选岗，并在首次部署启动时安全迁移现有员工，后续不重复迁移。

**Architecture:** 独立 server/positions.js 负责岗位数据、一次性事务迁移及管理路由；auth 解析岗位有效权限，客户端继续使用既有 permissions / legacy_permissions / permissions_version 合约。岗位变更递增成员授权版本，复用用户修订通知和 AI 授权上下文。

**Tech Stack:** React、Ant Design / Ant Design Mobile、Express、Node SQLite、node:test、Playwright。

## Global Constraints

- 遵循已确认 docs/superpowers/specs/2026-10-24-positions-and-production-groups-design.md 第一阶段。
- 一人一个岗位；本次不实现生产组和生产派单。
- 桌面 Web、移动 Web / PWA；main 直接提交推送，无新依赖。
- 使用 Node 24：C:/Users/xiaodi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe。
- 子任务不提交；主任务验证整合后仅提交本任务文件。

## Task 1: 迁移、岗位服务与授权

**Files:** server/positions.js（新增），server/auth.js，server/data-updates.js，tests/positions.test.js（新增）。

**Interfaces:**

```js
// GET /api/positions -> Position[]
// POST /api/positions {name, description, permissions} -> Position (201)
// PUT /api/positions/:id {name, description, permissions, version, convert_legacy?} -> Position
// DELETE /api/positions/:id {version} -> {ok:true}
// Position: {id,name,description,permissions:string[],legacy_permissions:boolean,version,member_count,created_at,updated_at}
// POST /api/users 增加 position_id；employee 必填，admin 不使用。
// PUT /api/users/:id/position {position_id,version: user.permissions_version} -> {ok:true}
// PUT /api/users/:id 管理员降为员工时必须携带 position_id；其他更新保留岗位。
// GET /users、auth/session、workspace.user 增加 position_id 和 position_name。
// PUT /users/:id/permissions -> 409 已改为岗位授权，请刷新后修改岗位。
```

- [x] 写旧 SQLite fixture 和 API 测试，观察岗位接口缺失导致失败。
- [x] 在 auth 完成旧 users/administrator 升级后运行岗位迁移。BEGIN IMMEDIATE 内建表/加列、按规范化权限加兼容标记分组、关联、逐人核对、写 app_metadata employee_positions_v1 完成标记；失败 ROLLBACK。检测标记后不重跑迁移。
- [x] 默认创建只读岗位供新账号选择；已有空权限员工复用。非法旧权限数据阻止迁移，不默默扩权/丢权限。
- [x] publicUser 从关联岗位解析权限；缺失岗位为空权限且非 legacy。保留 users.permissions 仅做迁移核对，变更后不再参与授权。
- [x] 新增岗位 CRUD 与换岗，校验名称、权限、版本、成员保护；标准岗位编辑不能伪造 legacy，迁移 legacy 转标准需 convert_legacy:true。
- [x] 岗位写入和成员版本变更、审计、通知同事务；角色变更保留最后管理员保护并清理岗位。positions 数据修订走 global，users 更新走用户范围。
- [x] 运行 tests/positions.test.js，确认首次迁移分组正确、重启不恢复旧权限/重建已删岗位、失败整体回滚、已有会话权限更新、越权被拒绝、版本冲突和有成员删除被阻止。

## Task 2: 岗位界面及员工选岗

**Files:** src/Positions.jsx（新增）、src/Users.jsx、src/users.css、src/features/Settings.jsx、src/LazyComponents.jsx、tests/browser/positions.spec.js（新增）。

**Consumes:** Task 1 API；业务权限选项来自 shared/permissions.js。

- [x] 新增浏览器场景：先在岗位配置创建“仓管”并配置入出库，再在用户管理创建员工选择该岗，检查只读权限；共享岗位编辑影响另一成员；手机也能完成流程。
- [x] 实现岗位列表、编辑表单、权限勾选、人数和删除操作；显示保存影响人数；旧权限明确说明并提供显式切换确认。
- [x] 新建员工必须选岗；角色降级需要先选岗；账号行显示岗位和只读权限详情，不再个人改权限。
- [x] 沿用桌面/移动控件及设置导航，桌面表格/窄屏卡片、按钮不拆字；服务端冲突保留用户输入并允许刷新重试。
- [x] 运行浏览器场景、截图检查桌面和 390px/320px 手机，确认无溢出和动作可用。

## Task 3: 回归与 AI 同步

**Files:** tests/helpers/positions.js（新增测试工厂，如需要），现有 tests 中用户工厂及旧个人授权调用，tests/browser/users.spec.js，tests/ai.test.js，src/AiAssistant.jsx（文案），server/ai.js（仅有必要时）。

**Produces:** 所有测试通过真实岗位接口授权；专门旧数据测试仍直接构造旧数据库。

- [x] 将普通测试工厂中的新建员工改为先创建/选择岗位；测试授权改为编辑岗位或换岗，不继续调用已停用个人权限接口。
- [x] 旧员工回归 fixture 使用明确 legacy 岗位，避免用 users.permissions 写入来模拟已迁移员工。
- [x] AI 测试覆盖岗位权限撤回、同权限换岗导致旧授权上下文失效，待确认操作不能执行。
- [x] 更新用户管理浏览器测试使用岗位路径，保留启停、密码、账号保护和业务权限断言。
- [x] 运行完整 node:test；构建后运行用户、岗位、移动相关浏览器测试（可独立测试配置避免占用已有 3199 服务）。

## Task 4: 审查与交付

- [x] 独立审查迁移幂等性、事务回滚、越权、旧权限不扩大、并发版本、账号/业务恢复隔离及 AI 上下文。
- [x] 处理审查发现并重跑受影响测试；git diff --check；确认无其他任务文件混入。
- [x] 准备按 main 直接提交推送交付；提交及推送结果以 Git 记录为准，交付说明包含自动一次迁移、入口和验证结果。

## Progress

- Task 1–3 已完成；独立代码审查未发现阻塞问题。
- 最终 Node 24 完整测试 499/499 通过；岗位浏览器 5/5、用户回归 3/3、移动/PWA与模式权限检查 5/5 通过。
- 生产构建及 PWA 生成通过，桌面/390px/320px 截图已检查，机械设计扫描无发现。
- 迁移额外覆盖已有会话与旧数据修订触发器、故障回滚、重启不重建已删岗位、业务恢复隔离及异步建用户时的岗位删除竞争。
