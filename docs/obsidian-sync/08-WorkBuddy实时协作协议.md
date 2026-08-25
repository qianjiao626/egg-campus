---
title: WorkBuddy 实时协作协议
type: collaboration-protocol
updated: 2026-08-25
tags:
  - github
  - workbuddy
  - obsidian
  - handoff
---

# WorkBuddy 实时协作协议

## 先说结论

Codex 与 WorkBuddy 没有默认的后台实时私聊通道，也不会自动监听 Obsidian 文件变化。两边可以通过 GitHub 和共享 Obsidian vault 实现近实时交接，但每次交接仍需要用户触发 Codex 读取最新状态。

推荐的事实源顺序：

1. GitHub 代码、分支、commit 和 Pull Request：代码事实源。
2. Obsidian 协作文档：任务意图、验证证据、遗留风险和经验事实源。
3. 用户消息：授权、优先级和冲突裁决事实源。

## 三种交接方式

### 方式 A：GitHub Pull Request（推荐用于代码变更）

WorkBuddy 完成修改后：

1. 从最新 `main` 创建独立分支。
2. 完成代码、测试和文档更新。
3. 推送分支并创建 Pull Request。
4. 在 PR 描述中写清修改范围、验证命令、数据库影响和未完成事项。

然后用户把 PR 地址或 commit SHA 发给 Codex，并说明：

```text
请检查并继续处理 WorkBuddy 的 PR：<PR_URL>
重点：<要我做的动作，例如审查、修复测试失败、合并前验证>
```

Codex 会重新读取仓库、检查 diff、运行验证，不把 WorkBuddy 的“已完成”报告直接当作证据。

### 方式 B：Obsidian 任务收件箱（推荐用于任务指示）

WorkBuddy 在 `docs/obsidian-sync/` 下创建或更新任务文件，例如：

`09-workbuddy-inbox-TASK-20260825-001.md`

文件必须包含：

```markdown
---
task_id: TASK-20260825-001
from: WorkBuddy
to: Codex
status: READY_FOR_CODEX
priority: P1
created: 2026-08-25
---

# 任务标题

## 目标
用一句话说明要改变什么。

## 验收标准
- [ ] 可检查的结果 1
- [ ] 可检查的结果 2

## 范围
- 允许修改：
- 明确不修改：

## 相关文件
- `path/to/file`

## WorkBuddy 已完成的调查
- 已运行命令：
- 关键结果：
- 未解决风险：

## 给 Codex 的明确动作
请执行：审查 / 实现 / 修复 / 验证 / 生成部署包（选择并写清楚）。
```

然后用户告诉 Codex：

```text
请读取并处理 Obsidian 收件箱任务 TASK-20260825-001。
```

Codex 完成后将 `status` 更新为 `DONE`、`BLOCKED` 或 `NEEDS_USER_AUTHORIZATION`，并在变更日志/验证记录中补充证据。

### 方式 C：用户消息转交（最快）

WorkBuddy 输出分支、commit、PR 或任务文件后，用户把链接和要做的动作发给 Codex。不要只转述“WorkBuddy 说已经完成”，必须提供可读取的 GitHub 地址、commit SHA 或 Obsidian 文件名。

## 哪些内容不能自动交接

- 生产部署、数据库迁移、删除数据、权限变更和合并到 `main` 仍需要用户明确授权。
- 密码、Token、MFA 动态码、验证码、腾讯云 SecretId/SecretKey 和生产数据库密码不通过 WorkBuddy、Obsidian 或聊天传递。
- WorkBuddy 的建议不是生产事实；Codex 必须重新检查代码、diff 和验证输出。
- 如果任务触及“航线”或 Supabase，必须暂停并由用户裁决边界。

## 推荐的日常节奏

1. WorkBuddy：调查或实现 -> 更新 Obsidian -> 推送分支/PR。
2. 用户：把 PR 或 `TASK-xxx` 发给 Codex。
3. Codex：读取最新代码和文档 -> 独立验证 -> 修改/审查 -> 更新 Obsidian。
4. 用户：根据 Codex 的验证结果决定是否合并、部署或继续拆任务。

这样可以做到分钟级的近实时协作，同时保留可审计的代码历史和任务证据；它不是后台自动对话，也不会绕过用户授权执行高风险操作。
