import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  const configured = process.env.TWITCH_TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(configured)) {
    throw new Error("TWITCH_TOKEN_ENCRYPTION_KEY must be a 64-character hexadecimal key.");
  }
  return Buffer.from(configured, "hex");
}

export function encryptTwitchToken(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptTwitchToken(value: string): string {
  const [version, ivValue, tagValue, encryptedValue, ...extra] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || encryptedValue === undefined || extra.length) {
    throw new Error("Stored Twitch token encryption format is invalid.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new Error("Could not decrypt the stored Twitch token. Verify TWITCH_TOKEN_ENCRYPTION_KEY.");
  }
}
