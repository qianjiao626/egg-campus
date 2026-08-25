# 蛋蛋校园（egg-campus）

蛋蛋校园主站 `/dd` 子路径项目，包含主站前端、盲盒交友内容组件、认证与盲盒后端、MariaDB/Prisma 迁移和协作文档。

## 目录

- `backend-handoff-package/`：主站与盲盒前端静态源码
- `server/`：Fastify + TypeScript 后端、Prisma schema/迁移和测试
- `docs/`：产品、部署、认证和 Obsidian 同步文档

## 本地开发

```powershell
cd server
Copy-Item .env.example .env
npm install
npm run build
npm test
```

运行前请在本机 `.env` 配置自己的数据库连接和 JWT 密钥；`.env`、构建产物、部署包和本地凭据不会提交到仓库。

## 部署边界

- 生产站点使用 `dsxnb.com/dd`，相关 Nginx/备份脚本位于 `server/deploy/`。
- 根站“航线”及其 Supabase 不属于本仓库的部署范围。
- 数据库迁移必须先在备份和临时环境验证，再执行生产迁移。

## 协作约定

每项任务开始前评估相关 GitHub skills；完成后更新 `docs/obsidian-sync/` 中的变更日志、验证记录或待办。不要提交密码、Token、验证码、短信密钥或云 Secret。
