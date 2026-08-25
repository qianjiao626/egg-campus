---
title: 蛋蛋校园 Obsidian 同步库
type: index
updated: 2026-08-24
tags:
  - dandan-campus
  - obsidian
  - codex-sync
---

# 蛋蛋校园 Obsidian 同步库

这个目录可以直接作为 Obsidian vault 打开，用来保存 Codex 与项目协作时最重要的事实、验证证据和下一步工作。代码和配置文件仍然是实现的最终事实来源；本 vault 是面向人和后续智能体的可检索索引。

## 快速导航

- [[00-项目总览]]：架构、范围和当前状态
- [[01-认证与会话]]：注册、登录、验证码、会话恢复和权限
- [[02-盲盒数据库]]：盲盒 API、数据模型和仍需补齐的业务语义
- [[03-部署与数据隔离]]：CVM、MariaDB、Nginx、PM2 和“航线”边界
- [[04-验证记录]]：本地与线上验收证据
- [[05-执行待办]]：按优先级可执行的下一步
- [[06-变更日志]]：按日期记录重要变更
- [[07-WorkBuddy协作提示词]]：可直接发送给 WorkBuddy 的项目提示词
- [[08-WorkBuddy实时协作协议]]：GitHub、Obsidian 与 Codex 的交接方式

## 同步约定

1. 新的实现先改代码，再在对应笔记中记录状态和验证命令。
2. 不能从环境或源码安全推断的内容标记为“待确认”，不把推测写成完成。
3. 密码、JWT、refresh token、验证码、腾讯云 SecretId/SecretKey、短信模板敏感参数不写入 vault。
4. 线上操作只记录公开 URL、路径、迁移 ID、状态码和脱敏结论；敏感值留在 CVM 环境变量或密钥管理中。
5. “航线”根站和 Supabase 是外部边界，任何变更都必须在 [[03-部署与数据隔离]] 中说明影响。

## 全局工作流约定

1. 每个项目任务开始前，先到 GitHub 检索相关 skills，阅读说明并评估是否值得安装；只有对当前任务有明确帮助且来源可信的 skill 才安装。
2. 每完成一个任务，更新本目录中的变更日志、验证记录或执行待办，记录已完成事项、验证证据、遗留风险和可复用经验。
3. 不把密码、token、验证码、短信密钥或其他敏感值写入 vault；只记录路径、命令类别、哈希和脱敏结果。

这套规则适用于后续蛋蛋校园、`/dd` 子路径和相关部署维护工作。

## Codex 工作入口

- 后端：`server/`
- 主站前端：`backend-handoff-package/growth-school.html`
- 盲盒前端：`backend-handoff-package/blind-box/`
- 认证客户端：`backend-handoff-package/api-client.js`
- 生产运维脚本：`server/deploy/`
- 原始阶段计划：`task_plan.md`、`progress.md`、`findings.md`

## 更新检查

每次重要部署或 schema 迁移后，至少更新 [[04-验证记录]]、[[05-执行待办]] 和 [[06-变更日志]]。若状态与代码不一致，以代码、迁移文件和实际命令输出为准，并在笔记中注明差异。
