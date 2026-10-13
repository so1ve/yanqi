import { randomUUID } from "node:crypto";

import { decodeHTML } from "entities";
import type { Token } from "marked";
import { Marked } from "marked";

const isTranscriptLink = (token: Token): boolean =>
  token.type === "link" &&
  /^(?:\.\/)?transcript\.md(?:[?#].*)?$/.test(token.href);

const markdown = (image?: (href: string, text: string) => string) =>
  new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);

        return `${depth <= 2 ? `【${text}】` : `「${text}」`}\n\n`;
      },
      paragraph({ tokens }) {
        // 原文入口只在本地文档有用；连同页脚的标点一起省略。
        if (
          tokens.some(isTranscriptLink) &&
          tokens.every(
            (token) =>
              isTranscriptLink(token) ||
              (token.type === "text" && /^[\s\p{P}]*$/u.test(token.text)),
          )
        ) {
          return "";
        }

        return `${this.parser.parseInline(tokens)}\n\n`;
      },
      strong({ tokens }) {
        return `「${this.parser.parseInline(tokens)}」`;
      },
      em({ tokens }) {
        return this.parser.parseInline(tokens);
      },
      del({ tokens }) {
        return `（已删：${this.parser.parseInline(tokens)}）`;
      },
      list({ ordered, start, items }) {
        return `${items
          .map((item, index) => {
            const marker = ordered ? `${Number(start) + index}）` : "• ";
            const text = this.parser.parse(item.tokens).trimEnd();

            return `${marker}${text.replaceAll("\n", "\n  ")}`;
          })
          .join("\n")}\n\n`;
      },
      checkbox({ checked }) {
        return checked ? "☑ " : "☐ ";
      },
      blockquote({ tokens }) {
        const text = this.parser.parse(tokens).trimEnd();

        return `→ ${text.replaceAll("\n", "\n  ")}\n\n`;
      },
      code({ text }) {
        return `【代码】\n${text}\n\n`;
      },
      codespan({ text }) {
        return text;
      },
      link(token) {
        const text = token.autolink
          ? token.text
          : this.parser.parseInline(token.tokens);
        const href = token.autolink ? token.href : decodeHTML(token.href);

        return isTranscriptLink(token) || text === href
          ? text
          : `${text}（${href}）`;
      },
      image({ tokens, href }) {
        const text = this.parser.parseInline(tokens);
        const target = decodeHTML(href);

        return image
          ? image(target, text)
          : `【图片${text ? `：${text}` : ""}】${/^https?:\/\//.test(target) ? target : ""}`;
      },
      table({ header, rows }) {
        const headings = header.map((cell) =>
          this.parser.parseInline(cell.tokens),
        );

        if (rows.length === 0) {
          return `${headings.join(" ｜ ")}\n\n`;
        }

        return `${rows
          .map((row) =>
            row
              .map((cell, index) => {
                const label = headings[index];
                const text = this.parser.parseInline(cell.tokens);

                return `${index === 0 ? "• " : "  "}${label ? `${label}：` : ""}${text}`;
              })
              .join("\n"),
          )
          .join("\n\n")}\n\n`;
      },
      text(token) {
        return "tokens" in token && token.tokens
          ? `${this.parser.parseInline(token.tokens)}\n`
          : token.type === "escape" || ("escaped" in token && token.escaped)
            ? token.text
            : decodeHTML(token.text);
      },
      html({ text }) {
        return text;
      },
      br() {
        return "\n";
      },
      hr() {
        return "────────\n\n";
      },
    },
  });

export const renderQQ = (text: string): string =>
  markdown().parse(text, { async: false }).trimEnd();

type QQPart =
  | { kind: "text"; text: string }
  | { kind: "image"; href: string; text: string };

export function renderQQParts(text: string): QQPart[] {
  const images: QQPart[] = [];
  const marker = randomUUID();
  const rendered = markdown((href, text) => {
    images.push({ kind: "image", href, text });

    return `${marker}${images.length - 1}${marker}`;
  }).parse(text, { async: false });

  return rendered
    .split(new RegExp(`${marker}(\\d+)${marker}`))
    .flatMap<QQPart>((part, index) => {
      if (index % 2) {
        return [images[Number(part)]!];
      }

      return part.trim() ? [{ kind: "text" as const, text: part.trim() }] : [];
    });
}
