import { supabase } from "@/lib/supabase";

async function extractInvokeError(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : "Edge Function request failed.";
  const context = (error as { context?: Response } | null)?.context;
  if (!context || typeof context.clone !== "function") return fallback;

  try {
    const payload = await context.clone().json() as { error?: unknown; message?: unknown };
    if (payload?.error) return String(payload.error);
    if (payload?.message) return String(payload.message);
  } catch {
    try {
      const text = await context.clone().text();
      if (text.trim()) return text.trim();
    } catch {
      // Keep the SDK fallback message.
    }
  }

  return fallback;
}

export async function invokeEdgeFunction<T = unknown>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
    ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
  });

  if (error) throw new Error(await extractInvokeError(error));

  if (data && typeof data === "object" && "error" in data) {
    const message = (data as { error?: unknown }).error;
    if (message) throw new Error(String(message));
  }

  return data as T;
}
