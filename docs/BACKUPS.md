# Database backups, and how to restore one

**For whoever is on call when something is wrong with the database.** The first section
says what you have. The restore section is step by step and says what you should see
after each step. Nothing in it touches the live database until you decide to.

## What you have

The API dumps the production database into the firm's own bucket — the same Sliplane
object-storage bucket the Portal already uses for uploaded files (`acctgfirm-bucket`) —
under the prefix `backups/`. Nobody is asked and nothing has to be remembered; this is
decision D38 in `docs/DECISION-LOG.md`.

| Dump | When | Key in the bucket | Kept |
|---|---|---|---|
| **Pre-migrate** | at every deploy that carries a pending migration, *before* the migration runs | `backups/pre-migrate/<UTC time>-<migrations applied>.dump`, e.g. `backups/pre-migrate/20261010T181530Z-33.dump` | 365 days |
| **Nightly** | every night at 02:00 Manila (18:00 UTC) | `backups/daily/<yyyy-mm-dd>.dump`, dated by the Manila day, e.g. `backups/daily/2026-10-11.dump` | the newest 30 |

Each object is one `pg_dump --format=custom --compress=6` archive of the whole database:
every table, every row, and the migration history (`_prisma_migrations`), so a restored
copy knows exactly which migrations it has. A deploy with nothing pending takes no dump.
**If the pre-migrate dump or its upload fails, the deploy stops and the database is not
migrated.** Retention runs after each successful nightly and deletes only dumps the module
itself named; anything else under `backups/` is left alone.

**Versions.** The production server is **Sliplane Managed PostgreSQL 18** (read off the
Sliplane console, 2026-10-10). The API image carries `pg_dump` 18 to match. Before every
dump the module compares the two majors and refuses an older client (see *When the deploy
refuses to migrate*), so a server upgrade can never produce a half-made dump.

What is **not** in a dump: the files in the bucket itself (uploaded CORs, avatars,
generated BIR form exports). Those already live in the bucket; the dump holds the rows
that point to them.

## Where to look, and how to tell it is working

- **Sliplane console → the bucket → `backups/`.** `daily/` should show one object per
  night, the newest dated today or yesterday (Manila). `pre-migrate/` grows by one at each
  deploy that migrated.
- **The API deploy log** has lines starting `[backup]`:
  - `[backup] pre-migrate backup skipped: …` — the step did not run, and the line says why
    (not production, bucket not configured, or `BACKUP_ENABLED=false`).
  - `[backup] no pending migrations (33 applied); no dump taken` — a deploy with no schema
    change.
  - `[backup] uploaded backups/pre-migrate/… (… bytes); running prisma migrate deploy` — a
    dump was taken, then the migration ran.
  - `[backup] FAILED before migrating: …` then `the database was NOT migrated` — the dump
    or the upload failed; see *When the deploy refuses to migrate*.
- **The running API's log** around 02:00 Manila: `nightly backup uploaded
  backups/daily/… (… bytes); retention removed N of M objects`, or `nightly backup FAILED
  for …` with the reason. The nightly never stops the API; a failed night is retried the
  next night.

## Getting a dump out of the bucket

From the Sliplane console, open the object and download it. From a machine with the AWS
CLI (any S3 client works) and the bucket's credentials — the values of `S3_ENDPOINT`,
`S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` from the API service's
environment in Sliplane; never paste them into a chat, a ticket or this file:

```bash
export AWS_ACCESS_KEY_ID="<S3_ACCESS_KEY_ID>" AWS_SECRET_ACCESS_KEY="<S3_SECRET_ACCESS_KEY>"
aws --endpoint-url "<S3_ENDPOINT>" s3 ls "s3://<S3_BUCKET>/backups/daily/"
aws --endpoint-url "<S3_ENDPOINT>" s3 cp "s3://<S3_BUCKET>/backups/daily/2026-10-11.dump" ./2026-10-11.dump
```

Check the file before you spend time on it — a custom-format archive starts with `PGDMP`:

```bash
head -c 5 2026-10-11.dump; echo      # prints: PGDMP
```

## Restoring into a fresh database (never over the live one)

You need `pg_restore` of the same major version as the dump's server or newer
(`pg_restore --version`; the server is 18 and the API image carries 18). Restore into a
**new, empty database**, look at it, and only then decide whether the API should use it.

1. **Create the empty database** on the same PostgreSQL server. Use the user and host from
   `DATABASE_URL`; if that user may not create databases, use the credentials Sliplane
   shows on the PostgreSQL service.

   ```bash
   createdb -h <host> -p <port> -U <user> portal_restore
   ```

   You are asked for the password. Expect no output on success.

2. **Restore the dump into it:**

   ```bash
   pg_restore --no-owner --no-privileges --exit-on-error \
     -h <host> -p <port> -U <user> --dbname=portal_restore 2026-10-11.dump
   ```

   `--no-owner --no-privileges` lets the restore run as whatever user you have.
   `--exit-on-error` is deliberate: the restore stops at the first problem instead of
   quietly skipping objects, so a finished restore is a complete one. Expect no output on
   success; for this database it takes seconds.

3. **Check it is the database you expect:**

   ```bash
   psql -h <host> -p <port> -U <user> -d portal_restore -c \
     'select count(*) as migrations, max(migration_name) as latest from "_prisma_migrations"'
   psql -h <host> -p <port> -U <user> -d portal_restore -c \
     'select (select count(*) from clients) as clients, (select count(*) from users) as users'
   ```

   For a pre-migrate dump, `migrations` is the number at the end of its key (the `-33` in
   the example). `latest` names the newest migration the copy has. The counts should look
   like the business you know.

4. **Point the API at it** — only once step 3 satisfied you. In Sliplane, edit the API
   service's `DATABASE_URL` and change **only the database name** at the end of the path:
   `/portal` becomes `/portal_restore`; user, password, host, port and `?schema=public`
   stay as they are. Redeploy the API. In the deploy log expect `[backup] no pending
   migrations (…)` if the dump is from the current version — or, if you restored an older
   one, `[backup] … pending migration(s)` followed by a fresh pre-migrate dump *of the
   restored copy* and then the migration. A restored database is backed up before it is
   migrated, like any other.

5. **Afterwards, when calm:** keep `portal_restore` as the live name, or rename
   (`ALTER DATABASE portal RENAME TO portal_before_restore` and `portal_restore` to
   `portal`, then set `DATABASE_URL` back). Do not drop the old database the same day.

## Which copy: the bucket, or Sliplane's point-in-time recovery

| | Sliplane PITR | The bucket dumps |
|---|---|---|
| Whose copy | the platform's | the firm's |
| Granularity | any moment inside its retention window | 02:00 Manila each night, plus the moment before each migration |
| Reaches | the managed PostgreSQL service | anywhere `pg_restore` runs — another server, a laptop, another host |
| Good for | "someone deleted rows at 14:10 today" | "the migration in today's deploy was wrong"; "we need last Tuesday's books"; an audit; leaving the platform |
| How | the Sliplane console, on the PostgreSQL service | this document |

Use PITR for an intra-day mistake; the pre-migrate dump for a bad migration; a nightly for
anything older. They combine: restore a dump into a new database while PITR works on the
live one.

## When the deploy refuses to migrate

The log says `[backup] FAILED before migrating: …` and the container exits before
`prisma migrate deploy`. This is the design (D38): no production migration without a copy.
Fix the cause named in the line — pg_dump could not reach the database; the bucket rejected
the upload; the four `S3_*` variables are not all set — and redeploy.

**Emergency override.** Setting `BACKUP_ENABLED=false` on the API service in Sliplane makes
the next deploy skip the dump (one log line says so) and migrate immediately. It also stops
the nightly. Use it only when a deploy must go out and the bucket cannot be made to work
right now; take a copy another way first (PITR exists), and remove the variable again the
same day.

**`pg_dump 18 is older than the server 19: install postgresql-client-19 in
apps/api/Dockerfile`** (whatever the two numbers are) means the PostgreSQL server has moved
to a newer major than the image's client. The module checks this before every dump — the
pre-migrate step fails closed with that line, the nightly logs it as its failure reason and
reports it to Sentry when Sentry is configured — and the fix is exactly the one number it
names, in `apps/api/Dockerfile`.

## How this is tested

- `apps/api/test/db/track-a-backup.db-spec.ts` is a **restore drill**: it dumps the local
  database with the module's own `dump()`, restores it with the exact `pg_restore` command
  above into a scratch database, and compares every table's row count and every row of
  `_prisma_migrations` (name and checksum). CI runs it in the `database` job on every pull
  request, so the procedure on this page cannot rot unnoticed.
- `apps/api/src/backup/track-a-backup.spec.ts` proves, with no database and no bucket, that
  a failed dump or upload never lets `prisma migrate deploy` run; that the gate skips
  everywhere but production; that retention deletes only what the rules say; and that the
  nightly fires at 18:00 UTC with the Manila date in the key.
- Nothing in this repository uploads from a developer machine or from CI:
  `NODE_ENV=production` plus the four `S3_*` variables is the only combination that does.
