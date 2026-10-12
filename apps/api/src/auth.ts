import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { Type } from "typebox";

import type { ControlStore } from "./control.ts";
import { body } from "./http.ts";

const derive = promisify(scrypt);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const passwordSchema = Type.String({ minLength: 10, maxLength: 256 });
const cookieName = "yanqi_session";

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await derive(password, salt, 64)) as Buffer;

  return `${salt}:${hash.toString("hex")}`;
}

async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, encoded] = stored.split(":");
  const expected = Buffer.from(encoded!, "hex");
  const actual = (await derive(password, salt!, 64)) as Buffer;

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function registerAuth(
  app: Hono,
  store: ControlStore,
  origin?: string,
): Promise<void> {
  const setupCode = randomBytes(18).toString("base64url");

  if ((await store.db.get("accounts", 1)).length === 0) {
    process.stdout.write(`首次设置管理密码，安装码：${setupCode}\n`);
  }

  const failures: number[] = [];

  async function session(ctx: Context): Promise<void> {
    const token = randomBytes(32).toString("base64url");
    const maxAge = 7 * 86_400;

    await store.db.create("sessions", {
      id: digest(token),
      expiresAt: Date.now() + maxAge * 1000,
    });
    setCookie(ctx, cookieName, token, {
      httpOnly: true,
      sameSite: "Strict",
      secure: (origin ?? ctx.req.url).startsWith("https:"),
      path: "/api",
      maxAge,
    });
  }

  async function loggedIn(ctx: Context): Promise<boolean> {
    const token = getCookie(ctx, cookieName);

    return Boolean(
      token &&
      (
        await store.db.get("sessions", {
          id: digest(token),
          expiresAt: { $gt: Date.now() },
        })
      ).length > 0,
    );
  }

  app.get("/api/session", async (ctx) =>
    ctx.json({
      authenticated: await loggedIn(ctx),
      setupRequired: (await store.db.get("accounts", 1)).length === 0,
    }),
  );
  app.post("/api/login", async (ctx) => {
    const now = Date.now();

    while (failures[0] !== undefined && failures[0] < now - 60_000) {
      failures.shift();
    }

    if (failures.length >= 10) {
      throw new HTTPException(429, { message: "尝试次数过多，请一分钟后再试" });
    }

    const input = await body(
      ctx,
      Type.Object({
        password: passwordSchema,
        setupCode: Type.Optional(Type.String()),
      }),
    );
    const [account] = await store.db.get("accounts", 1);

    failures.push(now);
    if (!account) {
      if (input.setupCode !== setupCode) {
        throw new HTTPException(401, {
          message: "安装码不正确，请查看后端启动日志",
        });
      }

      const password = await hashPassword(input.password);

      await store.db.create("accounts", { id: 1, password });
    } else if (!(await verifyPassword(input.password, account.password))) {
      throw new HTTPException(401, { message: "密码不正确" });
    }

    failures.length = 0;
    await session(ctx);

    return ctx.json({ ok: true });
  });

  app.use("/api/*", async (ctx, next) => {
    if (!(await loggedIn(ctx))) {
      throw new HTTPException(401, { message: "请先登录管理台" });
    }

    await next();
  });
  app.post("/api/logout", async (ctx) => {
    const token = getCookie(ctx, cookieName);

    if (token) {
      await store.db.remove("sessions", { id: digest(token) });
    }

    deleteCookie(ctx, cookieName, { path: "/api" });

    return ctx.json({ ok: true });
  });
  app.put("/api/password", async (ctx) => {
    const input = await body(
      ctx,
      Type.Object({ current: Type.String(), password: passwordSchema }),
    );
    const [account] = await store.db.get("accounts", 1);

    if (!account || !(await verifyPassword(input.current, account.password))) {
      throw new HTTPException(401, { message: "当前密码不正确" });
    }

    const password = await hashPassword(input.password);

    await store.db.transact(async (db) => {
      await db.set("accounts", 1, { password });
      await db.remove("sessions", {});
    });
    await session(ctx);

    return ctx.json({ ok: true });
  });
}
