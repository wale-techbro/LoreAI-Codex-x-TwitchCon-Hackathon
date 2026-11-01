import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE_NAME = "lore_admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const ADMIN_SECRET_MIN_LENGTH = 32;

function sessionSignature(secret: string, expiresAt: number): string {
  return createHmac("sha256", secret)
    .update(`lore-admin-session:${expiresAt}`)
    .digest("base64url");
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function createAdminSessionToken(secret: string, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + ADMIN_SESSION_TTL_SECONDS;
  return `${expiresAt}.${sessionSignature(secret, expiresAt)}`;
}

export function verifyAdminSessionToken(token: string | null | undefined, secret: string, now = Date.now()): boolean {
  if (!token || secret.length < ADMIN_SECRET_MIN_LENGTH) return false;
  const [expiryValue, signature, ...extra] = token.split(".");
  const expiresAt = Number(expiryValue);
  if (extra.length || !Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000) || !signature) return false;
  return timingSafeStringEqual(signature, sessionSignature(secret, expiresAt));
}

export function adminSecretMatches(provided: string, expected: string): boolean {
  return timingSafeStringEqual(provided, expected);
}

export function readAdminSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== ADMIN_SESSION_COOKIE_NAME) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

export function getAdminAccess(cookieValue: string | null): { configured: boolean; authorized: boolean } {
  const secret = process.env.LORE_ADMIN_SECRET?.trim() ?? "";
  const configured = secret.length >= ADMIN_SECRET_MIN_LENGTH;
  const localDevelopmentBypass = !secret && process.env.NODE_ENV !== "production";
  return {
    configured,
    authorized: localDevelopmentBypass || (configured && verifyAdminSessionToken(cookieValue, secret))
  };
}

export function getAdminAccessFromCookieHeader(cookieHeader: string | null): { configured: boolean; authorized: boolean } {
  return getAdminAccess(readAdminSessionCookie(cookieHeader));
}

export function visibleLoreEntries<T extends { status: string }>(entries: T[], authorized: boolean): T[] {
  return authorized ? entries : entries.filter((entry) => entry.status === "approved");
}
