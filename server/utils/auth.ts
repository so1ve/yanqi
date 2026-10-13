import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import type { H3Event } from "h3";
import {
  createError,
  deleteCookie,
  getCookie,
  getRequestURL,
  setCookie,
} from "h3";
import { Type } from "typebox";

import type { ControlStore } from "./control";
import { body } from "./http";

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

export class Auth {
  #store: ControlStore;
  #setupCode = randomBytes(18).toString("base64url");
  #failures: number[] = [];

  private constructor(store: ControlStore) {
    this.#store = store;
  }

  public static async open(store: ControlStore): Promise<Auth> {
    const auth = new Auth(store);

    if (!(await auth.#account())) {
      process.stdout.write(`首次设置管理密码，安装码：${auth.#setupCode}\n`);
    }

    return auth;
  }

  #account() {
    return this.#store.db
      .selectFrom("accounts")
      .selectAll()
      .where("id", "=", 1)
      .executeTakeFirst();
  }

  async #session(event: H3Event): Promise<void> {
    const token = randomBytes(32).toString("base64url");
    const maxAge = 7 * 86_400;

    await this.#store.db
      .insertInto("sessions")
      .values({ id: digest(token), expiresAt: Date.now() + maxAge * 1000 })
      .execute();
    setCookie(event, cookieName, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: getRequestURL(event).protocol === "https:",
      path: "/api",
      maxAge,
    });
  }

  public async loggedIn(event: H3Event): Promise<boolean> {
    const token = getCookie(event, cookieName);

    return Boolean(
      token &&
      (await this.#store.db
        .selectFrom("sessions")
        .select("id")
        .where("id", "=", digest(token))
        .where("expiresAt", ">", Date.now())
        .executeTakeFirst()),
    );
  }

  public async state(event: H3Event) {
    return {
      authenticated: await this.loggedIn(event),
      setupRequired: !(await this.#account()),
    };
  }

  public async login(event: H3Event) {
    const now = Date.now();

    while (
      this.#failures[0] !== undefined &&
      this.#failures[0] < now - 60_000
    ) {
      this.#failures.shift();
    }

    if (this.#failures.length >= 10) {
      throw createError({
        statusCode: 429,
        message: "尝试次数过多，请一分钟后再试",
      });
    }

    const input = await body(
      event,
      Type.Object({
        password: passwordSchema,
        setupCode: Type.Optional(Type.String()),
      }),
    );
    const account = await this.#account();

    this.#failures.push(now);
    if (!account) {
      if (input.setupCode !== this.#setupCode) {
        throw createError({
          statusCode: 401,
          message: "安装码不正确，请查看服务启动日志",
        });
      }

      const password = await hashPassword(input.password);

      await this.#store.db
        .insertInto("accounts")
        .values({ id: 1, password })
        .execute();
    } else if (!(await verifyPassword(input.password, account.password))) {
      throw createError({ statusCode: 401, message: "密码不正确" });
    }

    this.#failures.length = 0;
    await this.#session(event);

    return { ok: true };
  }

  public async logout(event: H3Event) {
    const token = getCookie(event, cookieName);

    if (token) {
      await this.#store.db
        .deleteFrom("sessions")
        .where("id", "=", digest(token))
        .execute();
    }

    deleteCookie(event, cookieName, { path: "/api" });

    return { ok: true };
  }

  public async changePassword(event: H3Event) {
    const input = await body(
      event,
      Type.Object({ current: Type.String(), password: passwordSchema }),
    );
    const account = await this.#account();

    if (!account || !(await verifyPassword(input.current, account.password))) {
      throw createError({ statusCode: 401, message: "当前密码不正确" });
    }

    const password = await hashPassword(input.password);

    await this.#store.db.transaction().execute(async (db) => {
      await db
        .updateTable("accounts")
        .set({ password })
        .where("id", "=", 1)
        .execute();
      await db.deleteFrom("sessions").execute();
    });
    await this.#session(event);

    return { ok: true };
  }
}
