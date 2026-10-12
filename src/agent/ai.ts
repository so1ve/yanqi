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
    this.decisions = new Decisions(config, store, runtime);

    this.dialog = new DialogAI(config, store, runtime);
    this.recording = new RecordingAI(config, runtime, this.decisions);
    this.media = new MediaAI(config, store, runtime);
  }
}
