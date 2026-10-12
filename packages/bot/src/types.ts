export interface Segment {
  type: string;
  data: Record<string, unknown>;
}

export interface IncomingMessage {
  groupId: string;
  messageId: string;
  userId: string;
  displayName: string;
  sentAt: number;
  receivedAt: number;
  text: string;
  segments: Segment[];
  raw: unknown;
  replyTo: string | null;
  isBot: boolean;
  addressed: boolean;
  role: "owner" | "admin" | "member";
  noteId?: number;
}

export interface Message extends Omit<IncomingMessage, "raw" | "noteId"> {
  id: number;
  rawJson: string;
  command: boolean;
  awaitingReply: boolean;
  recalledAt: number | null;
  noteId: number | null;
}

export interface Topic {
  id: string;
  groupId: string;
  title: string;
  description: string;
  focus: string;
  mode: "auto" | "manual";
  ownerId: string | null;
  state: "active" | "closed";
  lastActiveAt: number;
  lastSourceId: number;
  revision: number;
  generation: number;
  noteGeneration: number;
  directive: "auto" | "send" | "hold";
  directiveMessageId: number | null;
  endedAtMessageId: number | null;
}

export interface Asset {
  id: number;
  messageId: number;
  kind: "image" | "audio" | "video" | "file" | "forward";
  reference: string;
  state: "pending" | "saved" | "failed";
  path: string | null;
  interpretation: string | null;
  error: string | null;
}

export interface JobPayloads {
  intent: { groupId: string; messageId: number };
  observe: { groupId: string; messageIds: number[] };
  detect: { groupId: string; messageIds: number[] };
  summarize: {
    groupId: string;
    topicId: string;
    requested: boolean;
    publish?: boolean;
  };
  asset: { groupId: string; assetId: number };
}

export type JobKind = keyof JobPayloads;
export type Job<K extends JobKind = JobKind> = {
  [P in K]: {
    id: number;
    kind: P;
    payload: JobPayloads[P];
    attempts: number;
  };
}[K];

export interface Note {
  id: number;
  topicId: string;
  groupId: string;
  revision: number;
  sourceThrough: number;
  markdown: string;
  path: string;
  generation: number;
  sections: { messageIds: number[]; content: string }[];
}

export interface ChatMessage {
  id: string;
  author: string;
  userId: string;
  isBot: boolean;
  command: boolean;
  mentions: string[];
  time: string;
  text: string;
  replyTo: string | null;
}

export interface Memory {
  key: string;
  content: string;
  sourceId: string | null;
  updatedAt: number;
}

export interface Delivery {
  id: number;
  groupId: string;
  topicId: string | null;
  noteId: number | null;
  kind: "text" | "note";
  content: string;
}
