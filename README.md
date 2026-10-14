# 言栖

使用普通 QQ 账号的群聊助手，昵称“小栖”。保存收到的消息和附件，按要求整理纪要，提供 Web 管理台。通过 NapCat 连接 QQ。

## 部署

安装 Docker 和 Docker Compose 后运行：

```sh
docker compose up -d --build --remove-orphans
docker compose logs yanqi napcat
```

1. 打开[管理台](http://127.0.0.1:3210)，用日志中的安装码设置管理密码。
2. 打开 [NapCat 管理页](http://127.0.0.1:6099/webui)，用 NapCat 日志中的登录 Token 进入并登录 QQ。
3. 在 NapCat 启用正向 WebSocket 服务端：监听 `0.0.0.0:3001`，设置 Token，消息格式选 `array`，开启“上报自身消息”。
4. 在言栖设置中填写机器人 QQ 号、相同的 OneBot Token 和主模型配置。连接地址默认为 `ws://napcat:3001`。同步群列表，开启需要保存消息的群。

端口默认只监听本机，远程访问需配置端口转发或反向代理。反向代理需保留 `Host` 并设置 `X-Forwarded-Proto`。

数据保存在 `data/`，包含消息、附件、纪要、配置和 QQ 登录状态。备份时先停止服务，再复制整个目录。

更新后重新运行上述启动命令。查看运行日志：

```sh
docker compose logs -f yanqi
```
