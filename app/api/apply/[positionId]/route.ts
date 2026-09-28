import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/db";
import { applySchema, zodIssuesToFields } from "../../../../lib/api/validation";
import { enqueueAnalysis } from "../../../../lib/jobs/queue";
import { badRequest, notFound, errorResponse } from "../../../../lib/api/errors";
import { checkRateLimitSafe, getClientIp } from "../../../../lib/security/rate-limit";
import { verifyCaptchaToken } from "../../../../lib/security/captcha";

export async function GET(
  req: NextRequest,
  { params }: { params: { positionId: string } }
) {
  try {
    // Public + unauthenticated: rate-limit by IP to slow down position-ID
    // enumeration/scraping (§3.15's security notes). Generous limit since
    // this also backs normal repeat page loads for a real applicant.
    const ip = getClientIp(req.headers);
    const rl = await checkRateLimitSafe(`apply-view:${ip}`, 60, 60);
    if (!rl.allowed) throw badRequest("Too many requests — please slow down.");

    // Organization details are shown alongside the posting (the dashboard's New Position page reminds the org
    // to keep this current — see dashboard-ui-changes-4.md). Only the fields meant for public display are
    // selected: contactEmail/contactPhone are for internal use, not shown to applicants.
    const position = await prisma.position.findUnique({
      where: { id: params.positionId },
      include: { organization: { select: { name: true, website: true, industry: true, description: true } } },
    });
    if (!position || position.status !== "OPEN") {
      throw notFound("This position is not accepting applications");
    }

    return NextResponse.json({
      position: {
        id: position.id,
        title: position.title,
        location: position.location,
        employmentType: position.employmentType,
        status: position.status,
        description: position.description,
        requirementChips: position.requirementChips,
        endDate: position.endDate,
        salary: position.salary,
        education: position.education,
        experience: position.experience,
        vacancies: position.vacancies,
        createdAt: position.createdAt,
        organization: position.organization,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { positionId: string } }
) {
  try {
    const ip = getClientIp(req.headers);
    const rl = await checkRateLimitSafe(`apply-submit:${ip}`, 10, 3600);
    if (!rl.allowed) throw badRequest("Too many applications submitted from this network — try again later.");

    const position = await prisma.position.findUnique({ where: { id: params.positionId } });
    if (!position || position.status !== "OPEN") {
      throw notFound("This position is not accepting applications");
    }

    const body = await req.json().catch(() => null);
    const parsed = applySchema.safeParse(body);
    if (!parsed.success) {
      // apply.html reads a field-level `fields` map (see its embedded API-contract comment) and shows each
      // message next to the relevant input, rather than only a single message in a banner at the top.
      throw badRequest(parsed.error.issues[0]?.message ?? "Invalid application", { fields: zodIssuesToFields(parsed.error) });
    }

    // §3.18: needs CAPTCHA or equivalent bot protection. Skipped (not
    // failed) when TURNSTILE_SECRET_KEY isn't configured — see
    // lib/security/captcha.ts for why that's a documented, visible gap
    // rather than a silent one.
    const captchaOk = await verifyCaptchaToken(parsed.data.captchaToken ?? "", ip);
    if (!captchaOk) throw badRequest("CAPTCHA verification failed — please try again.");

    let application;
    try {
      application = await prisma.application.create({
        data: {
          positionId: position.id,
          fullName: parsed.data.fullName,
          contactMethod: parsed.data.contactMethod,
          email: parsed.data.email ?? null,
          phone: parsed.data.phone ?? null,
          resumeUrl: parsed.data.resumeUrl,
          coverLetterText: parsed.data.coverLetterText,
          githubUrl: parsed.data.githubUrl,
          personalSiteUrl: parsed.data.personalSiteUrl ?? null,
          source: parsed.data.source ?? null,
          status: "PROCESSING",
        },
      });
    } catch (err) {
      // §3.18: "one application per candidate per position" is enforced
      // at the DB level (see the @@unique on Application in schema.prisma)
      // — this is the friendly-error side of that constraint.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw badRequest("You've already submitted an application for this position.");
      }
      throw err;
    }

    // The application row is already safely committed at this point. A transient queue/Redis outage must not
    // turn into a failed submission for the applicant — their data is saved either way, and losing the request
    // here would also mean losing the resume upload that already succeeded. Analysis is delayed, not lost, once
    // the queue is reachable again; this does not retry the enqueue itself (a known gap — there's no
    // reconciliation job today that re-enqueues an application whose initial enqueue failed).
    try {
      await enqueueAnalysis(application.id);
    } catch (err) {
      console.error(`Failed to enqueue analysis for application ${application.id}:`, err);
    }

    return NextResponse.json({ applicationId: application.id, status: "PROCESSING" }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
