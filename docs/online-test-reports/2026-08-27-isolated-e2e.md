# 蛋蛋校园隔离数据库 E2E 测试报告

- 测试目标：`http://127.0.0.1:13311`（SSH 隧道后的隔离测试服务）
- 生成时间：2026-08-28T01:34:15.566Z
- 说明：测试记录仅写入隔离库并在启动器前后清理；未连接生产数据库。

| 测试时间 | 用例项 | 预期结果 | 实际结果 | 是否通过 | 问题简述 |
| --- | --- | --- | --- | --- | --- |
| 2026-08-28T01:34:10.434Z | 服务健康检查 | 返回 200 与 status=ok | {"status":"ok"} | 通过 |  |
| 2026-08-28T01:34:10.510Z | 隔离管理员登录及权限 | 管理员身份有效且拥有 task.review | {"user":{"id":"1","nickname":"isolated-e2e-admin","role":"admin","status":"active","school":"隔离测试大学","major":"软件工程","city":"东京","grade":null,"age":null,"bio":"全量隔离测试资料。","mbtiType":"INTJ","mbtiGroup":"NT","likes":0,"reputation":0,"eggCategory":"study","eggRarity":"N","createdAt":... | 通过 |  |
| 2026-08-28T01:34:10.946Z | 注册邀请人 | 昵称密码注册成功并获得邀请码 | {"nickname":"验收甲7880850434","password":"[REDACTED]","user":{"id":"110","nickname":"验收甲7880850434","role":"student","status":"active","school":null,"major":null,"city":null,"grade":null,"age":null,"bio":null,"mbtiType":null,"mbtiGroup":null,"likes":0,"reputation":0,"eggCategory":"... | 通过 |  |
| 2026-08-28T01:34:11.312Z | 邀请码注册受邀用户 | 有效邀请码绑定成功 | {"nickname":"验收乙7880850434","password":"[REDACTED]","user":{"id":"111","nickname":"验收乙7880850434","role":"student","status":"active","school":null,"major":null,"city":null,"grade":null,"age":null,"bio":null,"mbtiType":null,"mbtiGroup":null,"likes":0,"reputation":0,"eggCategory":"... | 通过 |  |
| 2026-08-28T01:34:11.696Z | 注册跨用户验收账号 | 第三个隔离账号注册成功 | {"nickname":"验收丙7880850434","password":"[REDACTED]","user":{"id":"112","nickname":"验收丙7880850434","role":"student","status":"active","school":null,"major":null,"city":null,"grade":null,"age":null,"bio":null,"mbtiType":null,"mbtiGroup":null,"likes":0,"reputation":0,"eggCategory":"... | 通过 |  |
| 2026-08-28T01:34:12.067Z | Cookie 刷新与登录恢复 | refresh 轮换 Cookie，新 accessToken 可读取 /me | {"userId":"111","cookieRotated":"[REDACTED]"} | 通过 |  |
| 2026-08-28T01:34:12.178Z | 个人资料首次编辑与持久化 | 学校、专业、兴趣、技能写库并在刷新查询后保留 | {"school":"南京验收大学","interests":["摄影"],"skills":["TypeScript"]} | 通过 |  |
| 2026-08-28T01:34:12.268Z | 个人资料二次编辑与持久化 | 第二次编辑城市、简介、兴趣、技能后刷新不丢失 | {"city":"南京","interests":["摄影","跑步"],"skills":["Node.js"]} | 通过 |  |
| 2026-08-28T01:34:12.506Z | 发布带技能标签任务 | 任务进入待审核且技能字段入库 | {"id":"67","userId":"111","title":"[demo] 持久化任务7880850434","description":"验证跨用户可见与接取持久化","remark":null,"taskType":"help","claimMode":"single","reward":0,"publishExpReward":10,"maxClaimers":1,"contact":null,"requirements":null,"skillCategory":"软件开发","skillSubcategory":"TypeScript"... | 通过 |  |
| 2026-08-28T01:34:12.589Z | 管理员待审核任务可见 | 非发布者管理员可读取任务 | {"taskId":"67"} | 通过 |  |
| 2026-08-28T01:34:12.642Z | 任务退回修改与技能标签更新 | 发布者修改技能后重新进入待审核并持久化 | {"skillCategory":"后端开发","skillSubcategory":"Node.js"} | 通过 |  |
| 2026-08-28T01:34:12.833Z | 审核公开与跨用户可见 | 审核通过后其他合法用户可见，并收到公共/私有实时事件 | {"publicEvent":{"type":"task.approved","resourceId":"67","scope":"public","occurredAt":"2026-08-28T01:34:12.792Z"},"privateEvent":{"type":"task.reviewed","resourceId":"67","scope":"private","occurredAt":"2026-08-28T01:34:12.606Z"},"visible":true} | 通过 |  |
| 2026-08-28T01:34:12.993Z | 任务接取与放弃持久化 | 接取人数刷新为 1，放弃后刷新为 0 | {"beforeAbandon":1,"afterAbandon":0} | 通过 |  |
| 2026-08-28T01:34:13.226Z | 教学任务协商取消持久化 | 双方协商后任务和认领取消，冻结的蛋蛋币恢复 | {"taskId":"68","requestId":"26","balanceRestored":true} | 通过 |  |
| 2026-08-28T01:34:13.920Z | 邀请码首次审核任务奖励 | 邀请关系标记 rewarded，邀请人增加 20 蛋蛋币 | {"rewardedCount":1,"balance":120} | 通过 |  |
| 2026-08-28T01:34:13.983Z | 邀请发布任务接口与通知持久化 | 邀请他人发布任务成功并写入对方通知，自邀与超 7 个技能被拒绝 | {"invited":true,"notificationId":"373"} | 通过 |  |
| 2026-08-28T01:34:14.122Z | 技能标签上限 7 个 | 提交 8 个技能被后端拒绝 | {"error":"VALIDATION_ERROR"} | 通过 |  |
| 2026-08-28T01:34:14.151Z | 打听发布与公共实时事件 | 打听写库并实时通知在线用户 | {"id":"37","userId":"110","title":"[demo] 校园打听7880850434","content":"图书馆开放时间是什么？","tags":["校园"],"bounty":0,"status":"open","coinStatus":"open","likes":0,"adopted":false,"adoptedReplyId":null,"deadline":null,"createdAt":"2026-08-28T01:34:14.097Z","updatedAt":"2026-08-28T01:34:14.0... | 通过 |  |
| 2026-08-28T01:34:14.263Z | 打听回复、点赞与列表刷新 | 回答写库，点赞状态和数量由后端返回 | {"id":"32","inquiryId":"37","userId":"112","content":"晚上十点闭馆","kind":"answer","parentId":null,"createdAt":"2026-08-28T01:34:14.223Z"} | 通过 |  |
| 2026-08-28T01:34:14.478Z | 打听采纳持久化 | 提问者可采纳回答，刷新后状态保留 | {"adopted":true,"adoptedReplyId":"32"} | 通过 |  |
| 2026-08-28T01:34:14.574Z | 盲盒偏好、投放、抽取与推荐 | 偏好和玩法记录持久化，推荐包含匹配用户，抽取消耗 1 蛋蛋币 | {"availablePrestige":99,"recommended":true} | 通过 |  |
| 2026-08-28T01:34:14.866Z | 好友申请去重与聊天前置权限 | 未接受时禁止聊天，重复待处理请求被拒绝 | {"id":"34","requesterId":"112","recipientId":"110","status":"pending","createdAt":"2026-08-28T01:34:14.813Z","updatedAt":"2026-08-28T01:34:14.813Z"} | 通过 |  |
| 2026-08-28T01:34:15.039Z | 接受好友后聊天与私有实时事件 | 接受后双方可聊天，消息仅向相关用户实时推送 | {"type":"buddy.message.created","resourceId":"33","scope":"private","occurredAt":"2026-08-28T01:34:15.108Z"} | 通过 |  |
| 2026-08-28T01:34:15.330Z | 声望排行榜动态数据 | 排行榜从真实注册用户与持久化分值生成 | {"entries":3} | 通过 |  |
| 2026-08-28T01:34:15.376Z | WebSocket 断线后的 REST 兜底 | 关闭实时连接后 REST 仍可拉取完整业务数据 | {"tasksFallback":true,"inquiriesFallback":true} | 通过 |  |
