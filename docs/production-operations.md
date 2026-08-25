# 生产运维收尾

## 备份

在 CVM 项目目录 `/root/dandan-world-server-20260824004500` 执行：

```bash
chmod 700 server/deploy/backup-dandan-world.sh server/deploy/verify-backup.sh
server/deploy/backup-dandan-world.sh
latest=$(ls -1t /root/backups/dandan_world/dandan_world-*.sql.gz | head -n 1)
server/deploy/verify-backup.sh "$latest"
```

脚本从 `.env` 读取 `DATABASE_URL`，不会把密码写入命令行或输出；备份文件权限为 `0700` 目录和当前用户创建的文件，并自动清理 14 天以前的归档。恢复必须在单独的临时数据库验证，禁止直接覆盖生产库：

```bash
gzip -cd "$latest" | mysql --protocol=tcp -h 127.0.0.1 -u <restore_user> -p dandan_world_restore
```

## 监控

- `GET https://dsxnb.com/dd/health` 每 60 秒探测，连续 3 次失败告警。
- 进程检查：`pm2 describe dandan-world`，异常时先看 `pm2 logs dandan-world --lines 100`。
- 磁盘检查：备份目录所在分区低于 20% 空间时告警。
- 不记录 `DATABASE_URL`、JWT、短信密钥或验证码内容。
- `/dd` 子路径部署上游使用 `COOKIE_PATH=/api`，Nginx 必须执行 `proxy_cookie_path /api /dd/api`；否则浏览器不会把 refresh cookie 发送到盲盒 API 路径。

## 回滚

1. 保留当前运行目录和上一版本目录，不覆盖旧目录。
2. 停止并切换 `dandan-world` 的 `cwd` 到上一版本，加载该版本 `.env` 后执行 `pm2 restart dandan-world --update-env`。
3. 验证 `/dd/health` 返回 200、受保护 API 返回 401，再恢复 Nginx 路由。
4. 静态文件回滚只替换 `/var/www/dd` 对应版本目录，根站 `/var/www` 及“航线”配置不得改动。
