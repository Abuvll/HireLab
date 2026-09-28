import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ORG_ROLES, POSITION_STATUSES, APPLICATION_STATUSES, CONTACT_METHODS, EMPLOYMENT_TYPES } from "../domain-enums";

function getModelFieldNames(schemaText: string, modelName: string): string[] {
  const modelMatch = schemaText.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));
  if (!modelMatch) throw new Error(`Model ${modelName} not found in schema`);

  return modelMatch[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("@@"))
    .map((line) => line.split(/\s+/)[0]);
}

const schemaText = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf-8");

describe("schema/domain-type consistency", () => {
  it("GithubAnalysis has a column for every GithubAnalysisData field", () => {
    const schemaFields = getModelFieldNames(schemaText, "GithubAnalysis");
    // relation/bookkeeping fields not part of GithubAnalysisData
    const excluded = ["id", "application", "applicationId", "createdAt"];
    const domainFields = [
      "username",
      "followers",
      "totalStars",
      "accountAgeYears",
      "repoCount",
      "commitsPastYear",
      "activeWeeks",
      "testRatio",
      "languages",
      "repos",
      "tooling",
      "shippedProjects",
      "externalContributions",
      "notableMerges",
    ];
    for (const field of domainFields) {
      expect(schemaFields, `expected GithubAnalysis to have a "${field}" column`).toContain(field);
    }
    // also flag schema fields that aren't accounted for at all (excluding known bookkeeping)
    const unaccounted = schemaFields.filter((f) => !excluded.includes(f) && !domainFields.includes(f));
    expect(unaccounted, "schema has fields not represented in the domain type or exclusion list").toEqual([]);
  });

  it("ResumeExtract has a column for every ResumeExtractData field", () => {
    const schemaFields = getModelFieldNames(schemaText, "ResumeExtract");
    const excluded = ["id", "application", "applicationId", "createdAt"];
    const domainFields = ["education", "yearsExperience", "topSkills", "experience"];
    for (const field of domainFields) {
      expect(schemaFields, `expected ResumeExtract to have a "${field}" column`).toContain(field);
    }
    const unaccounted = schemaFields.filter((f) => !excluded.includes(f) && !domainFields.includes(f));
    expect(unaccounted).toEqual([]);
  });

  it("Score has a column for every ScoreResult field", () => {
    const schemaFields = getModelFieldNames(schemaText, "Score");
    const excluded = ["id", "application", "applicationId", "computedAt"];
    const domainFields = [
      "meetsRequirements",
      "matchPct",
      "reqMatch",
      "consistency",
      "collaboration",
      "codeQuality",
      "evidenceMatrix",
    ];
    for (const field of domainFields) {
      expect(schemaFields, `expected Score to have a "${field}" column`).toContain(field);
    }
    const unaccounted = schemaFields.filter((f) => !excluded.includes(f) && !domainFields.includes(f));
    expect(unaccounted).toEqual([]);
  });
});

function getEnumValues(schemaText: string, enumName: string): string[] {
  const enumMatch = schemaText.match(new RegExp(`enum ${enumName} \\{([\\s\\S]*?)\\n\\}`));
  if (!enumMatch) throw new Error(`Enum ${enumName} not found in schema`);
  return enumMatch[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

describe("domain-enums.ts / schema.prisma enum consistency", () => {
  it("OrgRole matches ORG_ROLES", () => {
    expect(getEnumValues(schemaText, "OrgRole").sort()).toEqual([...ORG_ROLES].sort());
  });
  it("PositionStatus matches POSITION_STATUSES", () => {
    expect(getEnumValues(schemaText, "PositionStatus").sort()).toEqual([...POSITION_STATUSES].sort());
  });
  it("ApplicationStatus matches APPLICATION_STATUSES", () => {
    expect(getEnumValues(schemaText, "ApplicationStatus").sort()).toEqual([...APPLICATION_STATUSES].sort());
  });
  it("ContactMethod matches CONTACT_METHODS", () => {
    expect(getEnumValues(schemaText, "ContactMethod").sort()).toEqual([...CONTACT_METHODS].sort());
  });
  it("EmploymentType matches EMPLOYMENT_TYPES", () => {
    expect(getEnumValues(schemaText, "EmploymentType").sort()).toEqual([...EMPLOYMENT_TYPES].sort());
  });
});
