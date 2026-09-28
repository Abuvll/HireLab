import type { AnthropicLikeClient } from "./resume-extract";
import type { LlmProvider } from "../domain-enums";

// LiteLLM Proxy client (https://docs.litellm.ai/docs/proxy/quick_start) for the resume-extraction LLM call,
// using the *organization's own* stored key (real BYOK — see the note on this vs. OpenRouter below).
//
// This app runs its own LiteLLM Proxy instance (LITELLM_PROXY_URL) as a small backing service, alongside
// Postgres and Redis. Two separate secrets are involved, and it's important they stay separate:
//   - LITELLM_MASTER_KEY authenticates *this app* to *our own* proxy. It is ours, never an org's, and never
//     changes per-request.
//   - Each org's own decrypted provider key is sent per-request as `api_key` in the request body — LiteLLM's
//     documented per-request key override. This is what makes it real BYOK: LiteLLM never stores an org's key
//     itself, it just uses whichever one arrives on that specific request to call the upstream provider.
//
// Unlike OpenRouter (a broker that holds its own upstream credentials and can route ANY model on ONE
// OpenRouter key), a BYOK provider key only works for the provider it belongs to — an Anthropic key can't
// call GPT-4o. The `model` string passed in (e.g. "anthropic/claude-3-5-sonnet-20241022") carries the
// provider prefix LiteLLM uses to route the request; the org can only ever have selected a model whose prefix
// matches their stored `provider` (enforced at save time in app/api/organization/api-key/route.ts), so by the
// time a job runs here, model and key are already guaranteed consistent — this client doesn't re-check it.
//
// The extraction/retry/validation logic in resume-extract.ts needed zero changes for this migration — only
// which client implementation backs the AnthropicLikeClient interface, exactly as when OpenRouter replaced the
// original direct-Anthropic client.

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
    // Distinguishes "the proxy is unreachable / errored" from "the request reached a provider and it said no" —
    // callers (the job pipeline, the key-check below) branch on this rather than re-deriving it from the message.
    public readonly kind: "auth" | "rate_limit" | "model_unavailable" | "timeout" | "connectivity" | "unknown" = "unknown"
  ) {
    super(message);
    this.name = "LiteLLMApiError";
  }
}

// Generous but bounded: resume-extraction prompts are not huge, but a hung upstream request must not tie up a
// worker slot (concurrency is only 5 — see lib/jobs/worker.ts) indefinitely. Previously there was no timeout
// at all on this call (only the lightweight key-check had one) — a real gap this migration closes.
const COMPLETION_TIMEOUT_MS = 90_000;

export function classifyStatus(status: number, bodyText: string): LiteLLMApiError["kind"] {
  if (status === 401) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 402 || status === 403) return "auth"; // no credit / forbidden — still a "the key/account is the problem" case
  if (status === 400 || status === 404) {
    // LiteLLM's own errors for an unrouteable/decommissioned model mention the model string; a generic bad
    // request from a malformed prompt (which shouldn't happen — we control the prompt) would not. Sniffing the
    // message is the only signal available without a dedicated error code for this from LiteLLM.
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
            // Per-request BYOK override (see the module comment) — this, not a header, is what tells LiteLLM
            // which upstream credential to use for this specific call.
            api_key: this.apiKey,
          }),
          signal: AbortSignal.timeout(COMPLETION_TIMEOUT_MS),
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "TimeoutError") {
          throw new LiteLLMApiError(`Request to LiteLLM timed out after ${COMPLETION_TIMEOUT_MS}ms.`, undefined, "timeout");
        }
        // Network failure reaching our OWN proxy — not a provider or key problem. Distinguished so the job
        // pipeline and the API-key check both know not to blame the org's key for this (see
        // lib/api/api-key-error.ts, which already fails open on anything that isn't specifically about the key).
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

      // Best-effort cost capture from LiteLLM's documented response-cost header. This closes an existing gap
      // (ApiUsageEvent.costUsd has always been null — OpenRouter's chat-completions response never included
      // cost either) essentially for free. NOTE: this header name should be confirmed against whichever
      // LiteLLM Proxy version is actually deployed before relying on it — I could not verify it against a
      // live instance in this environment, so lib/jobs/analyze-application.ts treats a missing/unparseable
      // value as "unknown cost" (null), never as an error.
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

// Outcome of checking an org's key, keeping enough detail so callers can tell "the provider says this key is
// bad" apart from "we couldn't reach the proxy at all" — only the former says anything about the key itself.
export type LiteLLMKeyCheck =
  | { outcome: "valid" }
  | { outcome: "rejected"; status: number; message?: string }
  | { outcome: "unreachable" };

// Unlike OpenRouter, a generic LiteLLM proxy has no zero-cost "key info" endpoint for an arbitrary BYOK
// upstream key — validating one means actually using it. A 1-token completion is the smallest real call that
// exercises the exact same auth path a real analysis job would, at a negligible, bounded cost (this already
// mirrors how OpenAI/Anthropic/Google's own key-check flows work — none of them offer a free validation
// endpoint either). `model` must be a provider-prefixed string consistent with the key being checked (see the
// module comment on the model/provider invariant).
export async function checkLiteLLMKey(apiKey: string, model: string, opts: { timeoutMs?: number } = {}): Promise<LiteLLMKeyCheck> {
  try {
    const response = await fetch(`${proxyUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${masterKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "hi" }], api_key: apiKey }),
      ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    });
    if (response.ok) return { outcome: "valid" };

    // OpenAI-compatible error bodies look like { error: { message, code } }; LiteLLM generally preserves this
    // shape from upstream. The message is only ever used to classify the failure (expired vs revoked...), never
    // echoed back to a client.
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
