import { supabase } from "@/lib/supabase";

type InvokeErrorLike = {
  context?: unknown;
  cause?: unknown;
  message?: unknown;
  status?: unknown;
};

function payloadMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const value = payload as { error?: unknown; message?: unknown };
  if (value.error) return String(value.error);
  if (value.message) return String(value.message);
  return "";
}

async function readErrorContext(context: unknown): Promise<string> {
  if (!context || typeof context !== "object") return "";
  const direct = payloadMessage(context);
  if (direct) return direct;

  const responseLike = context as {
    clone?: () => unknown;
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
  };

  let readable = responseLike;
  if (typeof responseLike.clone === "function") {
    try {
      readable = responseLike.clone() as typeof responseLike;
    } catch {
      readable = responseLike;
    }
  }

  if (typeof readable.json === "function") {
    try {
      const message = payloadMessage(await readable.json());
      if (message) return message;
    } catch {
      // Fall through to text parsing.
    }
  }

  if (typeof responseLike.clone === "function") {
    try {
      readable = responseLike.clone() as typeof responseLike;
    } catch {
      readable = responseLike;
    }
  }

  if (typeof readable.text === "function") {
    try {
      const text = (await readable.text()).trim();
      if (text) {
        try {
          const message = payloadMessage(JSON.parse(text));
          if (message) return message;
        } catch {
          return text;
        }
      }
    } catch {
      // Keep the SDK fallback.
    }
  }

  return "";
}

async function extractInvokeError(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : "Edge Function request failed.";
  const value = (error || {}) as InvokeErrorLike;

  for (const candidate of [value.context, value.cause]) {
    const message = await readErrorContext(candidate);
    if (message) return message;
  }

  return fallback;
}

function invokeErrorStatus(error: unknown): number | null {
  const value = (error || {}) as InvokeErrorLike;
  const direct = Number(value.status);
  if (Number.isInteger(direct) && direct > 0) return direct;

  const contextStatus = Number((value.context as { status?: unknown } | null)?.status);
  return Number.isInteger(contextStatus) && contextStatus > 0 ? contextStatus : null;
}

export async function invokeEdgeFunction<T = unknown>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  let { data, error } = await supabase.functions.invoke(functionName, {
    body,
    ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
  });

  let errorMessage = error ? await extractInvokeError(error) : "";

  // Retry only an explicit authentication failure. Generic HTTP 500/application
  // errors must never be retried automatically, especially for destructive RPCs.
  if (error) {
    const status = invokeErrorStatus(error);
    const authFailure =
      status === 401 ||
      /invalid jwt|jwt expired|invalid session|authentication required/i.test(errorMessage);

    if (authFailure) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      const refreshedToken = refreshed.session?.access_token;
      if (!refreshError && refreshedToken) {
        const retry = await supabase.functions.invoke(functionName, {
          body,
          headers: { Authorization: `Bearer ${refreshedToken}` },
        });
        data = retry.data;
        error = retry.error;
        errorMessage = error ? await extractInvokeError(error) : "";
      }
    }
  }

  if (error) throw new Error(errorMessage || "Edge Function request failed.");

  if (data && typeof data === "object" && "error" in data) {
    const message = (data as { error?: unknown }).error;
    if (message) throw new Error(String(message));
  }

  return data as T;
}
