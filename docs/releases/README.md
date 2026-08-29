# Release Boundaries

本目录保存可审计的发布清单，不保存整份源码副本。每个 JSON 清单都代表一个不可混用的代码版本，不把工作树当成发布包。
当前活动版本为 `2026-08-29-production-r3`，已通过本地测试、构建和生产边界校验。`superseded` 清单只用于历史追溯，隔离版禁止部署；只有单独验收并标为 `production-approved` 且 `productionDeployable: true` 的清单，才允许走生产部署。
每个 JSON 清单都必须明确：

- `sourceOfTruth` / `componentSources`：前端与后端分别声明唯一源目录，不能用一个前端目录概括整个版本。
- `status` 与 `productionDeployable`：未批准的工作版本必须是 `isolated-test-only` 且为 `false`。
- `files`：允许交付的精确路径和 SHA-256；每项必须声明 `component`。前端项还必须声明相对 `/var/www/dd` 的 `target`。
- `rollbackSource`：只有经过批准、带版本号和哈希的回滚源才能填写；历史临时文件一律不能作为回滚源。
- `targetEnvironments`：明确 local、isolated-test、production 的适用范围。
- `version`：单调递增的版本号（如 `r2`），不能复用旧版本号。
- `supersedes`：本版本替代的清单 ID；首个版本可为 `null`。
- `generatedAt`：生成清单时的 UTC 时间，用于审计工作树是否已换代。

`2026-08-28-auth-profile-task-ui-r2.json` 仅适用于本地和隔离测试，禁止直接上传到 `/var/www/dd`。
旧的 `2026-08-28-auth-profile-task-ui.json` 已标记为 `superseded`，不得再作为发布或回滚输入。
生产发布必须新建一个经过验收的清单，填写生产基线、回滚源、迁移清单和验证证据，并通过：

```text
node server/scripts/verify-release-boundary.mjs --production docs/releases/<release>.json
```

部署脚本也强制要求显式传入已验收的清单，避免把工作树或旧压缩包直接覆盖线上：

```text
RELEASE_MANIFEST=docs/releases/<release>.json ./deploy-frontend.sh
```

`deploy-frontend.sh` 只处理 `component: frontend` 的条目。它先校验整个清单，再从清单生成 staging 目录，备份并覆盖清单列出的完整前端运行时集合。当前集合包括主页面、身份/API/实时/敏感词脚本、角色图片，以及盲盒 HTML、CSS、脚本和地区数据；不再维护另一份硬编码复制列表。

`component: backend` 只把后端源码绑定到同一个版本号，不代表前端脚本会部署后端。后端发布必须使用独立的构建产物、迁移与 PM2 流程，并在生产清单中记录对应证据。清单外的线上文件不会由前端脚本删除；清单内受管文件会整体备份和整体覆盖。

`backend-handoff-package/growth-school.rollback-real-data.html` 是历史未版本化文件，不得作为部署或回滚输入。
