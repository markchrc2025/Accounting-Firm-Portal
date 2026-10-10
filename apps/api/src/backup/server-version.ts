/**
 * server-version.ts — the server's major, read through whatever Prisma client
 * the caller already has (PrismaService in the app, a short-lived PrismaClient
 * in the pre-migrate command). `server_version_num` is PostgreSQL's integer
 * form: 180000 for 18.0, 160013 for 16.13.
 */
export interface RawQueryable {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
}

export async function readServerVersionNum(db: RawQueryable): Promise<number> {
  const rows = await db.$queryRawUnsafe<Array<{ n: string | number }>>(
    "SELECT current_setting('server_version_num') AS n",
  );
  const num = Number(rows[0]?.n);
  if (!Number.isInteger(num) || num < 90000) {
    throw new Error(
      `could not read the server's version (server_version_num = ${String(rows[0]?.n)})`,
    );
  }
  return num;
}
