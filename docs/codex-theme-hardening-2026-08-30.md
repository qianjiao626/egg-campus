# 蛋蛋校园 · 雪山玻璃主题上线加固 + 仓库清理（Codex 专用）· 2026-08-30 第三轮

> 前两轮安全修复已提交（`a973a69`）。本工单处理「cinematic glass 主题」的 5 个上线阻塞问题 + 仓库卫生。
> 主题代码位置：`backend-handoff-package/growth-school.html` 内 `/* ===== Cinematic glass theme ===== */` 注释块（约 1660 行起，用 grep 定位，行号已因前轮修改漂移）。
> 规则不变：不跑 `prisma migrate`，不整文件格式化，只改点名位置。每个任务完成即跑对应验证。测试在 `server/` 下 `npx vitest run`。

---

## 任务 1 · 背景图脱离豆包临时链接（最高优先级）

**问题**：`body` 的 `background-image` 用 `https://aka.doubaocdn.com/s/7Uk7ZUVBSo`——第三方分享短链，随时失效。失效后整个主题只剩纯黑底。

**动作**：
1. 下载该图到 `backend-handoff-package/assets/theme-bg.jpg`：
   ```bash
   mkdir -p backend-handoff-package/assets
   curl -L -o backend-handoff-package/assets/theme-bg.jpg "https://aka.doubaocdn.com/s/7Uk7ZUVBSo"
   ```
   确认文件是有效 JPEG/PNG（`file` 命令或看文件头），大小 >50KB。若下载失败（链接已死），从 `output/playwright/cinematic-permission-theme.png` 裁一张替代，另存为 jpg，并在交接备注写明换图了。
2. 若图 >500KB，用任意可用工具压到 ≤500KB（质量 75 左右即可）；没有压缩工具就原样用，交接备注写明待压缩。
3. CSS 里把 URL 换成相对路径 `url('assets/theme-bg.jpg')`。
4. **同时**把 `background-attachment: fixed` 删掉（移动端半残 + 滚动掉帧），改为在 `body` 上保持 `background-size:cover;background-position:center` 即可。

**验证**：`grep -c "doubaocdn" backend-handoff-package/growth-school.html` 输出 0；`ls -la backend-handoff-package/assets/theme-bg.jpg` 存在。

---

## 任务 2 · 删除无效的 Google Fonts @import

**问题**：主题块里 `@import url('https://fonts.googleapis.com/...Instrument+Serif...Inter...')` 三重无效：
1. `@import` 写在 `<style>` 中部，CSS 规范要求在所有规则之前，浏览器直接忽略；
2. 目标用户在中国大陆，`fonts.googleapis.com` 不可达，就算位置对也只会拖慢或超时;
3. Instrument Serif 无中文字形，中文标题永远用不上它。

**动作**：删掉这行 `@import`。字体栈保持现有 fallback 即可（`Georgia,serif` / `system-ui,sans-serif` 已在各规则里）。**不要**引入任何新字体文件或 CDN。

**验证**：`grep -c "fonts.googleapis" backend-handoff-package/growth-school.html` 输出 0。渲染无变化（本来就没加载成功）。

---

## 任务 3 · 恢复语义状态色

**问题**：主题块 `:root` 覆盖把 `--red/--green/--gold/--orange/--purple/--pink/--lilac` 全设成 `#fff`，各 `-tint` 全设成同一个白 14%。错误/成功/警告/角标在视觉上无差别——审核中心「通过/驳回」同色，是可用性缺陷。

**动作**：把主题块 `:root` 里的语义色改回可辨识的亮色变体（深色玻璃底上要够亮）。用这组：
```css
--primary:#A78BFA;--primary-dark:#8B5CF6;--primary-tint:rgba(167,139,250,.18);
--orange:#FBBF24;--orange-tint:rgba(251,191,36,.16);
--green:#34D399;--green-tint:rgba(52,211,153,.16);
--lilac:#C4B5FD;--lilac-tint:rgba(196,181,253,.16);
--red:#F87171;--red-tint:rgba(248,113,113,.16);
--gold:#FCD34D;--gold-tint:rgba(252,211,77,.16);
--purple:#A78BFA;--purple-tint:rgba(167,139,250,.16);
--pink:#F472B6;--pink-tint:rgba(244,114,182,.16);
```
`--ink/--muted/--border/--bg/--shadow` 等中性 token 不动。

**验证**：新增/追加到 `server/tests/frontend-ux-regressions.test.ts` 一个 `it`：
```ts
it('cinematic theme keeps semantic status colors distinct', () => {
  const themeBlock = html.slice(html.indexOf('Cinematic glass theme'));
  expect(themeBlock).not.toMatch(/--red:\s*#fff/);
  expect(themeBlock).not.toMatch(/--green:\s*#fff/);
});
```
跑 `npx vitest run tests/frontend-ux-regressions.test.ts` 全绿。

---

## 任务 4 · 撤销全局禁动画

**问题**：主题块里 `*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}` 一刀切：加载转圈冻结成静止圆、hover 无反馈、懒加载的 anime.js 任务卡动效全废。

**动作**：删除这一行，替换为尊重系统偏好的版本：
```css
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
}
```
若原样式里有明显过度的入场动画想压掉，只允许逐个选择器点名禁用，不许再用全局通配。

**验证**：`grep -n "animation:none" backend-handoff-package/growth-school.html` 只出现在 `prefers-reduced-motion` 块内。

---

## 任务 5 · 降低 backdrop-filter 数量（性能）

**问题**：主题块给 `.card`、`[class*='-card']`、`.bl-stat` 等大范围选择器全开 `backdrop-filter:blur(12px)`，列表页几十张卡同时实时模糊，中低端安卓机滚动掉帧。

**动作**（最小改法，不追求完美）：
1. 保留 `backdrop-filter` 仅在**大容器**上：`.sidebar`、`.plaza-banner`、模态框（`.bl-tousu-modal,.bl-metric-rank-modal,.bl-school-detail-modal,.notif-panel`）。
2. 其余卡片类选择器删掉 `backdrop-filter`/`-webkit-backdrop-filter` 两个属性，同时把这些卡的背景从 `rgba(255,255,255,.06)` 提到 `rgba(20,26,34,.72)`（半透明深色实底，无实时模糊，视觉接近）。
3. 其他属性（边框、圆角、阴影）不动。

**验证**：`grep -c "backdrop-filter" backend-handoff-package/growth-school.html` 相比改前明显减少（改前约 10+ 处，改后 ≤4 处规则）。

---

## 任务 6 · rollback 分叉文件同步

任务 1–5 的改动**同样应用到** `backend-handoff-package/growth-school.rollback-real-data.html`（若该文件也含 cinematic 主题块；grep `Cinematic glass theme` 确认，没有则跳过并在交接备注注明）。

---

## 任务 7 · 仓库卫生

1. 上一轮提交混入的调试产物加进 `.gitignore`：
   ```
   .walkthrough-harness/
   fix-white-screen.cjs
   ```
   并 `git rm -r --cached .walkthrough-harness fix-white-screen.cjs`（只解除跟踪，不删磁盘文件）。
2. **不要**删除 `growth-school.rollback-real-data.html`（决策留给人类）。

---

## 任务 8 · 收尾

1. 全量测试：`cd server && npx vitest run` 全绿（372+）。
2. 有条件的话用 `.walkthrough-harness/serve.mjs` 或任意静态服务器打开 `growth-school.html` 目验一遍：背景图出现、状态色有区分、hover 有过渡。截图存 `output/playwright/theme-hardening-check.png`（可选，无浏览器环境就跳过）。
3. 更新 `docs/releases/2026-08-29-production-r3.json` 中 `growth-school.html` 的 sha256（`sha256sum` 算），新增 `assets/theme-bg.jpg` 条目（component: frontend, target: assets/theme-bg.jpg）。
4. 提交，message：
   ```
   fix(theme): self-host background, restore status colors, scoped motion + blur, repo hygiene
   ```
   不 push。

## 完成定义

- [ ] doubaocdn 引用清零，背景图自托管。
- [ ] fonts.googleapis @import 删除。
- [ ] 语义色恢复且有回归测试。
- [ ] 全局禁动画改为 prefers-reduced-motion 限定。
- [ ] backdrop-filter 只留大容器。
- [ ] rollback 文件同步（或注明不适用）。
- [ ] .walkthrough-harness 与 fix-white-screen.cjs 解除跟踪。
- [ ] 全量测试绿，已提交未 push。
