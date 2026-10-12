export function beijingTime(timestamp: number): string {
  return `${new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, 19)}+08:00`;
}

export function beijingDate(timestamp: number): string {
  return beijingTime(timestamp).slice(0, 10);
}
