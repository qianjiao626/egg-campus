# 蛋蛋校园角色与任务卡视觉方向确认

## 已展示方向

- 角色 A：紧凑身份条。
- 角色 B：角色档案卡。
- 角色 C：能量状态卡。
- 任务 A：鲜亮竞技蓝。
- 任务 B：霓虹赛事面板。
- 任务 C：高饱和潮玩粉。

## 用户选择

- 用户选择角色方向：`B`。
- 用户选择任务方向：`C`。
- 用户批准 Huashu 深化系统：校园社团证件 + 潮玩贴纸；莓果粉、电光紫、青绿、明黄和湖蓝组成多色状态系统。
- 用户确认消息入口框始终显示，数量为零时只隐藏数字角标。
- 用户提供 Apogee 前端提示词后选择：只借鉴其精确间距、响应式、缓动和验收方法，不采用品牌、视频、文案或 React/Tailwind 技术栈。
- 用户确认 `A` 代表 Aceternity UI，并要求同时采用 GitHub 上的 Anime；本项目按官方 `anime.js` 处理。
- Uiverse 仅复用 MIT 组件的局部交互关系；Aceternity 仅借鉴边框与层级方法；anime.js 4.5.0 作为本地懒加载任务卡动效引擎。
- 原型中的 `LV.6` 仅为视觉占位，不得进入生产；生产角色档案只展示真实 `UserCharacter` 字段，用户等级必须由真实 `exp` 通过现有规则计算并明确标注。

## 原型与截图

- 高保真原型：`design-demos/egg-campus-polish/huashu-polish-v1.html`
- 桌面任务截图：`output/playwright/huashu-polish/task-desktop.png`
- 桌面角色截图：`output/playwright/huashu-polish/profile-desktop.png`
- 手机任务截图：`output/playwright/huashu-polish/task-mobile.png`
- 手机角色截图：`output/playwright/huashu-polish/profile-mobile.png`

## 验证

- 桌面与手机视口均已渲染。
- 任务与角色视图切换成功。
- 手机视口 `scrollWidth === clientWidth === 390`。
- 消息数量为零时数字角标计算样式为 `display:none`，入口框仍存在。
- 控制台错误 0，警告 0。
