/**
 * track-a-persistence.db-spec.ts — the first test in this repository that talks
 * to a real database.
 *
 * Every other suite mocks Prisma, so all of them would still pass if the schema
 * were wrong, a migration were missing, or a column did not exist. This one
 * proves the far end: that a write reaches PostgreSQL and survives being read
 * back by a DIFFERENT client. Two PrismaClient instances are deliberate — a
 * single client could satisfy the assertion out of its own connection state,
 * which would prove nothing about persistence.
 *
 * Needs a local PostgreSQL on DATABASE_URL:  bash scripts/local-db.sh
 * Run with:                                  pnpm --filter api test:db
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * The repo keeps its .env at the root, not beside schema.prisma, so Prisma's
 * own auto-loading does not find it from apps/api. Read it here so the suite
 * runs straight after scripts/local-db.sh with nothing else exported. An
 * already-set DATABASE_URL always wins (that is how CI supplies it).
 */
function loadRootEnv(): void {
  if (process.env.DATABASE_URL) return;
  const envPath = join(__dirname, "..", "..", "..", "..", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^\s*DATABASE_URL\s*=\s*(.*)$/.exec(line);
    if (m && m[1]) {
      process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, "");
      return;
    }
  }
}
loadRootEnv();

/** Marks the rows this suite creates so a failed run is identifiable. */
const TAG = "track-a-persistence";

describe("persistence: a write survives a second, independent client", () => {
  let writer: PrismaClient;
  let reader: PrismaClient;
  let firmId = "";
  let clientId = "";

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set. Run `bash scripts/local-db.sh` first (see docs/LOCAL-DB.md).",
      );
    }
    writer = new PrismaClient();
    reader = new PrismaClient();
  });

  afterAll(async () => {
    // Delete the client first: Firm→Client is a cascade, but being explicit
    // means a change to the cascade cannot silently leave rows behind.
    if (clientId) await writer.client.deleteMany({ where: { id: clientId } });
    if (firmId) await writer.firm.deleteMany({ where: { id: firmId } });
    await writer.$disconnect();
    await reader.$disconnect();
  });

  it("writes a Firm and a Client, and reads the Client back with a fresh client", async () => {
    const firm = await writer.firm.create({ data: { name: `${TAG} firm` } });
    firmId = firm.id;

    const created = await writer.client.create({
      data: {
        firmId: firm.id,
        businessName: `${TAG} client`,
        tin: "000111222",
      },
    });
    clientId = created.id;

    // The read that matters: a different connection, asked only for the id.
    const readBack = await reader.client.findUnique({ where: { id: clientId } });

    expect(readBack).not.toBeNull();
    expect(readBack?.firmId).toBe(firmId);
    expect(readBack?.businessName).toBe(`${TAG} client`);
    expect(readBack?.tin).toBe("000111222");
  });
});
