import type { Agent } from "@earendil-works/pi-agent-core";
import { Logger } from "koishi";

import type { Config } from "../config.ts";
import { logDetail } from "../utils/logging.ts";

const logger = new Logger("yanqi:ai");

export function logAgentEvents(
  agent: Agent,
  config: Config,
  label: string,
): void {
  agent.subscribe((event) => {
    switch (event.type) {
      case "message_end": {
        const message = event.message;

        if (message.role !== "assistant") {
          return;
        }

        logger.info(
          "%s 模型返回：stop=%s tokens=%s/%s cache=%s/%s 耗时=%s",
          label,
          message.stopReason,
          message.usage.input,
          message.usage.output,
          message.usage.cacheRead,
          message.usage.cacheWrite,
          message.durationMs === undefined
            ? "未知"
            : `${Math.round(message.durationMs)} ms`,
        );
        logger.debug(
          "%s 返回内容：%s",
          label,
          logDetail(
            message.errorMessage ||
              message.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join(""),
            config,
          ),
        );

        break;
      }

      case "tool_execution_start": {
        logger.info(
          "%s 工具开始：%s call=%s",
          label,
          event.toolName,
          event.toolCallId,
        );
        logger.debug(
          "%s 工具参数：call=%s %s",
          label,
          event.toolCallId,
          logDetail(event.args, config),
        );

        break;
      }

      case "tool_execution_end": {
        logger[event.isError ? "warn" : "info"](
          "%s 工具%s：%s call=%s 耗时=%s",
          label,
          event.isError ? "失败" : "完成",
          event.toolName,
          event.toolCallId,
          event.durationMs === undefined
            ? "未执行"
            : `${Math.round(event.durationMs)} ms`,
        );
        logger[event.isError ? "warn" : "debug"](
          "%s 工具结果：call=%s %s",
          label,
          event.toolCallId,
          logDetail(event.result, config),
        );

        break;
      }
    }
  });
}
