# Greasy Fork 自动同步

工作流 `.github/workflows/greasyfork-sync.yml` 在 `main` 分支的安装脚本更新后发送带签名的 push Webhook，让 Greasy Fork 拉取脚本。工作流及发送工具更新也会触发，可从 Actions 手动运行。不需要另外在 GitHub Settings > Webhooks 创建重复的 Webhook。

## 一次性配置

1. 在 Greasy Fork 导入本脚本，或进入已发布脚本的「管理」页设置同步。同步 URL 填写：

   ```text
   https://raw.githubusercontent.com/KNaiFen/douyin-danmaku-performance/main/douyin-danmaku-performance.user.js
   ```

2. 打开 [GitHub 仓库 Actions Secrets](https://github.com/KNaiFen/douyin-danmaku-performance/settings/secrets/actions)，新增 Repository secret：

   - 名称：`GREASYFORK_WEBHOOK_SECRET`
   - 值：Greasy Fork 账号「设置 webhook」页面给出的 Secret。必须与 Greasy Fork 一致，不是 GitHub Token，也不是 Payload URL。

3. 打开 [Sync to Greasy Fork 工作流](https://github.com/KNaiFen/douyin-danmaku-performance/actions/workflows/greasyfork-sync.yml)，点击 Run workflow，选择 `main`，运行一次。首次成功后，Greasy Fork 的同步方式会显示为 Webhook。

Webhook 地址已配置为 `https://api.greasyfork.org/zh-CN/users/718827-knaifen/webhook`。密钥只从 Actions Secret 读取，不写入代码或日志。未配置密钥时会显示 Skipped 提示并结束，不发送请求；配置完成后需要手动运行或再次推送脚本。

## 后续发布

更新 `package.json` 和 `package-lock.json` 的版本，执行 `npm run build`，提交并推送生成的 `douyin-danmaku-performance.user.js` 到 `main`。Greasy Fork 同步的是这个安装文件；只修改 `src/` 不会发布。新版本应提高 `@version`，让油猴能够识别更新。

工作流读取运行时 `main` 的最新提交，因此重跑旧任务也会同步最新代码。发送只使用仓库读取权限；每次调用超时为 60 秒，同一仓库串行同步。HTTP 错误、无匹配脚本、同步校验失败和异常响应都会使任务失败。具体服务器校验原因可在 Greasy Fork 脚本管理页面排查。

## 接口依据与验证

GitHub Actions 的 push 事件省略了 commit 的 `modified` 字段，不能直接把事件 JSON 转发。发送工具构建只包含本脚本路径的通知，并指定已检出的提交 SHA。依据：[GitHub push 文档](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push)、[Greasy Fork 路径匹配源码](https://github.com/greasyfork-org/greasyfork/blob/master/lib/github.rb)。

请求同时附带 HMAC-SHA1 和 HMAC-SHA256 签名；前者用于兼容 Greasy Fork 当前验证逻辑。依据：[Greasy Fork Webhook 源码](https://github.com/greasyfork-org/greasyfork/blob/master/app/controllers/concerns/webhooks.rb)、[GitHub 签名说明](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)。

本地核验：`node --test tests/greasyfork-sync.test.mjs`。测试使用模拟响应验证签名、路径、成功/失败判断及密钥缺失处理，不请求真实发布接口。完整端到端同步需要上述密钥及 Greasy Fork 脚本绑定完成。
