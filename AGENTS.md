# 提交流程

- 每完成一个功能并通过必要验证，立即创建提交，不等待用户再次提醒。用户已授权此流程。
- 每次提交前运行 `pnpm lint:fix`，修复格式错误后再提交。
- 每次提交后，在项目根目录运行 `docker compose up -d --build --remove-orphans`，确认服务启动。

# 提示词

- 不要随意修改提示词。确需调整时，先阅读 [提示词维护规范](packages/bot/src/agent/prompts/README.md)，参考其中的 speak-plainly、Anthropic 和 Gemini 指南。
- 修改前核对调用方、工具实现和输入输出约定；修改后验证相关行为，不以增加重复禁令或关键词特判代替修复。
