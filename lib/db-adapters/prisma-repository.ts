import { prisma } from "../db";
import { decryptSecret } from "../security/encryption";
import type { AnalysisRepository, ApplicationWithPosition, OrgLlmCredential } from "../jobs/types";
import type { ResumeExtractData, GithubAnalysisData, ScoreResult, RequirementChip } from "../scoring/types";

export class PrismaAnalysisRepository implements AnalysisRepository {
  async getApplicationWithPosition(applicationId: string): Promise<ApplicationWithPosition | null> {
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { position: true },
    });
    if (!application) return null;

    return {
      application: {
        id: application.id,
        positionId: application.positionId,
        resumeUrl: application.resumeUrl,
        coverLetterText: application.coverLetterText,
        githubUrl: application.githubUrl,
      },
      position: {
        id: application.position.id,
        organizationId: application.position.organizationId,
        requirementChips: application.position.requirementChips as unknown as RequirementChip[],
      },
    };
  }

  async getOrgLlmCredential(organizationId: string): Promise<OrgLlmCredential | null> {
    const record = await prisma.orgApiKey.findUnique({ where: { organizationId } });
    if (!record) return null;
    return { decryptedKey: decryptSecret(record.encryptedKey), model: record.model, provider: record.provider };
  }

  async saveApiUsageEvent(event: {
    organizationId: string;
    applicationId: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    costUsd?: number;
  }): Promise<void> {
    await prisma.apiUsageEvent.create({
      data: {
        organizationId: event.organizationId,
        applicationId: event.applicationId,
        model: event.model,
        tokensIn: event.tokensIn,
        tokensOut: event.tokensOut,
        // Undefined (not 0) when the provider/proxy didn't report a cost — Prisma leaves the column null in
        // that case, same as every usage event before this migration always did.
        costUsd: event.costUsd,
      },
    });
  }

  async saveResumeExtract(applicationId: string, data: ResumeExtractData): Promise<void> {
    await prisma.resumeExtract.upsert({
      where: { applicationId },
      create: {
        applicationId,
        education: data.education,
        yearsExperience: data.yearsExperience,
        topSkills: data.topSkills,
        experience: data.experience,
      },
      update: {
        education: data.education,
        yearsExperience: data.yearsExperience,
        topSkills: data.topSkills,
        experience: data.experience,
      },
    });
  }

  async saveGithubAnalysis(applicationId: string, data: GithubAnalysisData): Promise<void> {
    await prisma.githubAnalysis.upsert({
      where: { applicationId },
      create: {
        applicationId,
        username: data.username,
        followers: data.followers,
        totalStars: data.totalStars,
        accountAgeYears: data.accountAgeYears,
        repoCount: data.repoCount,
        commitsPastYear: data.commitsPastYear,
        activeWeeks: data.activeWeeks,
        testRatio: data.testRatio,
        languages: data.languages,
        repos: data.repos,
        tooling: data.tooling,
        shippedProjects: data.shippedProjects,
        externalContributions: data.externalContributions,
        notableMerges: data.notableMerges,
      },
      update: {
        username: data.username,
        followers: data.followers,
        totalStars: data.totalStars,
        accountAgeYears: data.accountAgeYears,
        repoCount: data.repoCount,
        commitsPastYear: data.commitsPastYear,
        activeWeeks: data.activeWeeks,
        testRatio: data.testRatio,
        languages: data.languages,
        repos: data.repos,
        tooling: data.tooling,
        shippedProjects: data.shippedProjects,
        externalContributions: data.externalContributions,
        notableMerges: data.notableMerges,
      },
    });
  }

  async saveScore(applicationId: string, score: ScoreResult): Promise<void> {
    await prisma.score.upsert({
      where: { applicationId },
      create: {
        applicationId,
        meetsRequirements: score.meetsRequirements,
        matchPct: score.matchPct,
        reqMatch: score.reqMatch,
        consistency: score.consistency,
        collaboration: score.collaboration,
        codeQuality: score.codeQuality,
        evidenceMatrix: score.evidenceMatrix,
      },
      update: {
        meetsRequirements: score.meetsRequirements,
        matchPct: score.matchPct,
        reqMatch: score.reqMatch,
        consistency: score.consistency,
        collaboration: score.collaboration,
        codeQuality: score.codeQuality,
        evidenceMatrix: score.evidenceMatrix,
      },
    });
  }

  async markReady(applicationId: string): Promise<void> {
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: "READY", analyzedAt: new Date(), failureReason: null },
    });
  }

  async markFailed(applicationId: string, reason: string): Promise<void> {
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: "FAILED", failureReason: reason },
    });
  }
}
