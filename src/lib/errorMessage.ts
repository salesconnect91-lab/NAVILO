export type ErrorLike = {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
};

export function userFacingError(error: unknown, fallback = "Something went wrong.") {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const value = error as ErrorLike;
    const message = typeof value.message === "string" ? value.message.trim() : "";
    const details = typeof value.details === "string" ? value.details.trim() : "";
    const hint = typeof value.hint === "string" ? value.hint.trim() : "";
    const parts = [message, details, hint].filter(Boolean);
    if (parts.length) return [...new Set(parts)].join(" ");
  }
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}
