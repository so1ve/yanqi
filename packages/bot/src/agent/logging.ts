import type { Agent } from "@earendil-works/pi-agent-core";
import { Logger } from "@koishijs/core";

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

        const text = message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
        const thinkingChars = message.content.reduce(
          (size, part) =>
            size + (part.type === "thinking" ? part.thinking.length : 0),
          0,
        );
        const toolCalls = message.content.filter(
          (part) => part.type === "toolCall",
        );

        logger.info(
          "%s 模型返回：stop=%s tokens=%s/%s 正文=%s字符 思考=%s字符 工具=%s 参数=%s字符 cache=%s/%s 耗时=%s",
          label,
          message.stopReason,
          message.usage.input,
          message.usage.output,
          text.length,
          thinkingChars,
          toolCalls.map((call) => call.name).join(",") || "无",
          toolCalls.reduce(
            (size, call) => size + JSON.stringify(call.arguments).length,
            0,
          ),
          message.usage.cacheRead,
          message.usage.cacheWrite,
          message.durationMs === undefined
            ? "未知"
            : `${Math.round(message.durationMs)} ms`,
        );
        logger.debug(
          "%s 返回内容：\n%s",
          label,
          logDetail(message.errorMessage || text, config),
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
          "%s 工具参数：call=%s\n%s",
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
          "%s 工具结果：call=%s\n%s",
          label,
          event.toolCallId,
          logDetail(event.result, config),
        );

        break;
      }
    }
  });
}
