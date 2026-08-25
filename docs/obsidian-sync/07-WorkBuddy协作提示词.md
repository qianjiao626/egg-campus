---
title: WorkBuddy 协作提示词
type: collaboration-prompt
updated: 2026-08-25
tags:
  - github
  - workbuddy
  - collaboration
---

# WorkBuddy 协作提示词

以下内容可直接复制给使用 WorkBuddy 的协作者：

```text
你将参与维护蛋蛋校园项目。请先克隆并阅读 GitHub 仓库，再开始任何修改。

【仓库】
- Repository: https://github.com/qianjiao626/egg-campus
- 默认分支：main
- 工作方式：先同步 main，再创建独立功能分支；不要直接在 main 上开发或强推。

【开始任务时必须做的事】
1. git clone https://github.com/qianjiao626/egg-campus.git
2. 进入仓库后阅读 README.md。
3. 阅读 docs/obsidian-sync/README.md、00-项目总览.md、03-部署与数据隔离.md、05-执行待办.md、06-变更日志.md。
4. 根据任务类型检查相关源码：
   - 主站前端：backend-handoff-package/growth-school.html
   - 盲盒组件：backend-handoff-package/blind-box/
   - API 客户端：backend-handoff-package/api-client.js
   - 后端：server/src/
   - 数据库：server/prisma/schema.prisma 和 server/prisma/migrations/
   - 后端测试：server/tests/
5. 在 GitHub 上检索与当前任务直接相关的 skills 或最佳实践；只采用来源可信、确实有帮助的内容，不安装无关工具。
6. 创建分支，例如：git switch -c feat/<short-task-name>

【项目边界】
- 蛋蛋校园部署在 dsxnb.com/dd 子路径。
- 根站“航线”及其 Supabase 是外部项目，不能修改、迁移或覆盖。
- 后端使用 Fastify + TypeScript + Prisma，数据库为 CVM 上的 MariaDB/MySQL。
- 盲盒交友是主站右侧内容组件；保持现有业务、API 插头和用户数据隔离。
- 认证使用服务端会话和 HttpOnly refresh cookie；不要把密码、JWT、refresh token、验证码或云密钥写入源码、日志或文档。

【实现要求】
- 先理解现有代码和数据模型，再做最小范围修改；保留已有接口名称、数据库字段和前端 adapter，除非任务明确要求变更。
- 涉及数据库时，同时检查 Prisma schema、迁移、服务端路由、测试和部署说明；迁移必须可重复执行，并说明回滚/备份影响。
- 涉及前端时，兼容 /dd 子路径；不要把根路径或“航线”项目的资源路径改坏。
- 不提交 node_modules、dist、.env、.cvm-app-password.local、压缩包、截图或任何真实凭据。
- 不直接修改生产服务器；需要上线时先生成可审计的部署包和命令，再等待明确授权。

【验证要求】
- 后端改动至少运行：
  cd server
  npm ci
  npm run build
  npm test
- 前端改动至少做语法检查和本地浏览器验证；涉及登录、盲盒或 /dd 路由时，验证匿名、已登录、刷新和错误状态。
- 把验证命令、结果、失败原因和未完成事项写入 docs/obsidian-sync/04-验证记录.md 或 05-执行待办.md。

【交付要求】
1. 说明修改了哪些文件、为什么修改、是否影响数据库和生产边界。
2. 给出实际运行过的验证命令和结果，不要用“应该可以”代替证据。
3. 更新 docs/obsidian-sync/06-变更日志.md，记录变更、验证、遗留风险和经验。
4. 提交清晰的 commit，例如：feat: ...、fix: ...、docs: ...。
5. 推送分支：git push -u origin <branch-name>。
6. 提供 GitHub 分支地址和建议的 Pull Request 标题/说明；不要直接合并到 main。

【遇到问题时】
- 先报告阻塞点、已检查的文件/命令和证据，再提出最小化的解决方案。
- 不要索要或输出密码、Token、MFA 动态码、验证码、腾讯云 SecretId/SecretKey 或生产数据库密码。
- 如果任务会影响“航线”或 Supabase，立即暂停并说明边界冲突。
```

## 协作者交接检查

- [ ] 已确认仓库 owner 为 `qianjiao626`
- [ ] 已从 `main` 创建独立分支
- [ ] 已阅读项目总览、部署隔离和变更日志
- [ ] 已检查相关 GitHub skills
- [ ] 已运行与任务风险匹配的构建/测试/浏览器验证
- [ ] 已更新 Obsidian
- [ ] 已推送分支并提供 Pull Request 信息
