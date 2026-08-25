# CVM 自托管 MySQL 配置步骤

适用于当前南京 CVM：后端和 MySQL 都部署在同一台服务器，连接地址使用 `127.0.0.1:3306`。

> 隔离约束：这是“蛋蛋校园”专用数据库配置。不要将“航线”项目的 Supabase URL、密钥或迁移文件复制到本服务，也不要在“航线”项目中执行本目录的 Prisma migration。

## 1. 先检查服务器上的 MySQL

在 CVM 的 SSH 或腾讯云登录终端执行：

```bash
cat /etc/os-release
mysql --version
command -v mysql
sudo systemctl status mysql --no-pager || sudo systemctl status mysqld --no-pager
sudo ss -lntp | grep ':3306' || true
```

如果已显示 MySQL 版本和运行中的服务，不要重复安装。

## 2. 只有确认未安装时才安装

Ubuntu/Debian：

```bash
sudo apt update
sudo apt install -y mysql-server
sudo systemctl enable --now mysql
```

CentOS/Rocky/Alibaba Linux：

```bash
sudo dnf install -y mysql-server
sudo systemctl enable --now mysqld
```

## 3. 创建数据库和应用账号

先生成一组只用于应用的强密码。不要把 root 密码写进项目文件，也不要把下面的占位密码直接使用。

```bash
sudo mysql
```

进入 MySQL 后执行，把 `CHANGE_ME_TO_A_LONG_RANDOM_PASSWORD` 替换成新密码：

```sql
CREATE DATABASE IF NOT EXISTS dandan_world
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'app_user'@'127.0.0.1'
  IDENTIFIED BY 'CHANGE_ME_TO_A_LONG_RANDOM_PASSWORD';

ALTER USER 'app_user'@'127.0.0.1'
  IDENTIFIED BY 'CHANGE_ME_TO_A_LONG_RANDOM_PASSWORD';

GRANT ALL PRIVILEGES ON dandan_world.* TO 'app_user'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

确认应用账号能连接：

```bash
mysql -h 127.0.0.1 -u app_user -p -e "SELECT VERSION();"
```

## 4. 配置后端

把 `server` 工程上传到 CVM，然后在 CVM 的 `server/.env` 中填写：

```env
DATABASE_URL="mysql://app_user:你的应用密码@127.0.0.1:3306/dandan_world"
JWT_SECRET="至少32位的随机字符串"
PORT=3000
HOST=127.0.0.1
CORS_ORIGIN="你的前端地址"
```

如果密码包含 `@`、`#`、`:`、`/` 或空格，需要进行 URL 编码；初次配置可使用只含字母、数字和下划线的随机密码。

## 5. 执行数据库迁移

```bash
cd server
npm install
npm run prisma:generate
npm run prisma:deploy
npm run build
```

迁移成功后检查表：

```bash
mysql -h 127.0.0.1 -u app_user -p dandan_world -e "SHOW TABLES;"
```

应该至少看到 `users`、`auth_sessions`、`user_stats`、`user_characters`、`point_accounts`、`point_transactions` 和 `audit_logs`。

## 6. 启动后端

```bash
cd server
export DATABASE_URL='mysql://app_user:你的应用密码@127.0.0.1:3306/dandan_world'
export JWT_SECRET='至少32位的随机字符串'
export PORT=3000
export HOST=127.0.0.1
npm run start
```

另开一个终端检查：

```bash
curl http://127.0.0.1:3000/health
```

应返回：

```json
{"status":"ok"}
```

## 7. 网络安全

- 后端和 MySQL 同机时，MySQL 不需要开放安全组 3306。
- 对外只开放后端 HTTP/HTTPS 端口。
- 如果前端部署在另一台服务器，前端仍然只访问后端 API，不访问 MySQL。
- 定期备份 `/var/lib/mysql` 不够，必须使用 `mysqldump` 或云硬盘快照并实际演练恢复。
