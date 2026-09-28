import { resumeExtractSchema } from "./schema";
import { RESUME_EXTRACTION_SYSTEM_PROMPT, buildResumeExtractionPrompt } from "./prompt";
import type { ResumeExtractData } from "../scoring/types";

const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2000;


export interface AnthropicLikeClient {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: { role: "user" | "assistant"; content: string }[];
    }): Promise<{
      content: { type: string; text?: string }[];
      usage?: { input_tokens: number; output_tokens: number };
      // Populated when the client can report it (see lib/extraction/litellm-client.ts) — OpenRouter's response
      // never included this, so it was always undefined before; left optional rather than required so any
      // future client implementation isn't forced to support cost reporting.
      costUsd?: number;
    }>;
  };
}

export class ExtractionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ExtractionError";
  }
}

function firstTextBlock(content: { type: string; text?: string }[]): string {
  const block = content.find((c) => c.type === "text" && typeof c.text === "string");
  if (!block?.text) throw new ExtractionError("Model response contained no text block");
  return block.text;
}

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function parseAndValidate(rawText: string): ResumeExtractData | null {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFences(rawText));
  } catch {
    return null;
  }
  const result = resumeExtractSchema.safeParse(json);
  return result.success ? result.data : null;
}

export type ExtractResumeDataParams = {
  resumeText: string;
  coverLetterText?: string;
  client: AnthropicLikeClient;
  model?: string;
};

export type ExtractResumeDataResult = {
  data: ResumeExtractData;
  usage: { inputTokens: number; outputTokens: number };
  // Summed across every call made (the JSON-repair retry below costs money too) — undefined if the client
  // didn't report a cost for any call, never coerced to 0 (an unknown cost and a free call are different things).
  costUsd?: number;
};

export async function extractResumeData(
  params: ExtractResumeDataParams
): Promise<ExtractResumeDataResult> {
  const { resumeText, coverLetterText, client, model = DEFAULT_MODEL } = params;
  const userPrompt = buildResumeExtractionPrompt(resumeText, coverLetterText);

  const usage = { inputTokens: 0, outputTokens: 0 };
  const addUsage = (u?: { input_tokens: number; output_tokens: number }) => {
    if (!u) return;
    usage.inputTokens += u.input_tokens;
    usage.outputTokens += u.output_tokens;
  };
  let costUsd: number | undefined;
  const addCost = (c?: number) => {
    if (c === undefined) return;
    costUsd = (costUsd ?? 0) + c;
  };

  const first = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: RESUME_EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });
  addUsage(first.usage);
  addCost(first.costUsd);

  const firstParsed = parseAndValidate(firstTextBlock(first.content));
  if (firstParsed) return { data: firstParsed, usage, costUsd };

  
  const retry = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: RESUME_EXTRACTION_SYSTEM_PROMPT,
    messages: [
      { role: "user", content: userPrompt },
      { role: "assistant", content: firstTextBlock(first.content) },
      {
        role: "user",
        content:
          "That was not valid JSON matching the required schema. Respond again with ONLY the raw JSON object, no other text.",
      },
    ],
  });
  addUsage(retry.usage);
  addCost(retry.costUsd);

  const retryParsed = parseAndValidate(firstTextBlock(retry.content));
  if (retryParsed) return { data: retryParsed, usage, costUsd };

  throw new ExtractionError("Model did not return valid, schema-conforming JSON after retry");
}
