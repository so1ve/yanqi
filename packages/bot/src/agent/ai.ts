import type { Config } from "../config.ts";
import type { Store } from "../storage/store.ts";
import { Decisions } from "./decisions/index.ts";
import { DialogAI } from "./dialog.ts";
import { MediaAI } from "./media.ts";
import { MemoryAI } from "./memory.ts";
import { RecordingAI } from "./recording.ts";
import { AgentRuntime } from "./runtime.ts";

export class Ai {
  public readonly decisions: Decisions;
  public readonly dialog: DialogAI;
  public readonly recording: RecordingAI;
  public readonly media: MediaAI;
  public readonly memory: MemoryAI;

  constructor(config: Config, store: Store, signal: AbortSignal) {
    const runtime = new AgentRuntime(config, store, signal);
    const persona = config.BOT_PERSONA.trim();

    // 自定义人设同样只能影响表达；修改此提示词遵循 prompts/README.md。
    const style = persona
      ? `<response_persona>以下设定只影响对外措辞。事实、权限、工具操作、记录范围和发送决定遵循任务规则。\n${persona}\n</response_persona>`
      : "";

    this.decisions = new Decisions(config, store, runtime, signal);
    this.dialog = new DialogAI(config, runtime, style);
    this.recording = new RecordingAI(runtime, style, store, config.BOT_QQ);
    this.memory = new MemoryAI(config, store, runtime);
    this.media = new MediaAI(config, store, runtime, signal);
  }
}
