const TWITCH_CALLBACK_PATH = "/api/auth/twitch/callback";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function validateAppOrigin(value: string | undefined, nodeEnv = process.env.NODE_ENV): string {
  const configured = value?.trim();
  if (!configured) throw new Error("APP_ORIGIN is required.");

  let origin: URL;
  try {
    origin = new URL(configured);
  } catch {
    throw new Error("APP_ORIGIN must be a valid absolute URL.");
  }

  if (
    origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
    origin.href !== `${origin.origin}/`
  ) {
    throw new Error("APP_ORIGIN must contain only the app origin, without credentials, path, query, or fragment.");
  }

  const localDevelopmentOrigin = nodeEnv !== "production" && origin.protocol === "http:" && LOOPBACK_HOSTS.has(origin.hostname);
  if (origin.protocol !== "https:" && !localDevelopmentOrigin) {
    throw new Error("APP_ORIGIN must use HTTPS, except for localhost during development.");
  }

  return origin.origin;
}

export function getCanonicalAppOrigin(): string {
  return validateAppOrigin(process.env.APP_ORIGIN, process.env.NODE_ENV);
}

export function validateTwitchCallbackUri(value: string | undefined, appOrigin: string): string {
  const configured = value?.trim();
  if (!configured) throw new Error("TWITCH_REDIRECT_URI is required.");

  let callback: URL;
  try {
    callback = new URL(configured);
  } catch {
    throw new Error("TWITCH_REDIRECT_URI must be a valid absolute URL.");
  }

  const canonicalOrigin = validateAppOrigin(appOrigin, process.env.NODE_ENV);
  if (
    callback.username || callback.password || callback.origin !== canonicalOrigin ||
    callback.href !== `${canonicalOrigin}${TWITCH_CALLBACK_PATH}`
  ) {
    throw new Error("TWITCH_REDIRECT_URI must use APP_ORIGIN and the Twitch callback path.");
  }

  return callback.href;
}

export function getTwitchCallbackUri(): string {
  return validateTwitchCallbackUri(process.env.TWITCH_REDIRECT_URI, getCanonicalAppOrigin());
}

export function getCanonicalAppHomeUrl(connect?: string): URL {
  const target = new URL("/", getCanonicalAppOrigin());
  if (connect) target.searchParams.set("connect", connect);
  return target;
}
