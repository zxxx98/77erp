# React Native Android ARM64 客户端与发布

仓库：[zxxx98/77erp](https://github.com/zxxx98/77erp) · [构建记录](https://github.com/zxxx98/77erp/actions/workflows/android-release.yml) · [安装包下载](https://github.com/zxxx98/77erp/releases)

## 使用方式

- 仅支持 Android 12（API 31）及以上，系统必须支持 **ARM 64 位 `arm64-v8a`**。不支持 Android 11 及以下、ARM 32 位、x86 和 x86_64。
- 安装 Release 中的 `77ERP-版本号-arm64.apk`。AAB 用于应用商店，不能直接安装。
- 首次启动填写服务器根地址，例如 `https://erp.example.com` 或当前测试服务 `http://158.178.243.20:28888`，不要加 `/api`。之后可从「更多 → 切换服务器」修改；切换服务器会清除旧登录会话。
- 从 **1.1.0** 开始，所有业务页面使用 **React Native 原生控件**，运行在 Hermes 上。App 不使用 WebView，也不下载 HTML 页面；页面代码打包在 APK 内，界面更新需安装新版 APK。
- 账号、商品、库存和单据均通过现有 JSON API 读取和修改，保存在服务器，业务操作需要联网。无需为原生版更新服务器的 Web 前端，也没有新增服务器接口。
- 「扫码」调用 CameraX + 内置 ML Kit 模型，无需 Google Play 服务或额外下载模型；HTTP 服务器也能使用原生摄像头。首次扫码需授权相机，拒绝后可手动输入条码。
- 下拉刷新同步数据，返回键退出详情或返回工作台。修改中的商品和单据在返回时提示确认；扫码只识别商品，入出库需要确认提交。

## 原生功能与精简范围

| 页面 | 原生功能 |
| --- | --- |
| 连接 / 登录 | 服务器配置、首次设置管理员、登录、密码显示切换、会话过期处理、退出 |
| 工作台 | 商品种类、库存成本、今日采购 / 销售、库存预警、最近单据、快捷入出库 |
| 商品 | 搜索 / 分类筛选、详情、新增 / 编辑、条码扫描录入、空条码自动生成 |
| 库存 | 全部库存 / 库存预警 / 缺货筛选、商品详情、一键打开入出库 |
| 扫码 | 查找 / 入库 / 出库三种模式、相机权限处理、手动条码输入 |
| 单据 | 多商品入出库、数量 / 单价编辑、合并重复商品、库存校验、确认提交、记录筛选与详情 |
| 更多 | 管理员信息、商户与仓库设置、切换服务器、退出登录 |

安卓端省去 CSV 导出、SVG 标签下载、桌面表格 / 网格切换、键盘快捷键和趋势图，这些功能在 Web 端保留。原生界面沿用 Web 设计令牌：`#2563EB` 主色、`#F7F8FA` 背景、白色卡片、细边框和中文业务文案。

### 手机 UI 适配（1.1.1）

表单和操作按钮按可用宽度、系统字体大小自动换行，内容区在大屏上居中并限制为 760 dp。商品名称与库存 / 金额分开排列，详情显示完整数据；辅助文字使用同色系的 `#647084`，提高可读性。业务文字跟随系统字号，只有品牌标记保持固定大小。

主页面和弹窗分别处理安全区，键盘按实际遮挡量补充空间。短屏、较大字号或键盘弹出时，保存 / 确认按钮进入表单滚动区域；普通竖屏保留底部操作。校验失败自动滚回错误提示，重复相同错误也会触发。搜索时隐藏底部导航，收起键盘后恢复原标签和搜索条件。扫码页使用 dp 间距、刘海安全区和可滚动控制区。

详细问题、修复依据、自动检查与真机验收项见 [Android UI review](android-ui-review.md)。

网络请求由原生 OkHttp 完成，会话 Cookie 由原生层使用 Android Keystore AES-GCM 加密保存，并绑定服务器地址；JavaScript 层拿不到会话令牌。HTTPS 证书错误不会被忽略，不自动跟随服务器重定向，不自动重试入出库提交。若提交时网络中断，请先查看操作记录，避免重复入出库。Web 端原有 Cookie 与跨站请求保护不变，公网服务建议使用 HTTPS。

从 1.0.0 覆盖安装后沿用服务器地址，需要重新登录；应用包名与签名保持不变，服务器业务数据不受影响。

## 一次性配置签名

GitHub Actions 使用固定发布密钥签名，让新版本可以覆盖安装并保留 App 设置。**妥善备份密钥、别名和密码；更换密钥后无法直接覆盖旧版。** 不要把这些内容提交到仓库。

在仓库 Settings → Secrets and variables → Actions 添加四个 Repository secrets：

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | JKS 文件的完整 Base64，单行、无换行 |
| `ANDROID_KEYSTORE_PASSWORD` | 密钥库密码 |
| `ANDROID_KEY_ALIAS` | 签名别名，例如 `77erp` |
| `ANDROID_KEY_PASSWORD` | 签名密钥密码 |

新项目可在可信环境使用 JDK 的 `keytool` 创建密钥（这不是安卓编译，不需要 Android SDK）：

```bash
keytool -genkeypair -v -keystore 77erp-release.jks -storetype JKS \
  -alias 77erp -keyalg RSA -keysize 3072 -validity 10000
```

按提示设置密码。通过 `gh secret set ANDROID_KEYSTORE_BASE64 --repo zxxx98/77erp` 的标准输入上传文件的单行 Base64，其他三项可在 GitHub 页面填写。密钥不完整时流水线会在构建前明确失败，不会发布临时签名或未签名安装包。

## 通过版本号发布

根目录 `package.json` 是版本号来源。`npm version` 会通过版本钩子自动同步 `mobile/package.json` 及两个 lock 文件并一起提交。`versionName` 等于项目版本；`versionCode = major × 1,000,000 + minor × 1,000 + patch`。只支持 `x.y.z` 正式版本，major 不超过 2099，minor / patch 不超过 999，最低版本为 `0.0.1`。例如 `1.2.3` 对应 `1002003`。

后续发布只需：

```bash
# 在最新 main 上，确保工作区干净
npm version patch
git push origin main
git push origin --follow-tags
```

也可用 `npm version minor`、`npm version major` 或 `npm version 1.2.3` 指定版本。npm 会同步版本文件、创建提交和 `v版本号` 标签。发布已写入文件的当前 `1.1.1` 时：

```bash
git tag -a v1.1.1 -m '77 ERP React Native 1.1.1'
git push origin main
git push origin v1.1.1
```

推送 `v*` 标签自动触发 Android 发布；普通代码推送不会构建 APK。标签必须与所指向提交的 `package.json` 版本完全一致。发布后的版本应递增，不要移动已发布标签。

发布前也可在 Actions 页面点击 **Run workflow**，选择分支并输入该分支的版本号，进行云端试构建；该模式只上传 Actions 产物，不创建 Release。无需本地编译。

## 云端流水线

全部 Android 编译在 GitHub 的 Ubuntu runner 完成，本地无需 Android Studio、SDK 或 Gradle 构建。使用 React Native 0.81.5、React 19.1、JDK 17、Android SDK 36、NDK 27.1、Gradle 8.14.3 和 React Native 配套的 AGP 8.11.0。Gradle Wrapper 与发行包 SHA-256 均经过校验。

流水线依次执行：

1. 校验版本标签并读取签名 Secrets。
2. 安装 Node.js 22 的 Web 与原生依赖，运行 API、版本号、Web 浏览器、React Native 组件 / 业务流程测试和 TypeScript 检查。
3. 检查原生源码未引入 WebView，运行 Android Release Lint，打包 Hermes 应用代码并编译签名 APK 与 AAB。
4. 检查产物包含 React Native 应用 bundle、Hermes 和 React Native 运行库；全部 `.so` 路径必须为 `arm64-v8a`，ELF 必须是 64 位 ARM；校验 APK 最低系统版本为 API 31，以及包名、版本和签名。
5. 检查 DEX 保留 JNI 初始化所需类，防止 Release 裁剪导致启动闪退。
6. 安装实际 ARM64 APK，在 Android 12 / 16 镜像（系统 ARM64 转译）中运行冷启动及原生页面检查，保存日志、截图和控件树。测试使用独立 API 测试数据，不连接业务服务器。
7. 所有检查通过后自动创建 GitHub Release，附 APK、AAB 和 `SHA256SUMS`。运行检查失败时不会发布。

Actions artifact 保留 30 天，Release 附件长期保留。失败时可查看上传的 Android Lint / 浏览器诊断报告，在同一版本的 Actions 页面点击 Re-run jobs 重试；如果修改了代码，使用新的版本号和标签。流水线不自动部署服务器；服务器前端更新仍按 README 的部署方式完成。

## 验证边界

原生组件测试直接渲染 React Native 组件，覆盖首次初始化、商品建档、扫码取消 / 结果、出库校验与确认、防重复提交、读取服务器数据和原生导航。独立测试还覆盖金额、数量、HTTP 错误、会话失效和相机权限。Web 浏览器测试只验证 Web 本身。

本地可运行不涉及 Android 编译的检查：

```bash
npm ci --prefix mobile
npm run typecheck --prefix mobile
npm test --prefix mobile
node scripts/check-native-source.mjs
```

GitHub 负责 Android 编译、Lint、签名、产物和模拟环境运行检查。实际摄像头识别、Keystore 会话持久化、厂商输入法、覆盖安装和具体机型兼容性仍需 ARM64 真机验证。可单独运行 `Android Runtime Check` workflow，指定 Release 标签或构建 run ID 重现启动及界面问题。
