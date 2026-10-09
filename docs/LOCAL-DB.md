# A local database, in a cloud VM

Every schema change and every database rule in this project has to be verified against a
real PostgreSQL. The API's unit and e2e suites mock Prisma end to end, so **they would all
still pass with a wrong schema, a missing migration, or a column that does not exist.**
This is how you get a database to check that against.

## One command

```bash
bash scripts/local-db.sh
```

That is the whole procedure. It is idempotent — run it as often as you like; the second run
changes nothing. Run it **after every VM restart** (see *What vanishes*, below).

It will:

1. read `DATABASE_URL` from `.env` and **refuse to continue unless the host is local**
   (`localhost`, `127.0.0.1`, `::1`) — the live database holds real client data;
2. install PostgreSQL if it is missing, and start the cluster if it is stopped;
3. create the role and the database that `DATABASE_URL` names, if they are not there;
4. `prisma generate` → `prisma migrate deploy` → `prisma migrate status` → `db:seed`;
5. print row counts.

It never prints `DATABASE_URL`. The password lives in that URL, so the script reports the
hostname, port and database name only, and passes SQL to `psql` on **stdin** rather than as
an argument — so the password never appears in `ps`.

## What is running afterwards

| | |
|---|---|
| PostgreSQL | **16.13** (Ubuntu `postgresql-16`, `16.13-0ubuntu0.24.04.1`) |
| Cluster | `16/main`, Debian-style, data in `/var/lib/postgresql/16/main` |
| Host / port | `localhost:5432` |
| Database | `portal`, owned by role `portal` |
| Redis | **not installed, and not needed** — see below |

**Version match.** `docker-compose.yml:6` and the CI `database` job
(`.github/workflows/ci.yml:56`) both use `postgres:16-alpine`. This is PostgreSQL 16 as
well, so the major version matches everywhere. The patch level and the base image differ
(Ubuntu build vs. Alpine), and neither the compose file nor CI pins a patch version.
`docs/DEPLOY-SLIPLANE.md:8` names production only as "Sliplane Postgres template" — **the
production version is not recorded anywhere in this repository.** Worth pinning down before
anything depends on 16-specific behaviour.

**Redis is not required.** `RedisService` connects with `lazyConnect: true`
(`apps/api/src/redis/redis.service.ts:19`), logs connection errors as warnings (`:25`) and
returns `false` from `ping()` rather than throwing (`:30-40`). The app boots without it, and
`migrate deploy` and `db:seed` are standalone Prisma processes that never touch it. Install
Redis only when something actually queues.

## What vanishes on restart

**This VM is reclaimed when idle, and everything outside the git repository goes with it** —
the PostgreSQL install, the cluster, the `portal` database, its rows, and `.env`.

What survives is what is committed: `scripts/local-db.sh`, this file, the migrations, the
seed. That is the point — the deliverable is the *procedure*, not a running server.

After a restart:

```bash
cp .env.example .env      # if .env is gone
bash scripts/local-db.sh
```

## Running the database-backed tests

```bash
pnpm --filter api test:db
```

Matches `apps/api/test/**/*.db-spec.ts` and nothing else, via `apps/api/test/jest-db.json`.
The three suites are deliberately disjoint:

| Script | Config | Matches | Needs a database |
|---|---|---|---|
| `pnpm --filter api test` | `jest.config.cjs` | `src/**/*.spec.ts` | no |
| `pnpm --filter api test:e2e` | `test/jest-e2e.json` | `test/**/*.e2e-spec.ts` | no |
| `pnpm --filter api test:db` | `test/jest-db.json` | `test/**/*.db-spec.ts` | **yes** |

So `pnpm -r test` stays hermetic and stays runnable with no database at all.

CI runs `test:db` in the `database` job, after `db:seed` — the only job that has a
PostgreSQL service. The `verify` job is untouched and stays hermetic.

## Gotcha: Prisma and `DATABASE_URL`

`.env` lives at the **repo root**, not next to `prisma/schema.prisma`, so Prisma's own
`.env` auto-loading does not find it when you run a Prisma command from `apps/api`:

```
Error code: P1012
error: Environment variable not found: DATABASE_URL.
```

`scripts/local-db.sh` exports it, so anything it runs is fine. For a one-off Prisma command
by hand, export it first:

```bash
export DATABASE_URL="$(sed -n 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//p' .env | head -1)"
pnpm --filter api exec prisma migrate status
```

The `test:db` suite handles this itself: it reads the root `.env` when `DATABASE_URL` is
unset, and an already-set value always wins — which is how CI supplies it.

## Checking the schema really matches the migrations

`migrate status` proves the migrations were *applied*. It does not prove
`schema.prisma` still *describes* them — drift is possible and silent. To check:

```bash
export DATABASE_URL="$(sed -n 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//p' .env | head -1)"
# a throwaway second LOCAL database for Prisma to build the comparison in
psql -h localhost -U postgres -c 'CREATE DATABASE "portal_shadow" OWNER "portal";'

cd apps/api
./node_modules/.bin/prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "<the same URL with /portal_shadow as the path>"
```

Expect `No difference detected.`

Invoke `./node_modules/.bin/prisma` **directly rather than through `pnpm`**: on failure
`pnpm` echoes the full command line, which would put the shadow URL — password and all —
into the log.

Drop `portal_shadow` when you are done.
