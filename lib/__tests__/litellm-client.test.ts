import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiteLLMClient, LiteLLMApiError, checkLiteLLMKey, validateProviderKey } from "../extraction/litellm-client";

const PROXY_URL = "https://litellm.internal.test";
const MASTER_KEY = "master-key-abc123";

beforeEach(() => {
  process.env.LITELLM_PROXY_URL = PROXY_URL;
  process.env.LITELLM_MASTER_KEY = MASTER_KEY;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LITELLM_PROXY_URL;
  delete process.env.LITELLM_MASTER_KEY;
});

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
function fakeFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const fn = vi.fn(async (url: string, init: RequestInit) => impl(url, init));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("LiteLLMClient.messages.create — request construction", () => {
  it("posts to {LITELLM_PROXY_URL}/v1/chat/completions with our master key, never the org's", async () => {
    const fetchSpy = fakeFetch(() => jsonResponse(200, { choices: [{ message: { content: "{}" } }] }));
    const client = new LiteLLMClient("org-byok-key-xyz");
    await client.messages.create({ model: "anthropic/claude-3-5-sonnet-20241022", max_tokens: 100, messages: [{ role: "user", content: "hi" }] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${PROXY_URL}/v1/chat/completions`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${MASTER_KEY}`);
  });

  it("sends the org's own key as the per-request api_key override (the actual BYOK mechanism)", async () => {
    const fetchSpy = fakeFetch(() => jsonResponse(200, { choices: [{ message: { content: "{}" } }] }));
    const client = new LiteLLMClient("org-byok-key-xyz");
    await client.messages.create({ model: "openai/gpt-4o", max_tokens: 100, messages: [{ role: "user", content: "hi" }] });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.api_key).toBe("org-byok-key-xyz");
    expect(body.model).toBe("openai/gpt-4o");
  });

  it("prepends system as a system-role message, matching the OpenAI-compatible chat shape", async () => {
    const fetchSpy = fakeFetch(() => jsonResponse(200, { choices: [{ message: { content: "{}" } }] }));
    const client = new LiteLLMClient("k");
    await client.messages.create({ model: "m", max_tokens: 10, system: "be helpful", messages: [{ role: "user", content: "hi" }] });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.messages).toEqual([{ role: "system", content: "be helpful" }, { role: "user", content: "hi" }]);
  });

  it("omits the system message entirely when none is given (not sent as empty/null)", async () => {
    const fetchSpy = fakeFetch(() => jsonResponse(200, { choices: [{ message: { content: "{}" } }] }));
    const client = new LiteLLMClient("k");
    await client.messages.create({ model: "m", max_tokens: 10, messages: [{ role: "user", content: "hi" }] });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("throws a clear error rather than silently proceeding when LITELLM_PROXY_URL is missing", async () => {
    delete process.env.LITELLM_PROXY_URL;
    fakeFetch(() => jsonResponse(200, {}));
    const client = new LiteLLMClient("k");
    await expect(client.messages.create({ model: "m", max_tokens: 10, messages: [] })).rejects.toThrow("LITELLM_PROXY_URL");
  });

  it("throws a clear error when LITELLM_MASTER_KEY is missing", async () => {
    delete process.env.LITELLM_MASTER_KEY;
    fakeFetch(() => jsonResponse(200, {}));
    const client = new LiteLLMClient("k");
    await expect(client.messages.create({ model: "m", max_tokens: 10, messages: [] })).rejects.toThrow("LITELLM_MASTER_KEY");
  });
});

describe("LiteLLMClient.messages.create — response parsing", () => {
  it("maps the OpenAI-compatible response into the AnthropicLikeClient shape", async () => {
    fakeFetch(() => jsonResponse(200, { choices: [{ message: { content: '{"name":"Jamie"}' } }], usage: { prompt_tokens: 120, completion_tokens: 40 } }));
    const client = new LiteLLMClient("k");
    const result = await client.messages.create({ model: "m", max_tokens: 10, messages: [] });

    expect(result.content).toEqual([{ type: "text", text: '{"name":"Jamie"}' }]);
    expect(result.usage).toEqual({ input_tokens: 120, output_tokens: 40 });
  });

  it("defaults to empty text rather than throwing when the response shape is unexpected", async () => {
    fakeFetch(() => jsonResponse(200, { choices: [] }));
    const client = new LiteLLMClient("k");
    const result = await client.messages.create({ model: "m", max_tokens: 10, messages: [] });
    expect(result.content).toEqual([{ type: "text", text: "" }]);
  });

  it("reads cost from the x-litellm-response-cost header when present", async () => {
    fakeFetch(() => jsonResponse(200, { choices: [{ message: { content: "{}" } }] }, { "x-litellm-response-cost": "0.00234" }));
    const client = new LiteLLMClient("k");
    const result = await client.messages.create({ model: "m", max_tokens: 10, messages: [] });
    expect(result.costUsd).toBeCloseTo(0.00234, 5);
  });

  it("leaves cost undefined (not 0) when the header is absent", async () => {
    fakeFetch(() => jsonResponse(200, { choices: [{ message: { content: "{}" } }] }));
    const client = new LiteLLMClient("k");
    const result = await client.messages.create({ model: "m", max_tokens: 10, messages: [] });
    expect(result.costUsd).toBeUndefined();
  });

  it("leaves cost undefined rather than throwing when the header is present but not a number", async () => {
    fakeFetch(() => jsonResponse(200, { choices: [{ message: { content: "{}" } }] }, { "x-litellm-response-cost": "not-a-number" }));
    const client = new LiteLLMClient("k");
    const result = await client.messages.create({ model: "m", max_tokens: 10, messages: [] });
    expect(result.costUsd).toBeUndefined();
  });
});

describe("LiteLLMClient.messages.create — error classification", () => {
  const attempt = async (status: number, body: unknown) => {
    fakeFetch(() => jsonResponse(status, body));
    const client = new LiteLLMClient("k");
    return client.messages.create({ model: "m", max_tokens: 10, messages: [] }).catch((e) => e);
  };

  it("401 -> auth (the key itself is rejected)", async () => {
    const err = await attempt(401, { error: { message: "invalid api key" } });
    expect(err).toBeInstanceOf(LiteLLMApiError);
    expect(err.kind).toBe("auth");
    expect(err.status).toBe(401);
  });

  it("402 and 403 -> auth too (no credit / forbidden — still a key/account problem)", async () => {
    for (const status of [402, 403]) {
      const err = await attempt(status, { error: { message: "nope" } });
      expect(err.kind).toBe("auth");
    }
  });

  it("429 -> rate_limit, distinct from auth", async () => {
    const err = await attempt(429, { error: { message: "rate limit exceeded" } });
    expect(err.kind).toBe("rate_limit");
  });

  it("400/404 mentioning the model -> model_unavailable", async () => {
    for (const status of [400, 404]) {
      const err = await attempt(status, { error: { message: "The model `gpt-5-nonexistent` does not exist" } });
      expect(err.kind).toBe("model_unavailable");
    }
  });

  it("400 that doesn't mention a model -> unknown, not misclassified as model_unavailable", async () => {
    const err = await attempt(400, { error: { message: "malformed request body" } });
    expect(err.kind).toBe("unknown");
  });

  it("500 -> unknown (treated as possibly transient, not blamed on the key)", async () => {
    const err = await attempt(500, { error: { message: "internal server error" } });
    expect(err.kind).toBe("unknown");
  });

  it("a network failure reaching the proxy is classified as connectivity, not auth", async () => {
    fakeFetch(() => { throw new TypeError("fetch failed"); });
    const client = new LiteLLMClient("k");
    const err = await client.messages.create({ model: "m", max_tokens: 10, messages: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(LiteLLMApiError);
    expect(err.kind).toBe("connectivity");
  });

  it("a genuine timeout is classified distinctly from a generic connectivity failure", async () => {
    fakeFetch(() => { throw new DOMException("The operation was aborted", "TimeoutError"); });
    const client = new LiteLLMClient("k");
    const err = await client.messages.create({ model: "m", max_tokens: 10, messages: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(LiteLLMApiError);
    expect(err.kind).toBe("timeout");
  });

  it("every classified error message is free of the org's actual key", async () => {
    const err = await attempt(401, { error: { message: "key sk-ant-realkey12345 is invalid" } });
    expect(err.message).not.toContain("sk-ant-realkey12345");
  });
});

describe("checkLiteLLMKey", () => {
  it("valid on 200", async () => {
    fakeFetch(() => jsonResponse(200, { choices: [{ message: { content: "hi" } }] }));
    expect(await checkLiteLLMKey("k", "anthropic/claude-3-5-sonnet-20241022")).toEqual({ outcome: "valid" });
  });

  it("rejected with status and message on a provider error", async () => {
    fakeFetch(() => jsonResponse(401, { error: { message: "invalid x-api-key" } }));
    const result = await checkLiteLLMKey("k", "anthropic/claude-3-5-sonnet-20241022");
    expect(result).toEqual({ outcome: "rejected", status: 401, message: "invalid x-api-key" });
  });

  it("rejected without a message when the body isn't the expected shape", async () => {
    fakeFetch(() => jsonResponse(500, "plain text error, not json"));
    const result = await checkLiteLLMKey("k", "m");
    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") expect(result.message).toBeUndefined();
  });

  it("unreachable when the proxy can't be reached at all", async () => {
    fakeFetch(() => { throw new TypeError("fetch failed"); });
    expect(await checkLiteLLMKey("k", "m")).toEqual({ outcome: "unreachable" });
  });

  it("sends only a 1-token request (a real but minimal, bounded-cost call)", async () => {
    const fetchSpy = fakeFetch(() => jsonResponse(200, { choices: [{ message: { content: "h" } }] }));
    await checkLiteLLMKey("k", "anthropic/claude-3-5-sonnet-20241022");
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.max_tokens).toBe(1);
    expect(body.model).toBe("anthropic/claude-3-5-sonnet-20241022");
    expect(body.api_key).toBe("k");
  });
});

describe("validateProviderKey", () => {
  it("valid key -> { valid: true }", async () => {
    fakeFetch(() => jsonResponse(200, { choices: [{ message: { content: "hi" } }] }));
    expect(await validateProviderKey("k", "ANTHROPIC", "anthropic/claude-3-5-sonnet-20241022")).toEqual({ valid: true });
  });

  it("401 -> a plain 'doesn't look valid' message, no raw provider text or status code shown", async () => {
    fakeFetch(() => jsonResponse(401, { error: { message: "some internal provider error code XYZ" } }));
    const result = await validateProviderKey("k", "ANTHROPIC", "anthropic/claude-3-5-sonnet-20241022");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("doesn't look valid");
    expect(result.error).not.toContain("XYZ");
  });

  it("model-not-found (404) -> a message pointing at the model, not the key", async () => {
    fakeFetch(() => jsonResponse(404, { error: { message: "The model `nonexistent-model` does not exist" } }));
    const result = await validateProviderKey("k", "ANTHROPIC", "anthropic/nonexistent-model");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("model");
  });

  it("an unreachable proxy produces a retry-later message, not a false 'invalid key' claim", async () => {
    fakeFetch(() => { throw new TypeError("fetch failed"); });
    const result = await validateProviderKey("k", "ANTHROPIC", "anthropic/claude-3-5-sonnet-20241022");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("try again");
    expect(result.error).not.toContain("doesn't look valid");
    expect(result.error).not.toContain("invalid");
  });
});
