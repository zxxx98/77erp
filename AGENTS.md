# 仓库协作约定

## 开发与验证范围

- 开发与维护覆盖桌面 Web 和移动 Web（含 PWA）。新功能、交互调整、问题修复及验收默认覆盖这两端。
- 移动 Web 位于 `src/mobile-web/`，PWA 位于 `src/pwa/`；「移动端」「手机端」均指移动 Web / PWA。
- 原生安卓客户端已移除。手机和平板通过浏览器或安装 PWA 使用，不再维护原生客户端源码、构建与发布流程。
- 可按 Web 业务需要修改 `server/` 和共享模块，并注意现有 Web 客户端的接口兼容性。
- 默认验证 Web / API、桌面及移动 Web 浏览器行为；保留 Android 浏览器和 iOS Safari 的设备识别、扫码与 PWA 支持。

## 版本与发布范围

- 「更新版本号」「打 tag」「发布」针对桌面 Web、移动 Web 和 PWA。
- 根目录 `package.json` 是应用版本来源，不再同步原生客户端版本。
- `.github/workflows/docker.yml` 负责测试及 Web 镜像构建发布；`v*` 标签仅触发现有 Web 镜像发布流程。
