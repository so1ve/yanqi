import type { InternalApi } from "nitropack/types";

export type Status = InternalApi["/api/status"]["get"];
export type Group = InternalApi["/api/groups"]["get"][number];
export type Member = InternalApi["/api/groups/:groupId/members"]["get"][number];
export type Settings = InternalApi["/api/settings"]["get"];
export type Task =
  InternalApi["/api/groups/:groupId/tasks"]["get"]["items"][number];
export type Delivery =
  InternalApi["/api/groups/:groupId/deliveries"]["get"]["items"][number];
export type RecordItem =
  InternalApi["/api/groups/:groupId/records"]["get"]["items"][number];
export type RecordDetail =
  InternalApi["/api/groups/:groupId/records/:topicId"]["get"];
export type Overview = InternalApi["/api/overview"]["get"];
export type LogEntry = InternalApi["/api/logs"]["get"][number];
export type Message =
  InternalApi["/api/groups/:groupId/messages/read"]["post"][number];
export type Memory = InternalApi["/api/memories"]["get"]["items"][number];
export type Usage = InternalApi["/api/groups/:groupId/usage"]["get"];
export type PurgeResult = InternalApi["/api/storage/purge"]["post"];

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
