# 认证发布检查清单

## 代码与数据边界

- [ ] 发布包只包含蛋蛋校园 `server`，不包含“航线”源码、Supabase URL、Supabase key 或迁移文件。
- [ ] `DATABASE_URL` 指向 CVM 本机 `dandan_world`，MySQL/MariaDB 3306 未开放公网。
- [ ] `.env`、数据库密码、JWT secret、短信密钥未进入压缩包或版本库。

## 认证安全

- [ ] 验证码哈希、过期、单次消费、错误次数和限流测试通过。
- [ ] 登录错误文案不泄露账号是否存在；找回密码请求响应一致。
- [ ] access token、refresh token 轮换、退出和重置后的会话撤销测试通过。
- [ ] 生产 provider 为 `tencent_sms` 且必填配置完整；Mock 只用于开发/测试。

## 部署与验收

- [ ] Prisma migration 在备份后执行，`prisma migrate status` 正常。
- [ ] `/health`、验证码、注册、登录、刷新、退出和找回密码烟测通过。
- [ ] API 由 systemd/PM2 守护，监听 localhost 并由 HTTPS 反向代理暴露。
- [ ] 记录迁移 ID、备份位置、provider 配置状态和回滚步骤。

## 隔离声明

本次蛋蛋校园认证发布只使用 CVM 上的 `dandan_world` MariaDB；“航线” Supabase 未被读取或修改。
