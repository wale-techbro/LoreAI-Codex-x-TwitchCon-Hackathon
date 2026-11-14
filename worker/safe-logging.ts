export type WorkerErrorEvent =
  | "token_validation_failed"
  | "eventsub_message_failed"
  | "eventsub_socket_failed"
  | "eventsub_subscription_revoked"
  | "chat_reply_failed"
  | "chat_reply_not_sent"
  | "creator_start_failed"
  | "creator_poll_failed"
  | "worker_start_failed";

const SAFE_ERROR_TYPES = new Set([
  "AbortError",
  "Error",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TimeoutError",
  "TypeError",
  "URIError"
]);

function safeErrorType(error: unknown): string {
  if (!(error instanceof Error) || !SAFE_ERROR_TYPES.has(error.name)) return "Error";
  return error.name;
}

function safeCreatorId(value: string | undefined): string | undefined {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

export function workerErrorRecord(
  event: WorkerErrorEvent,
  error: unknown,
  creatorId?: string,
  httpStatus?: number
) {
  return {
    level: "error",
    service: "lore-eventsub-worker",
    event,
    errorType: safeErrorType(error),
    ...(safeCreatorId(creatorId) ? { creatorId: safeCreatorId(creatorId) } : {}),
    ...(Number.isInteger(httpStatus) && httpStatus! >= 100 && httpStatus! <= 599 ? { httpStatus } : {})
  };
}

export function logWorkerError(event: WorkerErrorEvent, error: unknown, creatorId?: string, httpStatus?: number): void {
  console.error(JSON.stringify(workerErrorRecord(event, error, creatorId, httpStatus)));
}

export function logWorkerWarning(event: "eventsub_connection_closed", creatorId?: string): void {
  console.warn(JSON.stringify({
    level: "warn",
    service: "lore-eventsub-worker",
    event,
    ...(safeCreatorId(creatorId) ? { creatorId: safeCreatorId(creatorId) } : {})
  }));
}
