# 提交流程

- 每次提交前运行 `pnpm lint:fix`，修复格式错误后再提交。
- 每次提交后，在项目根目录运行 `docker compose up -d --build --remove-orphans`，确认服务启动。
