export const REFERENCED_MASTER_MESSAGE =
  "This record has transaction history and cannot be deleted. Deactivate it instead.";

export function masterDeleteError(error: { code?: string; message: string }): string {
  return error.code === "23503" ? REFERENCED_MASTER_MESSAGE : error.message;
}
