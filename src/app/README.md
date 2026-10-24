# Web 界面模块

- `src/main.jsx` 只挂载 PWA、登录门禁和应用。
- `App.jsx` 管理导航、仓库、权限和弹窗状态；页面及业务弹窗通过 `LazyComponents.jsx` 的局部 Suspense 加载。
- `src/pages/` 是桌面业务页面；`src/features/` 是业务弹窗；`src/mobile-web/` 是移动端视图。公共组件位于 `src/components/common.jsx`。
- 格式化、下载、单据标签和提交逻辑分别位于 `format.js`、`download.js`、`src/order-utils.js`、`src/business-api.js`。公共逻辑不得反向导入页面或业务组件，以免带入整个页面包。
- 设置子面板首次访问时加载，访问过的图床、通知和备份面板保持挂载，以保留未保存内容。

新增低频功能时从 `LazyComponents.jsx` 注册入口，并在需要时才渲染。PWA 仍预缓存发布资源以支持离线打开；资源预缓存与界面模块的按需执行分别处理。浏览器模块请求验收使用禁用 Service Worker 的上下文，PWA 离线行为由专门用例覆盖。

## UI 组件约定

基础控件使用 Ant Design 6：按钮、输入框、复选框、单选框、标签、空状态和分页直接使用库组件。公共 `Button` 仅增加权限与业务忙碌状态。主题、中文语言及桌面 / 手机控件尺寸集中在 `src/ui/provider.jsx`；新增样式只处理业务布局，避免重复定义基础控件的颜色、边框和交互状态。

表单使用 `Form` / `Form.Item` 的 `rules` 与 `onFinish`。登录表单直接由 Ant Form 管理；已有业务草稿通过 `src/ui/FormField.jsx` 将受控值同步到 Ant Form，校验仍由 Ant Design 执行。搜索选择使用 `Select` 的内置搜索；允许输入新名称的往来单位使用 `AutoComplete`。`src/Dropdown.jsx` 仅映射业务选项及展示内容，不实现弹层定位或键盘导航。数量的小数精度、库存与权限校验仍由共享业务规则及 API 负责。
