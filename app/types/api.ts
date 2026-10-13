import type { Config, Note, Topic } from "@yanqi/bot";

export interface Status {
  running: boolean;
  connected: boolean;
  groups: string[];
  model: string;
  decision: string;
}
export interface Group {
  id: string;
  name: string;
  members: number | null;
  enabled: boolean;
  automatic: boolean;
  admins: string[];
  statistics: {
    messages: number;
    documents: number;
    versions: number;
    pendingTasks: number;
    failedTasks: number;
  } | null;
}
export interface Member {
  id: string;
  name: string;
  nickname: string;
  role: string;
  administrator: boolean;
  inherited: boolean;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
export interface Settings {
  config: Config;
  secrets: Record<string, boolean>;
  autostart: boolean;
  napcatWebUrl: string;
  dataDirectory: string;
}
export interface Task {
  id: number;
  kind: string;
  state: string;
  attempts: number;
  progress: string | null;
  lastError: string | null;
  runAfter: number;
  payload: {
    groupId: string;
    topicId?: string;
    messageId?: number;
    assetId?: number;
    messageIds?: number[];
  };
}
export interface Delivery {
  id: number;
  kind: string;
  state: string;
  content: string;
  noteId: number | null;
  topicId: string | null;
  createdAt: number;
}
export interface RecordDetail {
  topic: Topic;
  note: Note | null;
  versions: {
    id: number;
    revision: number;
    createdAt: number;
    sourceThrough: number;
  }[];
  tasks: Pick<Task, "id" | "state" | "progress" | "lastError" | "runAfter">[];
}
export interface Overview {
  messages: number;
  records: number;
  pending: number;
  failed: number;
  calls: number;
  dailyLimit: number;
  day: string;
  recent: Topic[];
  tasks: Task[];
}
export interface LogEntry {
  id: number;
  time: number;
  level: string;
  name: string;
  text: string;
}
export interface Asset {
  id: number;
  kind: string;
  state: string;
  interpretation: string | null;
  error: string | null;
  downloadable: boolean;
}
export interface Message {
  id: number;
  messageId: string;
  userId: string;
  displayName: string;
  sentAt: number;
  text: string;
  isBot: boolean;
  addressed: boolean;
  recalledAt: number | null;
  replyTo: string | null;
  assets: Asset[];
}
export interface Memory {
  groupId: string;
  userId: string;
  key: string;
  content: string;
  updatedAt: number;
  sourceMessageId: number | null;
}
export interface Usage {
  day: string;
  calls: number;
  note: string;
  models: {
    provider: string;
    account: string;
    model: string;
    purpose: string;
    calls: number;
    measuredCalls: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  }[];
}
