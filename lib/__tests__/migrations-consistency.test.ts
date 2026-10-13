import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

// Guards against the classic deployment failure: editing prisma/schema.prisma without adding a migration, so a
// production database (created with `prisma migrate deploy`) is missing tables/columns the code expects.
// This is a static check — it needs no database. For an exact comparison use `npm run db:check-migrations`.

const root = join(__dirname, "../..");
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf-8");
const migrationsDir = join(root, "prisma/migrations");

function migrationSql(): string {
  return readdirSync(migrationsDir)
    .filter((d: string) => statSync(join(migrationsDir, d)).isDirectory())
    .sort()
    .map((d: string) => readFileSync(join(migrationsDir, d, "migration.sql"), "utf-8"))
    .join("\n");
}

function stripComment(line: string): string {
  const i = line.indexOf("//");
  return (i >= 0 ? line.slice(0, i) : line).trim();
}

function blocks(kind: "model" | "enum"): Array<{ name: string; lines: string[] }> {
  const re = new RegExp(`^${kind}\\s+(\\w+)\\s*\\{([\\s\\S]*?)^\\}`, "gm");
  const result: Array<{ name: string; lines: string[] }> = [];
  for (const m of schema.matchAll(re)) {
    result.push({ name: m[1], lines: m[2].split("\n").map(stripComment).filter(Boolean) });
  }
  return result;
}

const models = blocks("model");
const enums = blocks("enum");
const modelNames = new Set(models.map((m) => m.name));
const sql = existsSync(migrationsDir) ? migrationSql() : "";

function scalarColumns(lines: string[]): string[] {
  const cols: string[] = [];
  for (const line of lines) {
    if (line.startsWith("@@")) continue;
    const [name, type] = line.split(/\s+/);
    if (type.endsWith("[]")) continue; // back-relation list
    if (modelNames.has(type.replace("?", ""))) continue; // relation field
    cols.push(name);
  }
  return cols;
}

function tableBlock(model: string): string {
  const m = sql.match(new RegExp(`CREATE TABLE "${model}" \\(([\\s\\S]*?)\\n\\);`));
  return m ? m[1] : "";
}

describe("prisma/migrations covers prisma/schema.prisma", () => {
  it("exists, with a postgresql lock file", () => {
    expect(existsSync(migrationsDir)).toBe(true);
    const lock = readFileSync(join(migrationsDir, "migration_lock.toml"), "utf-8");
    expect(lock).toContain('provider = "postgresql"');
  });

  it("creates a table for every model", () => {
    for (const { name } of models) {
      const created = sql.includes(`CREATE TABLE "${name}"`) || sql.includes(`RENAME TO "${name}"`);
      expect(created, `no migration creates table "${name}" — run: npm run db:migrate -- --name <change>`).toBe(true);
    }
  });

  it("creates every enum, with every value", () => {
    for (const { name, lines } of enums) {
      const created = sql.includes(`CREATE TYPE "${name}"`) || sql.includes(`RENAME TO "${name}"`);
      expect(created, `no migration creates enum "${name}"`).toBe(true);
      for (const value of lines) {
        expect(sql.includes(`'${value}'`), `enum ${name}: value '${value}' is in schema.prisma but in no migration`).toBe(true);
      }
    }
  });

  it("has a column for every scalar field of every model", () => {
    for (const { name, lines } of models) {
      const block = tableBlock(name);
      for (const col of scalarColumns(lines)) {
        const inTable = block.includes(`"${col}" `);
        // `prisma migrate dev` writes "ADD COLUMN     "col"" (several spaces) and chains several columns into one ALTER TABLE
        const added = new RegExp(`ALTER TABLE "${name}"[^;]*ADD COLUMN\\s+"${col}"`).test(sql);
        expect(inTable || added, `${name}.${col} is in schema.prisma but in no migration`).toBe(true);
      }
    }
  });
});
