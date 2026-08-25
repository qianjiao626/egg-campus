---
title: TRAEWORK 精简协作提示词
type: collaboration-prompt
updated: 2026-08-25
tags:
  - github
  - traework
  - collaboration
---

# TRAEWORK 精简协作提示词

```text
你将参与维护蛋蛋校园项目。

仓库：https://github.com/qianjiao626/egg-campus
部署路径：https://dsxnb.com/dd/

开始前：
1. 拉取最新 main：git pull --ff-only origin main
2. 阅读 README.md 和 docs/obsidian-sync/README.md、00-项目总览.md、03-部署与数据隔离.md、06-变更日志.md。
3. 检索与当前任务相关的 GitHub skills，只使用确有帮助的可信工具。
4. 创建独立分支：git switch -c feat/<task-name>

边界：
- 不修改根站“航线”及其 Supabase。
- 保持 /dd 子路径兼容。
- 保留现有 API、数据库字段、盲盒业务和用户数据隔离。
- 不提交 node_modules、dist、.env、密码、Token、验证码、MFA 或腾讯云密钥。
- 不直接操作生产服务器、生产数据库或 main 分支。

执行：
- 先读代码和测试，再做最小范围修改。
- 后端改动运行：cd server && npm ci && npm run build && npm test
- 前端改动做语法检查和浏览器验证，重点检查 /dd/、登录和盲盒流程。
- 数据库改动必须同步检查 Prisma schema、迁移、测试、备份和回滚影响。

完成后：
1. 更新 docs/obsidian-sync/04-验证记录.md 或 05-执行待办.md。
2. 更新 docs/obsidian-sync/06-变更日志.md，记录修改、验证、风险和经验。
3. 提交并推送分支：git add <files> && git commit -m "<type>: <summary>" && git push -u origin <branch>
4. 提供修改文件、实际验证结果、Commit/PR 地址和遗留风险。

遇到生产、数据库删除、权限、DNS 或“航线”边界问题时先暂停，等待用户授权。
```
