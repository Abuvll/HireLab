
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
