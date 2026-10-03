# Android ARM64 客户端与发布

仓库：[zxxx98/77erp](https://github.com/zxxx98/77erp) · [构建记录](https://github.com/zxxx98/77erp/actions/workflows/android-release.yml) · [安装包下载](https://github.com/zxxx98/77erp/releases)

## 使用方式

- 仅支持 Android 12（API 31）及以上，系统必须支持 **ARM 64 位 `arm64-v8a`**。不支持 Android 11 及以下、ARM 32 位、x86 和 x86_64。
- 安装 Release 中的 `77ERP-版本号-arm64.apk`。AAB 用于应用商店，不能直接安装。
- 首次启动填写服务器根地址，例如 `https://erp.example.com` 或当前测试服务 `http://158.178.243.20:28888`，不要加 `/api`。之后可从顶部「服务器」修改；切换服务器会清除旧登录会话。
- App 使用服务器提供的 React 页面和同源 API，账号、商品、库存和单据均保存在服务器，需要联网。服务器需先部署本仓库的新版前端，才能使用原生扫码和文件保存。
- 「手机扫码」调用 CameraX + 内置 ML Kit 模型，无需 Google Play 服务或额外下载模型；HTTP 服务器也能使用原生摄像头。首次扫码需授权相机，拒绝后可手动输入条码。
- CSV 和条码 SVG 通过系统文件选择器保存，无需存储权限。返回键回退页面，顶部「刷新」重新连接；Android System WebView 过旧时会提示更新。

客户端只对配置的服务器主页面开放扫码与文件保存能力，拒绝其他来源和子框架调用；外部 HTTP(S) 链接交给浏览器，HTTPS 证书错误不会被忽略。现有 HttpOnly / SameSite 登录会话与服务器同源校验保持有效。公网服务建议使用 HTTPS。

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

`package.json` 是版本号唯一来源，`package-lock.json` 由 npm 同步。`versionName` 等于项目版本；`versionCode = major × 1,000,000 + minor × 1,000 + patch`。只支持 `x.y.z` 正式版本，major 不超过 2099，minor / patch 不超过 999，最低版本为 `0.0.1`。例如 `1.2.3` 对应 `1002003`。

后续发布只需：

```bash
# 在最新 main 上，确保工作区干净
npm version patch
git push origin main
git push origin --follow-tags
```

也可用 `npm version minor`、`npm version major` 或 `npm version 1.2.3` 指定版本。npm 会修改两个版本文件、创建提交和 `v版本号` 标签。首次发布当前 `1.0.0` 时：

```bash
git tag -a v1.0.0 -m '77 ERP Android 1.0.0'
git push origin main
git push origin v1.0.0
```

推送 `v*` 标签自动触发 Android 发布；普通代码推送不会构建 APK。标签必须与所指向提交的 `package.json` 版本完全一致。发布后的版本应递增，不要移动已发布标签。

发布前也可在 Actions 页面点击 **Run workflow**，选择分支并输入该分支的版本号，进行云端试构建；该模式只上传 Actions 产物，不创建 Release。无需本地编译。

## 云端流水线

全部 Android 编译在 GitHub 的 Ubuntu runner 完成，本地无需 Android Studio、SDK 或 Gradle 构建。仓库包含 Gradle 8.13 Wrapper，并固定发行包 SHA-256；使用 JDK 17、Android SDK 36、AGP 8.13.2。

流水线依次执行：

1. 校验版本标签并读取签名 Secrets。
2. 安装 Node.js 22 依赖，运行 API、版本号及浏览器测试，并构建 Web 前端。
3. 运行 Android Release Lint，编译签名 APK 与 AAB。
4. 检查产物实际包含的全部 `.so`：路径必须为 `arm64-v8a`，ELF 必须是 64 位 ARM；校验 APK 最低系统版本为 API 31，以及包名、版本和签名。
5. 上传 Actions 构建产物，自动创建 GitHub Release，附 APK、AAB 和 `SHA256SUMS`。

Actions artifact 保留 30 天，Release 附件长期保留。失败时可查看上传的 Android Lint / 浏览器诊断报告，在同一版本的 Actions 页面点击 Re-run jobs 重试；如果修改了代码，使用新的版本号和标签。流水线不自动部署服务器；服务器前端更新仍按 README 的部署方式完成。

## 验证边界

浏览器测试覆盖原生消息接口与页面的扫码、权限错误和导出行为；原生源码、签名和架构由 GitHub Android 构建检查。首次安装仍需在 ARM64 真机验证：服务器连接、登录保持、相机授权/拒绝、实际条码识别、CSV/SVG 保存、返回键和覆盖安装。
