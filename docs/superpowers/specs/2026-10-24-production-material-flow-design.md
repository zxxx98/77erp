# 生产领料、登记与退料

用户于 2026-10-24 确认：整单一次领完，后续独立补料与退料。桌面 Web、移动 Web/PWA 同步交付。

## 流程与库存

- 新生产单保存为待生产；开始生产生成待批准的生产领料出库单，生产单为待领料，显示“请前往仓库领料”。草稿和待批准单均不预留、不扣库存。
- 仓库人员在出库页面批准并确认整单出库，原子扣除材料数量与库存成本，生产单成为生产中。新流程只有生产中可以登记。
- 登记保存本批合格成品、实际耗料与废料。材料从本生产单已领未耗余额消耗，不再次扣仓库库存；按剩余材料池成本比例转入成品成本。
- 补料另生成待批准出库单。退料另生成待批准入库单，仓库确认时增加仓库库存并退回材料池成本。确认时重新校验已领未耗未退数量，禁止超额退料和耗料。
- 待批准单可取消；首次领料取消后回到待生产，可重新开始。每张生产单同一时间仅一张待批准材料单，避免用户误提交重叠申请；正常生产登记不被补料申请阻断，但确认退料时必须重新核对余额。
- 已完成单仍允许退还剩余材料；不允许继续补料。结束时不能存在待批准单，剩余材料在详情明确显示并支持后续退回。
- 新流程作废登记批次仅把耗料和原成本退回生产材料余额，不能直接退仓。整单作废前须作废所有有效批次、取消待批准单并通过仓库退回全部材料。历史单沿用原规则。

## 数据与接口

为避免混入交易统计，生产材料单使用独立的 production_material_documents / production_material_document_items 表，统一显示在入库/出库页面的“生产领料 / 生产退料”区域。保存关联生产单号、材料快照、数量、成本、申请人、确认人、时间、状态及版本。不是销售、采购或应收应付。

生产单新增 material_workflow（旧数据为 0，新建为 1）及持久化领料阶段；现有生产状态兼容映射为 draft / awaiting_materials / in_progress / completed / void。生产详情附 material_documents，每项材料附 issued_quantity、returned_quantity、available_quantity、available_cost_cents；耗料沿用 actual_quantity。

- POST /production-orders/:id/start：version、schema_version；返回生产详情。
- POST /production-orders/:id/material-requests：version、schema_version、type（out 补料 / in 退料）、items（product_id、quantity）、note；返回生产详情。
- GET /production-material-documents?type=in|out&status=all|pending|confirmed|cancelled&q=&offset=0&limit=20：返回 documents、total、has_more；记录含 items、production_number、product_name、unit、production_id。
- POST /production-material-documents/:id/confirm 或 /cancel：version、request_id；返回更新后的材料单。取消需 reason。
- 现有 /complete、/finish、批次 /void 等接口按 material_workflow 分流；旧客户端不能绕过新单领料校验。

所有写操作事务化、幂等、版本检查；数量保持四位小数及物料整单位规则。库存、成本不足，物料停用、单位变化、跨仓、越权均拒绝。

## 权限、界面与兼容

沿用 purchase 入库、sale 出库权限键，显示名改为“入库”“出库”。生产权限可申请领料、补料、退料，不能代替仓库批准；仓库相应方向权限可查询和确认，无须生产权限。取消可由生产权限或对应仓库权限执行。成本仅 finance 可见，含所有新嵌套字段。

采购入库、销售出库页面与入口统一命名为入库、出库。普通交易保留原有行为；生产材料单有独立类型和状态，不进入普通销售收入、采购额、结算、退货接口。登记完工按钮改名登记，生产详情显示材料余额和关联单据。

旧数据、备份恢复、重置清理、删除引用及更新通知覆盖新增表；AI查询识别新状态及数量，说明领料扣库、登记消耗已领材料，AI不自动批准或执行生产写操作。

## 验证

API测试覆盖状态迁移、幂等、权限隔离、成本守恒、并发过期版本、库存不足原子回滚、补退料、批次撤销、旧流程、备份往返。浏览器覆盖桌面与手机：开始生产、出库审批、登记、退料、权限可见性、响应式无横向溢出。运行全部 Node 测试、构建及相关 Playwright 测试。
