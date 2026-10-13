// Verifies that prisma/migrations produces exactly the database described by prisma/schema.prisma.
// Run it after editing the schema or the migrations; it exits 0 only when there is no difference.
//
//   SHADOW_DATABASE_URL must point to an EMPTY scratch PostgreSQL database (Prisma applies the migrations to it
//   and compares the result with schema.prisma). Example for the docker-compose database:
//     docker compose up -d postgres
//     docker compose exec postgres createdb -U hirelab hirelab_shadow
//     SHADOW_DATABASE_URL=postgresql://hirelab:hirelab@localhost:5432/hirelab_shadow npm run db:check-migrations
const { spawnSync } = require("node:child_process");

const shadow = process.env.SHADOW_DATABASE_URL;
if (!shadow) {
  console.error("SHADOW_DATABASE_URL is not set. Point it at an EMPTY scratch PostgreSQL database (see the header of this file).");
  process.exit(2);
}

const result = spawnSync(
  "npx",
  [
    "prisma", "migrate", "diff",
    "--from-migrations", "prisma/migrations",
    "--to-schema-datamodel", "prisma/schema.prisma",
    "--shadow-database-url", shadow,
    "--exit-code",
  ],
  { stdio: "inherit", shell: process.platform === "win32" }
);

if (result.status === 0) console.log("OK: migrations match schema.prisma");
else if (result.status === 2) console.error("MISMATCH: schema.prisma differs from prisma/migrations (see the SQL above). Create a new migration with: npm run db:migrate -- --name <what_changed>");
process.exit(result.status === null ? 1 : result.status);
