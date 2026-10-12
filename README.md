# 言栖

言栖是用普通 QQ 账号工作的群聊书记，昵称“小栖”。它把收到的群消息保存到本地，用 AI 整理技术讨论、排错、方案比较和头脑风暴。

平时，小栖按批次判断哪些讨论或独立观点值得记录。@ 它时，可以指定要记录的内容，也可以查询或发送已有纪要。所有 @ 请求都由 AI 结合整句话、引用消息、近期对话和本群话题理解，拿不准时会请你说明。

话题简介、完整纪要和原文保存在本地 SQLite。更新纪要时复用已整理的段落，新增原文只生成新增部分；撤回或附件识别结果变化时，更新受影响的段落。查询时 AI 使用简介，发送全文时直接从数据库读取。

每版纪要也会导出到 `DATA_DIR/groups/<群号>/topics/<话题 ID>/v<版本号>/`。开始整理时先写出 `transcript.md`，随后逐批更新 `note.md`；尚未完成时文件顶部标为草稿，完成后去掉标记并将整版纪要保存到数据库。整理中断时，已写出的草稿仍可查看。原始讨论按北京时间排列，使用“昵称（QQ 号）：内容”的格式，保留多行正文、代码和附件链接。

在群里 @ 小栖说“找一下之前讨论数据库的记录”，可以查找已有纪要；说“把这份纪要发出来”，会从数据库读取全文发送。连续记录从开始请求之后算起，到结束请求之前为止，不受 AI 处理耗时影响。结束时也可以要求把更早的内容并入同一份记录，例如“结束记录，也包含刚才部署方案的讨论”。

讨论前不必先开启记录。说“从某人第一次发言到现在都记下来”，会从本群已保存的该成员首次发言起，读取随后所有人的讨论，不局限于近期上下文。

小栖追问后，同一位成员的下一句会继续交给 AI，不需要再次 @；引用小栖的回复也可以接着聊。是否属于上一轮对话仍由 AI 结合上下文判断。

也可以说“从全部讨论中找出对小栖的优化建议，另建一份文档”。AI 会把检索范围和整理要求交给后台，逐段读取截至这次请求本地保存的全部群成员消息，按语义保留相关建议、理由和分歧，不受近期上下文或单个话题限制。可以指定某一天、起止日期或多个话题；“今天”按北京时间的自然日计算。纪要只整理相关内容，附带的 `transcript.md` 保留检索范围内的完整原文，便于查看上下文。机器人接入前未保存的聊天不在范围内。

纪要按问题和方案归纳：合并重复赞同，保留不同观点、理由、条件和分歧。逐字聊天放在 `transcript.md`，纪要正文不逐条复述聊天。

`read_history` 供 AI 分页读取历史原文、核实内容；`record` 创建新文档，`update_record` 更新已有文档，`send` 发送已有纪要。标题可由 AI 拟定，不需要用户提供话题 ID 或逐条挑选消息。后台整理仍受每日 AI 调用预算限制，额度不足时延后重试。

“把这份纪要补全为全部历史里的相关建议”会更新原文档的范围和选材要求，重新整理受影响的内容，不必另建文档。

AI 通过 `reply` 工具在群里发言，普通文本输出不会自动转发。一次请求至多回复一条文字，保留人设语气，只说结果、必要的问题或自然对话，不播报内部判断和操作计划。

群回复的[系统提示词](src/agent/prompts.ts)已吸收 speak-plainly 的写作原则：通常一两句、60 字以内，单条最多 120 个字符；直接回答当前问题，删掉重复、无关状态、内部过程说明和套话收尾。原始 [skill 文件](skills/speak-plainly/SKILL.md)仅留作参考，运行时不读取或调用。相同要求同时用于 `reply` 内容生成和人设改写，优先于人设；工具参数和改写结果也限制为 120 字符。改写失败时只允许发送符合长度上限的原答复，过长回复按发送失败处理。纪要正文仍通过 `send` 完整发送，不受群回复长度限制。

对话、附件、话题识别、纪要整理和发送分别处理，长纪要不会堵住后面的 @ 请求，回复入队后也不必等 Agent 完全结束。每类任务按顺序执行，避免同时修改同一份记录；一份纪要中互不依赖的段落最多同时整理两段，按原文顺序写入。

刚安排整理时只能说“已开始”，不能说“记好了”。文件和数据库均保存成功后，按发送要求发纪要，或发一条保存通知，两者不重复。用户主动要求发送时仍可重发。同一次请求还问了其他问题，才另外调用 `reply` 回答。人设只影响发言语气，不能改变这些完成状态。

可以 @ 小栖询问记录和任务状态。后台整理、识别、附件和发送失败时，管理员可以要求“重试本群失败任务”。旧的 @ 请求不会从头重跑，避免重复开始、结束记录或改变范围；对话失败后，直接说明还要继续做什么。暂停自动整理后，仍会保存群消息并处理 @ 请求；自动任务等恢复后继续。

## 用 Docker 启动

安装 Docker 和 Docker Compose。已有 `.env` 就直接使用；没有时，先复制配置示例：

```sh
cp .env.example .env
```

填写机器人 QQ 号 `BOT_QQ`、记录群 `GROUP_IDS`、`ONEBOT_TOKEN`，以及 `AI_MODEL`。每个模型配置都使用 `BASE_URL,API_KEY,MODEL`，逗号之间不加空格，可以分别使用不同服务：

```dotenv
AI_MODEL=https://text.example/v1,text-api-key,text-model
AI_DETECT_MODEL=
AI_INTENT_MODEL=
AI_REPLY_MODEL=https://reply.example/v1,reply-api-key,reply-model
AI_VISION_MODEL=https://vision.example/v1,vision-api-key,vision-model
AI_AUDIO_MODEL=https://audio.example/v1,audio-api-key,audio-model
```

`AI_DETECT_MODEL`、`AI_INTENT_MODEL` 和 `AI_REPLY_MODEL` 留空时使用 `AI_MODEL` 的整套配置；`AI_VISION_MODEL` 和 `AI_AUDIO_MODEL` 留空时不解析对应附件。图片服务需要支持图片输入，音频服务需要支持 OpenAI 兼容的 `/audio/transcriptions`。原来的 `AI_BASE_URL`、`AI_API_KEY` 已合并进各模型配置，独立决策服务仍使用 `DECISION_*` 配置。

然后在项目目录运行：

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

默认 `LOG_LEVEL=info` 会记录任务入队、开始、完成或重试，AI 模型与轮次、返回状态和 token 用量，工具调用，以及群消息发送结果。日志带时间和耗时，AI 日志同时标明所属任务或发送编号；并行处理时仍能追到对应请求。整理进度、草稿路径和最终保存位置也会写入日志。

需要查看 AI 输入和返回片段、工具参数与结果、异常堆栈时，在 `.env` 中设置 `LOG_LEVEL=debug`，然后更新容器：

```sh
docker compose up -d --build yanqi
docker compose logs -f yanqi
```

Debug 日志可能包含聊天内容，每条详情最多显示 2000 个字符，并隐藏配置中的 AI 密钥、决策服务密钥和 OneBot token。不会打印请求头、完整配置或图片的 base64 数据。开启 debug 只调整言栖的日志，不开启适配器的底层报文日志。

## TODOs

- [ ] 实现一个 WebUI 管理面板，这样可以把 .env 大部分配置放进去
