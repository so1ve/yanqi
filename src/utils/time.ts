export const beijingTime = (timestamp: number): string =>
  `${new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, 19)}+08:00`;

export const beijingDate = (timestamp: number): string =>
  beijingTime(timestamp).slice(0, 10);
