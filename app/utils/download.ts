export function downloadText(
  name: string,
  text: string,
  type = "text/plain",
): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: `${type};charset=utf-8` }),
  );
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
