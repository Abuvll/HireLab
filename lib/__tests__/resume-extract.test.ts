import { describe, it, expect, vi } from "vitest";
import { extractResumeData, ExtractionError } from "../extraction/resume-extract";
import type { AnthropicLikeClient } from "../extraction/resume-extract";

const validExtract = {
  education: { school: "UC San Diego", field: "Computer Science", gpa: null, gradYear: 2016 },
  yearsExperience: 6,
  topSkills: ["Python", "Kubernetes", "PostgreSQL"],
  experience: [
    {
      title: "Backend Engineer",
      company: "Stripe",
      startDate: "2022",
      endDate: "Present",
      stack: ["Go", "Kubernetes"],
      achievements: ["Led migration to a sharded architecture"],
    },
  ],
};

function fakeClient(
  responses: string[],
  usages: ({ input_tokens: number; output_tokens: number } | undefined)[] = [],
  costs: (number | undefined)[] = []
): AnthropicLikeClient {
  const create = vi.fn();
  responses.forEach((text, i) => {
    create.mockImplementationOnce(async () => ({ content: [{ type: "text", text }], usage: usages[i], costUsd: costs[i] }));
  });
  return { messages: { create } };
}

describe("extractResumeData", () => {
  it("parses a clean JSON response on the first attempt", async () => {
    const client = fakeClient([JSON.stringify(validExtract)]);
    const result = await extractResumeData({ resumeText: "resume text", client });
    expect(result.data).toEqual(validExtract);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("strips markdown code fences defensively", async () => {
    const fenced = "```json\n" + JSON.stringify(validExtract) + "\n```";
    const client = fakeClient([fenced]);
    const result = await extractResumeData({ resumeText: "resume text", client });
    expect(result.data).toEqual(validExtract);
  });

  it("retries once when the first response is not valid JSON", async () => {
    const client = fakeClient(["not json at all", JSON.stringify(validExtract)]);
    const result = await extractResumeData({ resumeText: "resume text", client });
    expect(result.data).toEqual(validExtract);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("retries once when the first response fails schema validation", async () => {
    const invalidShape = { education: "X", yearsExperience: "six" }; // wrong type, missing fields
    const client = fakeClient([JSON.stringify(invalidShape), JSON.stringify(validExtract)]);
    const result = await extractResumeData({ resumeText: "resume text", client });
    expect(result.data).toEqual(validExtract);
  });

  it("includes the failed first response as an assistant turn in the retry (valid alternating roles)", async () => {
    const client = fakeClient(["not json", JSON.stringify(validExtract)]);
    await extractResumeData({ resumeText: "resume text", client });
    const secondCallArgs = (client.messages.create as any).mock.calls[1][0];
    const roles = secondCallArgs.messages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(["user", "assistant", "user"]);
  });

  it("throws ExtractionError when both attempts fail", async () => {
    const client = fakeClient(["not json", "still not json"]);
    await expect(extractResumeData({ resumeText: "resume text", client })).rejects.toThrow(
      ExtractionError
    );
  });

  it("throws ExtractionError when the response has no text block", async () => {
    const client: AnthropicLikeClient = {
      messages: { create: vi.fn().mockResolvedValue({ content: [] }) },
    };
    await expect(extractResumeData({ resumeText: "resume text", client })).rejects.toThrow(
      ExtractionError
    );
  });

  it("passes cover letter text into the prompt when provided", async () => {
    const client = fakeClient([JSON.stringify(validExtract)]);
    await extractResumeData({ resumeText: "resume", coverLetterText: "cover letter", client });
    const callArgs = (client.messages.create as any).mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("cover letter");
  });

  it("returns usage totals from a single successful call", async () => {
    const client = fakeClient([JSON.stringify(validExtract)], [{ input_tokens: 900, output_tokens: 200 }]);
    const result = await extractResumeData({ resumeText: "resume text", client });
    expect(result.usage).toEqual({ inputTokens: 900, outputTokens: 200 });
  });

  it("accumulates usage across both calls when a retry happens", async () => {
    const client = fakeClient(
      ["not json", JSON.stringify(validExtract)],
      [{ input_tokens: 900, output_tokens: 50 }, { input_tokens: 950, output_tokens: 200 }]
    );
    const result = await extractResumeData({ resumeText: "resume text", client });
    expect(result.usage).toEqual({ inputTokens: 1850, outputTokens: 250 });
  });

  it("defaults usage to zero when the client reports none", async () => {
    const client = fakeClient([JSON.stringify(validExtract)]); // no usage passed
    const result = await extractResumeData({ resumeText: "resume text", client });
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("returns cost from a single successful call", async () => {
    const client = fakeClient([JSON.stringify(validExtract)], [undefined], [0.0042]);
    const result = await extractResumeData({ resumeText: "resume text", client });
    expect(result.costUsd).toBeCloseTo(0.0042, 6);
  });

  it("sums cost across both calls when a retry happens (the retry costs money too)", async () => {
    const client = fakeClient(["not json", JSON.stringify(validExtract)], [undefined, undefined], [0.001, 0.0015]);
    const result = await extractResumeData({ resumeText: "resume text", client });
    expect(result.costUsd).toBeCloseTo(0.0025, 6);
  });

  it("leaves cost undefined — not 0 — when the client never reports one, since unknown and free are different", async () => {
    const client = fakeClient([JSON.stringify(validExtract)]); // no cost passed
    const result = await extractResumeData({ resumeText: "resume text", client });
    expect(result.costUsd).toBeUndefined();
  });

  it("still totals the cost that WAS reported even if one of the two calls didn't report any", async () => {
    const client = fakeClient(["not json", JSON.stringify(validExtract)], [undefined, undefined], [0.002, undefined]);
    const result = await extractResumeData({ resumeText: "resume text", client });
    expect(result.costUsd).toBeCloseTo(0.002, 6);
  });
});
