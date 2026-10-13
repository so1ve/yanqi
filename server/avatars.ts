import { createError } from "h3";

import type { Avatar, Avatars } from "./storage/avatars";

export class AvatarCache {
  #avatars: Avatars;
  #pending = new Map<string, Promise<Avatar>>();

  constructor(avatars: Avatars) {
    this.#avatars = avatars;
  }

  public get(userId: string): Promise<Avatar> {
    const pending = this.#pending.get(userId);

    if (pending) {
      return pending;
    }

    const request = this.#load(userId).finally(() => {
      this.#pending.delete(userId);
    });

    this.#pending.set(userId, request);

    return request;
  }

  public async clear(): Promise<void> {
    // 等正在下载的头像保存后再清除，避免刷新后又写回旧缓存。
    await Promise.allSettled(this.#pending.values());
    await this.#avatars.clear();
  }

  async #load(userId: string): Promise<Avatar> {
    const cached = await this.#avatars.get(userId);

    if (cached) {
      return cached;
    }

    const response = await fetch(
      `https://q.qlogo.cn/headimg_dl?dst_uin=${userId}&spec=640`,
      { signal: AbortSignal.timeout(10_000) },
    );

    if (!response.ok) {
      throw createError({
        statusCode: 502,
        message: `获取 QQ ${userId} 的头像失败（HTTP ${response.status}）`,
      });
    }

    const contentType = response.headers.get("content-type")?.split(";")[0];

    if (
      !contentType ||
      !/^image\/(jpeg|png|gif|webp|avif)$/.test(contentType)
    ) {
      throw createError({
        statusCode: 502,
        message: "QQ 未返回有效的头像图片",
      });
    }

    const avatar = {
      contentType,
      data: Buffer.from(await response.arrayBuffer()),
    };

    await this.#avatars.save(userId, avatar);

    return avatar;
  }
}
