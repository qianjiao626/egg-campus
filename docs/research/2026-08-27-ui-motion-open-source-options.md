# 蛋蛋校园 UI 与动效开源选型

## 研究范围

本次只为登录状态、注册、个人角色档案、任务广场和消息角标五项修复选择可复用的 UI 与动效能力。项目当前前端为原生 HTML、CSS 和 JavaScript，因此不能为了一个视觉效果引入 React、Next.js 或 Tailwind 构建链，也不能依赖生产环境外部 CDN。

## 结论

- **anime.js：采用。** 使用官方 `animejs@4.5.0` 的 ESM 浏览器包，随前端本地部署并保留 MIT 许可证。仅在任务广场首次显示、筛选重排和实时状态更新时懒加载；加载失败时退回现有 CSS，不影响业务。
- **Uiverse Galaxy：采用一个局部交互思想。** 参考 `Cards/Admin12121_purple-parrot-82.html` 中的强调层扩张、轻微上移和按压回落，但按蛋蛋校园现有 DOM、色彩和无障碍约束重新实现，不整卡复制。
- **Aceternity UI：只借鉴视觉组织，不复制运行代码。** 参考 Hover Border Gradient 的边框强调方式，把它简化为任务卡静态彩色顶边和短促状态高亮。官方代码依赖 React、Next.js、Tailwind CSS 和 Motion，不适合直接进入当前原生前端。
- **不采用持续循环的炫光、鼠标追踪聚光灯和大面积 Canvas。** 这些效果对操作型页面的信息读取帮助有限，并增加低性能移动设备负担。

## anime.js

### 官方事实

- 官方仓库为 [`juliangarnier/anime`](https://github.com/juliangarnier/anime)，仓库描述为 JavaScript animation engine，许可证标记为 MIT。
- 官方 `package.json` 在 2026-08-27 查询到版本 `4.5.0`、包名 `animejs`、`type: module` 和 `license: MIT`。
- npm 包包含 `dist/bundles/anime.esm.min.js`，可作为单文件 ESM 浏览器产物使用。
- 官方文档提供 `animate()`、`stagger()` 与硬件加速动画说明。

### 项目使用方式

- 将官方 ESM 压缩包作为本地静态文件部署，不从 jsDelivr、unpkg、esm.sh 等第三方运行时加载。
- 同目录保留 anime.js MIT 许可证，并在项目第三方声明中记录版本与来源。
- 只在进入任务广场且浏览器未启用 `prefers-reduced-motion: reduce` 时动态导入。
- 入场动画只改 `opacity` 与 `transform`：卡片从 `translateY(12px)` 进入，持续 360ms，卡片间隔 36ms。
- 筛选重排使用 240ms 至 320ms 的短动画；WebSocket/REST 更新某张卡片时允许一次 420ms 的边框高亮。
- 页面切换、重复渲染和销毁时取消旧动画，不能保留无限计时器。
- 动态导入失败时记录一次受控警告并继续展示最终状态，不能阻断任务列表、筛选或点击。

### 来源

- [Anime.js GitHub 仓库](https://github.com/juliangarnier/anime)
- [Anime.js MIT License](https://github.com/juliangarnier/anime/blob/master/LICENSE.md)
- [Anime.js animation 文档](https://animejs.com/documentation/animation/)
- [Anime.js stagger 文档](https://animejs.com/documentation/utilities/stagger/)
- [Anime.js 硬件加速动画文档](https://animejs.com/documentation/web-animation-api/hardware-accelerated-animations/)

## Uiverse Galaxy

### 官方事实

- 官方仓库为 [`uiverse-io/galaxy`](https://github.com/uiverse-io/galaxy)，是 Uiverse 平台组件的公开归档。
- 仓库和根目录许可证均为 MIT。
- 官方 README 明确所有仓库内 UI 元素均可在 MIT 下使用、修改和分发；署名并非强制，但官方建议同时感谢原作者和 Uiverse。
- 本次参考文件为 [`Cards/Admin12121_purple-parrot-82.html`](https://github.com/uiverse-io/galaxy/blob/main/Cards/Admin12121_purple-parrot-82.html)，文件注释标明作者 `Admin12121`。

### 项目使用方式

- 不复制该演示卡的固定尺寸、SVG、`z-index: 10000`、整面覆盖动画或教育类文案。
- 仅采用“悬停时强调层扩张、卡片上移、按压回落”的交互关系，并重写为任务卡内部局部伪元素。
- 桌面 hover 上移最多 2px；触屏不依赖 hover 才能看到信息；减少动态效果模式下取消位移。
- 在第三方声明中记录 `Uiverse.io / Admin12121` 和来源文件。

### 来源

- [Uiverse Galaxy GitHub 仓库](https://github.com/uiverse-io/galaxy)
- [Uiverse Galaxy README](https://github.com/uiverse-io/galaxy/blob/main/README.md)
- [Uiverse Galaxy MIT License](https://github.com/uiverse-io/galaxy/blob/main/LICENSE)

## Aceternity UI

### 官方事实

- 官方站点为 [`ui.aceternity.com`](https://ui.aceternity.com/)，官方 GitHub 组织为 [`aceternity`](https://github.com/aceternity)。
- 官方价格页说明免费层提供 100+ 个 React、Next.js、Tailwind CSS 和 Motion 的复制粘贴组件，允许个人及商业客户项目使用。
- 官方同时说明禁止把组件本身重新销售或分发为竞争性的模板或组件库。
- [Hover Border Gradient](https://ui.aceternity.com/components/hover-border-gradient) 页面声明依赖 React、Next.js、Tailwind CSS 和 Motion，安装示例还依赖 `clsx` 与 `tailwind-merge`。

### 项目使用方式

- 不把 Aceternity 的 React 组件源码转贴进项目，不引入其框架依赖。
- 只借鉴“边框承担交互强调、正文保持高对比”的视觉原则。
- 任务卡使用静态多色顶边；只有真实状态更新时播放一次短促边框高亮，避免持续旋转边框干扰阅读。
- 不使用付费模板或来源不明的第三方 Aceternity 仿制仓库。

### 来源

- [Aceternity UI 官方站点](https://ui.aceternity.com/)
- [Aceternity UI 官方价格与授权说明](https://ui.aceternity.com/pricing)
- [Aceternity Hover Border Gradient](https://ui.aceternity.com/components/hover-border-gradient)
- [Aceternity GitHub 组织](https://github.com/aceternity)

## 验收约束

- 生产页面不得请求上述站点的脚本、样式、字体或图片。
- 第三方文件必须有固定版本、来源和许可证副本。
- 动效只能增强反馈，任何库加载失败都不能让业务按钮、任务数据或消息入口失效。
- `prefers-reduced-motion: reduce` 下不加载 anime.js，内容直接处于最终可见状态。
- 390px、768px 和 1440px 视口无横向溢出，动效前后卡片高度不得跳变。
