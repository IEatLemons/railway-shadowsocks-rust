import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const SESSION_COOKIE = "ss_admin_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;

export type Session = {
  expiresAt: number;
  username: string;
};

export type SessionManager = {
  create(username: string): string;
  destroy(token: string | null): void;
  get(token: string | null): Session | null;
};

export function safeEqualString(actual: string, expected: string): boolean {
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(value);
  }

  return cookies;
}

export function getSessionToken(req: IncomingMessage): string | null {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] || null;
}

export function createSessionManager(): SessionManager {
  const sessions = new Map<string, Session>();

  function prune(now = Date.now()): void {
    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(token);
    }
  }

  return {
    create(username: string): string {
      prune();
      const token = randomBytes(32).toString("base64url");
      sessions.set(token, {
        expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
        username
      });
      return token;
    },
    destroy(token: string | null): void {
      if (token) sessions.delete(token);
    },
    get(token: string | null): Session | null {
      if (!token) return null;
      prune();
      return sessions.get(token) || null;
    }
  };
}

export function setSessionCookie(res: ServerResponse, token: string, secure: boolean): void {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`
  ];

  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res: ServerResponse, secure: boolean): void {
  const parts = [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0"
  ];

  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}
