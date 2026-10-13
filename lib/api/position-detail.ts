// One place that builds the position payload the dashboard expects from GET/POST/PATCH /api/positions[/:id]:
//   the Position row  +  applyUrl, stats, funnel (same maths as the Overview)  +  team: [{ userId, name, email, role }].
import { prisma } from "../db";
import { computePositionsWithStats } from "./overview";

export async function loadPositionDetail(positionId: string, requestOrigin: string) {
  const position = await prisma.position.findUnique({
    where: { id: positionId },
    include: { team: { include: { user: { select: { id: true, name: true, email: true } } } } },
  });
  if (!position) return null;

  const { team, ...row } = position;
  const applications = await prisma.application.findMany({
    where: { positionId },
    select: {
      id: true,
      positionId: true,
      status: true,
      score: { select: { meetsRequirements: true, matchPct: true } },
      githubAnalysis: { select: { shippedProjects: true } },
    },
  });

  const [withStats] = computePositionsWithStats([row as never], applications as never, requestOrigin);
  return {
    ...withStats,
    team: team.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email, role: m.role })),
  };
}
