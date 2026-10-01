import type { AnthropicLikeClient } from "./resume-extract";
import type { LlmProvider } from "../domain-enums";

function proxyUrl(): string {
  const url = process.env.LITELLM_PROXY_URL;
  if (!url) throw new Error("LITELLM_PROXY_URL is not set");
  return url.replace(/\/+$/, "");
}

function masterKey(): string {
  const key = process.env.LITELLM_MASTER_KEY;
  if (!key) throw new Error("LITELLM_MASTER_KEY is not set");
  return key;
}

export class LiteLLMApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
 
    public readonly kind: "auth" | "rate_limit" | "model_unavailable" | "timeout" | "connectivity" | "unknown" = "unknown"
  ) {
    super(message);
    this.name = "LiteLLMApiError";
  }
}

const COMPLETION_TIMEOUT_MS = 90_000;

export function classifyStatus(status: number, bodyText: string): LiteLLMApiError["kind"] {
  if (status === 401) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 402 || status === 403) return "auth"; // no credit / forbidden — still a "the key/account is the problem" case
  if (status === 400 || status === 404) {

    if (/model/i.test(bodyText)) return "model_unavailable";
  }
  return "unknown";
}

export class LiteLLMClient implements AnthropicLikeClient {
  constructor(private readonly apiKey: string) {}

  messages = {
    create: async (params: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: { role: "user" | "assistant"; content: string }[];
    }) => {
      const openAiMessages = [
        ...(params.system ? [{ role: "system" as const, content: params.system }] : []),
        ...params.messages,
      ];

      let response: Response;
      try {
        response = await fetch(`${proxyUrl()}/v1/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${masterKey()}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: params.model,
            max_tokens: params.max_tokens,
            messages: openAiMessages,
  
            api_key: this.apiKey,
          }),
          signal: AbortSignal.timeout(COMPLETION_TIMEOUT_MS),
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "TimeoutError") {
          throw new LiteLLMApiError(`Request to LiteLLM timed out after ${COMPLETION_TIMEOUT_MS}ms.`, undefined, "timeout");
        }

        throw new LiteLLMApiError(`Couldn't reach the LiteLLM proxy: ${err instanceof Error ? err.message : String(err)}`, undefined, "connectivity");
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        const kind = classifyStatus(response.status, bodyText);
        const messages: Record<typeof kind, string> = {
          auth: "The organization's API key was rejected — it may be invalid, revoked, or out of credit.",
          rate_limit: "The provider's rate limit or quota was reached.",
          model_unavailable: "The selected model is unavailable.",
          timeout: "The request timed out.",
          connectivity: "Couldn't reach the LiteLLM proxy.",
          unknown: `LiteLLM returned ${response.status}: ${bodyText}`,
        };
        throw new LiteLLMApiError(messages[kind], response.status, kind);
      }

      const data = (await response.json()) as {
        choices: { message: { content: string } }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      };

      const text = data.choices?.[0]?.message?.content ?? "";

      const costHeader = response.headers.get("x-litellm-response-cost");
      const costUsd = costHeader ? Number.parseFloat(costHeader) : undefined;

      return {
        content: [{ type: "text", text }],
        usage: data.usage
          ? { input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens }
          : undefined,
        costUsd: costUsd !== undefined && Number.isFinite(costUsd) ? costUsd : undefined,
      };
    },
  };
}

export type LiteLLMKeyCheck =
  | { outcome: "valid" }
  | { outcome: "rejected"; status: number; message?: string }
  | { outcome: "unreachable" };

export async function checkLiteLLMKey(apiKey: string, model: string, opts: { timeoutMs?: number } = {}): Promise<LiteLLMKeyCheck> {
  try {
    const response = await fetch(`${proxyUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${masterKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "hi" }], api_key: apiKey }),
      ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    });
    if (response.ok) return { outcome: "valid" };

    const body = (await response.json().catch(() => null)) as { error?: { message?: unknown } } | null;
    const message = typeof body?.error?.message === "string" ? body.error.message : undefined;
    return { outcome: "rejected", status: response.status, message };
  } catch {
    return { outcome: "unreachable" };
  }
}

// Used to validate a key at save time.
export async function validateProviderKey(
  apiKey: string,
  provider: LlmProvider,
  model: string
): Promise<{ valid: boolean; error?: string }> {
  const check = await checkLiteLLMKey(apiKey, model);
  if (check.outcome === "valid") return { valid: true };
  if (check.outcome === "rejected") {
    if (check.status === 401) return { valid: false, error: "That key doesn't look valid — check it and try again." };
    if (check.status === 404 && /model/i.test(check.message ?? "")) {
      return { valid: false, error: "That model isn't available — try a different one." };
    }
    return { valid: false, error: `${provider} couldn't validate this key (status ${check.status}).` };
  }
  return { valid: false, error: "Couldn't reach LiteLLM to validate the key — try again in a moment." };
}
