# 验证码 Provider 运维手册

## Mock（开发/测试）

```env
VERIFICATION_PROVIDER=disabled
```

Mock provider 只用于本地和隔离测试，验证码保存在进程内供测试断言，不能用于生产。前端接口不会返回验证码。

## 腾讯云 SMS（生产）

在 CVM 的 `server/.env` 中配置，不要提交到 Git：

```env
短信 provider 当前不启用，不配置腾讯云 SMS 密钥。
TENCENTCLOUD_SECRET_ID="最小权限子账号 SecretId"
TENCENTCLOUD_SECRET_KEY="对应 SecretKey"
TENCENT_SMS_SDK_APP_ID="短信应用 SDK AppID"
TENCENT_SMS_SIGN_NAME="已审核短信签名"
TENCENT_SMS_TEMPLATE_ID="已审核验证码模板 ID"
TENCENT_SMS_REGION="ap-nanjing"
```

生产启动时明确使用 `VERIFICATION_PROVIDER=disabled`；如未来重新启用短信，需单独完成供应商、权限、模板和密钥审计。

## 故障处理

- 收不到短信：先检查模板审核状态、手机号格式、短信发送记录和子账号权限。
- 服务端返回 `VERIFICATION_UNAVAILABLE`：检查 provider 配置和腾讯云 API 网络访问；不要通过日志打印验证码。
- 发送失败记录只保留 provider 错误代码、渠道和用途，不记录目标完整值或验证码。
- 过期验证码应由定时清理任务删除；清理失败不影响验证接口的过期判断。
