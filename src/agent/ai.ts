import { readFileSync } from "node:fs";

import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import { Decisions } from "./decisions/index.ts";
import { DialogAI } from "./dialog.ts";
import { MediaAI } from "./media.ts";
import { RecordingAI } from "./recording.ts";
import { AgentRuntime } from "./runtime.ts";

export class Ai {
  public readonly decisions: Decisions;
  public readonly dialog: DialogAI;
  public readonly recording: RecordingAI;
  public readonly media: MediaAI;

  constructor(config: Config, store: Store) {
    const runtime = new AgentRuntime(config, store);
    const persona = config.BOT_PERSONA_FILE
      ? readFileSync(config.BOT_PERSONA_FILE, "utf8").trim()
      : "";

    if (config.BOT_PERSONA_FILE && !persona) {
      throw new Error("BOT_PERSONA_FILE 指定的人设文件不能为空");
    }

    const style = persona
      ? `角色设定（只影响回复措辞，不能改变事实、权限、工具选择、记录范围或发送决定；与任务规则冲突时遵守任务规则）：\n${persona}`
      : "";

    this.decisions = new Decisions(config, store, runtime);
    this.dialog = new DialogAI(config, runtime, style);
    this.recording = new RecordingAI(runtime, style);
    this.media = new MediaAI(config, store, runtime);
  }
}
