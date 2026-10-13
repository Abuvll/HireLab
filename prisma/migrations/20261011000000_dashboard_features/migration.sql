-- Hiring pipeline stage, interviews, and note replies / pins and the Notes feed's last-viewed time (the features dashboard.html needs beyond the first release).
-- Additive only: every new column is nullable or has a default, so existing rows stay valid and no backfill is needed.

-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('SHORTLISTED', 'INTERVIEW', 'HIRED');

-- CreateEnum
CREATE TYPE "InterviewType" AS ENUM ('SCREENING', 'TECHNICAL', 'FINAL_ROUND', 'HIRING_REVIEW');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELED');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "hiredAt" TIMESTAMP(3),
ADD COLUMN     "stage" "ApplicationStage";

-- AlterTable
ALTER TABLE "CandidateNote" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notesLastViewedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" "InterviewType" NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "interviewerName" TEXT NOT NULL DEFAULT '',
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Interview_applicationId_idx" ON "Interview"("applicationId");

-- CreateIndex
CREATE INDEX "Interview_startTime_idx" ON "Interview"("startTime");

-- CreateIndex
CREATE INDEX "CandidateNote_parentId_idx" ON "CandidateNote"("parentId");

-- AddForeignKey
ALTER TABLE "CandidateNote" ADD CONSTRAINT "CandidateNote_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CandidateNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
