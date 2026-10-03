# 77 ERP · 轻量进销存

中文、单仓库的本地进销存系统。React + Vite，Express + SQLite，Node.js 22.13 或更新版本。

## 安卓端

提供 Android 12（API 31）及以上的 **ARM 64 位（arm64-v8a）**客户端。从 1.1.0 开始使用 **React Native 原生界面 + Hermes**，不嵌入 Web 页面。可配置服务器地址，复用现有账号和库存，支持商品编辑、库存预警、原生摄像头扫码、多商品入出库、历史单据和商户设置。数据保存在服务器，使用时需要联网。

安卓端沿用 Web 的蓝色、灰白背景和卡片样式，使用原生底部导航、列表、表单与弹窗。CSV / SVG 下载、桌面表格和键盘快捷操作保留在 Web 端。原生页面代码随 APK 发布，不受服务器前端更新影响。

推送与 `package.json` 版本一致的 `v1.0.0` 类标签后，由 GitHub Actions 编译并发布签名 APK / AAB，本地无需安卓编译环境。配置签名、版本号规则和发布步骤见 [安卓发布文档](docs/android.md)。[下载 APK](https://github.com/zxxx98/77erp/releases) · [查看流水线](https://github.com/zxxx98/77erp/actions/workflows/android-release.yml)。

## 启动

```bash
npm install
npm run dev
```

打开 http://localhost:5173 。开发前端端口 5173，API 端口 3001。

首次打开时进入「设置管理员」，填写账号、密码和确认密码后自动登录。账号为 3–32 位字母、数字或 `._-`，密码为 8–128 位字符。系统仅有一个管理员，没有默认账号或密码；创建后初始化入口自动关闭。已有数据库首次升级到此版本时，也需要设置管理员，原有商品和单据保留。

后续使用管理员账号登录，右上角可退出登录。登录有效期为 12 小时，刷新页面及重启服务后仍保留未过期会话。业务页面和业务 API 均需登录，密码使用 scrypt 加盐保存，会话通过 HttpOnly、SameSite=Strict Cookie 管理，数据库仅保存会话令牌的哈希。连续尝试登录或初始化过多时，限制 15 分钟内重试。

生产模式：

```bash
npm run build
npm start
```

打开 http://localhost:3001 。可使用 `PORT` 修改服务端端口，`DB_PATH` 修改数据库路径。开发时如修改 API 端口，请同时调整 `vite.config.js` 中的代理。

## 公网测试页面

测试地址：http://158.178.243.20:28888 。前端页面和 API 由同一个服务提供，使用独立数据库 `data/preview.sqlite`。

服务配置保存在 `deploy/77erp-preview.service`，通过当前用户的 systemd 管理，支持后台运行和异常自动重启。部署命令：

```bash
npm run build
mkdir -p ~/.config/systemd/user
cp deploy/77erp-preview.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now 77erp-preview.service
```

更新页面后执行 `npm run build`；服务端代码或设计规范更新后执行 `systemctl --user restart 77erp-preview.service`。查看状态和日志：

```bash
systemctl --user status 77erp-preview.service
journalctl --user -u 77erp-preview.service -n 50
```

当前公网地址使用 HTTP，手机浏览器摄像头扫码需要 HTTPS；安卓 App 使用原生扫码，可连接该 HTTP 服务。

## 核心功能

- 工作台：商品数量、库存成本、今日采购和销售、7 / 30 天趋势、库存预警、最近单据。
- 商品管理：新增、编辑、分类、搜索、列表 / 网格、CODE128 条码标签下载。新增时条码可留空，保存后自动生成唯一编码；编辑时留空保留原条码。
- 采购入库 / 销售出库：扫码或搜索添加商品，多商品单据，成交单价、数量、往来单位和备注，确认后自动更新库存。
- 库存管理：库存与安全库存、低库存及缺货筛选，一键补货。
- 扫码工作台：手机摄像头识别；查找、入库、出库三个模式。手动条码查询为辅助入口，不展示扫码示例。
- 操作记录：历史单据、时间和关键词筛选、详情、CSV 导出。
- 设置：保存商户和仓库名称。
- 管理员：首次设置唯一管理员、登录、退出登录和会话校验。

## 扫码

扫码以手机摄像头为主，点击「手机扫码」后授权摄像头，将商品条码放入取景框。浏览器使用 ZXing 识别条形码 / 二维码，手机浏览器需要 HTTPS；localhost 可用于开发。安卓 App 使用 CameraX + ML Kit 原生扫码。扫码工作台和入出库表单均支持摄像头识别，识别结果必须匹配商品档案。手动条码查询保留为辅助入口。

## 数据与设计规范

数据库在首次启动时自动创建于 `data/77erp.sqlite`。初始化包含 12 件演示商品和近 30 天演示单据。演示单据为已结转记录，其期初库存独立给定；新建单据在同一个 SQLite 事务中写入明细并变更库存，禁止负库存。历史明细保存商品名称、条码和成交单价快照。

风格参考 [Design Prompts 的 SaaS](https://www.designprompts.dev/saas/)，项目应用规范保存在 [docs/design-system.md](docs/design-system.md)，启动时同步写入 `design_styles` 表，内部接口 `/api/style` 可读取。业务界面不展示设计规范页面或入口；设计规范的颜色值仍应用于 UI。

数据库无需重建即可保存商品和单据。备份时停止服务后复制 `data` 目录，以完整保存 SQLite 文件。正式使用空数据库可指定新的 `DB_PATH`，再根据需求调整初始化逻辑；当前自动初始化演示数据。

当前版本使用单管理员登录，无多角色权限或多租户隔离；适用于单商户使用。公网部署应配置 HTTPS，以保护账号密码及会话传输；同时制定备份策略。

## 验证

```bash
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

API 测试使用独立数据库，覆盖首次初始化、并发初始化保护、登录失败限制、接口鉴权、退出及会话过期、重启后登录保留，以及条码唯一性、进销库存变更、库存不足整单回滚、商品快照、输入校验和设计规范持久化。

浏览器测试使用独立的内存数据库，验证首次设置、密码确认、登录和退出、会话失效、手机登录页，以及新增商品 → 扫码 → 入库 → 库存校验 → 出库完整流程、刷新后库存、单据及条码下载、摄像头降级提示和手机页面。不会改变工作数据库。
