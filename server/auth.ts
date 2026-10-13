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

import type { Accounts } from "./storage/accounts";
import { body } from "./utils/http";

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
  #accounts: Accounts;
  #setupCode = randomBytes(18).toString("base64url");
  #failures: number[] = [];

  private constructor(accounts: Accounts) {
    this.#accounts = accounts;
  }

  public static async open(accounts: Accounts): Promise<Auth> {
    const auth = new Auth(accounts);

    await accounts.deleteExpiredSessions(Date.now());

    if (!(await accounts.password())) {
      process.stdout.write(
        `首次登录管理台时请填写安装码：${auth.#setupCode}\n`,
      );
    }

    return auth;
  }

  async #session(event: H3Event): Promise<void> {
    const token = randomBytes(32).toString("base64url");
    const maxAge = 7 * 86_400;

    await this.#accounts.createSession(
      digest(token),
      Date.now() + maxAge * 1000,
    );
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
      token && (await this.#accounts.hasSession(digest(token), Date.now())),
    );
  }

  public async state(event: H3Event) {
    return {
      authenticated: await this.loggedIn(event),
      setupRequired: !(await this.#accounts.password()),
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
    const passwordHash = await this.#accounts.password();

    this.#failures.push(now);
    if (!passwordHash) {
      if (input.setupCode !== this.#setupCode) {
        throw createError({
          statusCode: 401,
          message: "安装码不正确，请从言栖启动日志中复制",
        });
      }

      const password = await hashPassword(input.password);

      await this.#accounts.initialize(password);
    } else if (!(await verifyPassword(input.password, passwordHash))) {
      throw createError({ statusCode: 401, message: "密码不正确" });
    }

    this.#failures.length = 0;
    await this.#session(event);

    return { ok: true };
  }

  public async logout(event: H3Event) {
    const token = getCookie(event, cookieName);

    if (token) {
      await this.#accounts.deleteSession(digest(token));
    }

    deleteCookie(event, cookieName, { path: "/api" });

    return { ok: true };
  }

  public async changePassword(event: H3Event) {
    const input = await body(
      event,
      Type.Object({ current: Type.String(), password: passwordSchema }),
    );
    const passwordHash = await this.#accounts.password();

    if (!passwordHash || !(await verifyPassword(input.current, passwordHash))) {
      throw createError({ statusCode: 401, message: "当前密码不正确" });
    }

    const password = await hashPassword(input.password);

    await this.#accounts.replacePassword(password);
    await this.#session(event);

    return { ok: true };
  }
}
