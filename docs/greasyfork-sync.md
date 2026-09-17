# Greasy Fork 自动同步

使用 GitHub 仓库 Settings > Webhooks 直接通知 Greasy Fork，不使用 GitHub Actions。密钥填写在 Webhook 的 Secret 字段，不需要 Actions Secret。

本仓库已创建 [Greasy Fork Webhook](https://github.com/KNaiFen/douyin-danmaku-performance/settings/hooks/680616867)，地址、JSON、push 事件和 SSL 验证已预设；当前未启用，等待你填写 Secret 后勾选 Active 并保存。

## 一次性配置

1. 在 Greasy Fork 导入本脚本，或进入已发布脚本的「管理」页设置同步。同步 URL 填写：

   ```text
   https://raw.githubusercontent.com/KNaiFen/douyin-danmaku-performance/main/douyin-danmaku-performance.user.js
   ```

2. 打开 [GitHub 仓库 Webhooks](https://github.com/KNaiFen/douyin-danmaku-performance/settings/hooks)，编辑对应的 Greasy Fork Webhook；如果尚无对应条目，点击 Add webhook。参数如下：

   | 字段 | 值 |
   | --- | --- |
   | Payload URL | `https://api.greasyfork.org/zh-CN/users/718827-knaifen/webhook` |
   | Content type | `application/json` |
   | Secret | Greasy Fork 账号「设置 webhook」页提供的 Secret |
   | SSL verification | Enable SSL verification |
   | Which events | Just the push event |
   | Active | 填完 Secret 后勾选 |

3. 保存 Webhook。密钥由你填写，必须与 Greasy Fork 一致，不是 GitHub Token 或 Payload URL。未配置密钥前保持 Active 关闭，避免发送无法验证的请求。

4. 推送一次安装脚本的版本更新，进入 Webhook 的 Recent Deliveries 检查 push 响应。`updated_scripts` 应包含本脚本，`updated_failed` 应为空；同时检查 Greasy Fork 版本。首次成功同步后，其同步方式会显示为 Webhook。ping 成功只代表连接与签名验证通过，不代表脚本已更新。

## 后续发布

更新 `package.json` 和 `package-lock.json` 的版本，执行 `npm run build`，提交并推送生成的 `douyin-danmaku-performance.user.js` 到 `main`。Greasy Fork 同步的是这个安装文件；只修改 `src/` 不会发布。新版本应提高 `@version`，让油猴能够识别更新。

GitHub 原生 Webhook 自带签名和修改文件列表，Greasy Fork 根据同步 URL 匹配仓库、分支与文件。HTTP 403 通常表示 Secret 不匹配；HTTP 200 但 `updated_scripts` 为空仍不代表同步成功，应检查抖音脚本是否已导入且 Raw URL 是否一致。同步失败时查看响应与 Greasy Fork 管理页；重发历史 push 可能重新同步旧提交，优先使用最新脚本对应的事件。

原 Actions 工作流和发送工具已移除，不再使用 `GREASYFORK_WEBHOOK_SECRET`；如果此前自行添加过这个 Actions Secret，可以删除。

参考：[GitHub 创建 Webhook](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks)、[Greasy Fork 路径匹配源码](https://github.com/greasyfork-org/greasyfork/blob/master/lib/github.rb)、[Greasy Fork Webhook 源码](https://github.com/greasyfork-org/greasyfork/blob/master/app/controllers/concerns/webhooks.rb)。
