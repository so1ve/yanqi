const numberFormat = new Intl.NumberFormat("zh-CN");
const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const formatNumber = (value: number | undefined | null) =>
  value === undefined || value === null ? "—" : numberFormat.format(value);

export const formatTime = (time: number) => timeFormat.format(time);
