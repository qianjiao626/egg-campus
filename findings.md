# 数据库建设发现

## 已确认

- 当前项目是单文件前端 Demo，内存变量刷新即丢失，无 fetch/Ajax/API。
- 交接文档已经给出 users、user_stats、tasks、task_claims、ratings、point_logs、gossip、notifications、feedback_tickets、user_characters 等表的初稿。
- 当前三类任务的状态和交互并不完全统一，组队型任务缺少完整的经验值和互评闭环。

## 建模调整建议

- users 负责身份和公开资料；密码只保存 password_hash，不保存明文密码。
- 蛋蛋币不应只依赖 users.points：至少增加 available_balance、frozen_balance 或独立 point_accounts 表，并用 point_transactions 记录每次变动。
- 任务状态、认领状态和结算状态应分开建模，避免用一个字段表达多个角色的状态。
- 联系方式不能随公开任务详情返回，只有配对双方在授权状态下读取。
- 评价必须使用数据库唯一约束和服务端权限校验防重复。
- 自动退款必须由后端定时任务执行，不能依赖页面打开或刷新。

## 风险

- 直接套用交接文档中的 ENUM 会让后续状态扩展变更困难；建议用 VARCHAR + CHECK 或状态字典表，并由后端状态机约束。
- 仅在腾讯云控制台开放公网白名单会扩大攻击面；优先 VPC 内网，开发时使用受限固定 IP 或 SSH 隧道。
- 生产库、测试库和本地开发库必须隔离，禁止共用账号和连接串。
