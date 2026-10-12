# 言栖

言栖是用普通 QQ 账号工作的群聊书记，昵称“小栖”。它把收到的群消息保存到本地，用 AI 整理技术讨论、排错、方案比较和头脑风暴。

平时，小栖按批次判断哪些讨论或独立观点值得记录。@ 它时，可以指定要记录的内容，也可以查询或发送已有纪要。所有 @ 请求都由 AI 结合整句话、引用消息、近期对话和本群话题理解，拿不准时会请你说明。

## 用 Docker 启动

安装 Docker 和 Docker Compose。已有 `.env` 就直接使用；没有时，先复制配置示例：

```sh
cp .env.example .env
```

填写机器人 QQ 号 `BOT_QQ`、记录群 `GROUP_IDS`、`ONEBOT_TOKEN`，以及 AI 服务的 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`。然后在项目目录运行：

```sh
docker compose up -d --build
```

Compose 一起启动 NapCat 和言栖。言栖读取本地 `.env`，通过 `ws://napcat:3001` 连接 NapCat；两边共用 `ONEBOT_TOKEN`，消息格式自动设为 `array`。容器配置不需要改动 `.env` 中用于本地运行的 `ONEBOT_URL`。

需要密码自动登录时，在 `.env` 中填写 `NAPCAT_QUICK_PASSWORD_MD5`，值为 QQ 密码的 32 位 MD5。NapCat 会先使用已保存的登录状态，首次登录或快速登录失败时再尝试密码登录。QQ 若要求验证码或新设备验证，需要在 WebUI 中完成。参数和登录流程见 [NapCat 登录实现](https://github.com/NapNeko/NapCatQQ/blob/main/packages/napcat-shell/base.ts)。

需要扫码或完成登录验证时，打开 [NapCat WebUI](http://127.0.0.1:6099/webui)，从日志中获取 WebUI 登录 token。扫码时使用 `BOT_QQ` 对应的 QQ。WebUI token 与 `ONEBOT_TOKEN` 是两个不同的凭据。登录方式见 [NapCat 官方说明](https://github.com/NapNeko/NapCat-Docker#登录)。

```sh
docker compose logs -f napcat
```

QQ 登录后，言栖会自动连接。查看言栖日志：

```sh
docker compose logs -f yanqi
```

## TODOs

- [ ] 实现一个 WebUI 管理面板，这样可以把 .env 大部分配置放进去
