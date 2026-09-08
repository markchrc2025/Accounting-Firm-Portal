#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# local-db.sh — bring up a LOCAL PostgreSQL in this machine and put the portal
# schema on it: migrations, then the seed.
#
# Written for a cloud dev VM that is reclaimed when idle. The VM keeps nothing,
# so this script is the procedure: re-run it after every restart and you are
# back where you were. It is idempotent — running it twice changes nothing the
# second time.
#
#   bash scripts/local-db.sh
#
# Reads DATABASE_URL from .env (or the environment, which wins). NEVER prints
# it: the password lives in that URL, so this script reports the hostname, the
# port and the database name only, and passes SQL through stdin rather than
# argv so the password never reaches `ps`.
#
# REFUSES to touch anything that is not local. See LOCAL_HOSTS below.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PG_VERSION_WANTED=16
LOCAL_HOSTS="localhost 127.0.0.1 ::1"

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# --- 1. Resolve DATABASE_URL into parts, without ever echoing it ------------

say "Reading DATABASE_URL"

if [[ -z "${DATABASE_URL:-}" ]]; then
  [[ -f .env ]] || die ".env not found and DATABASE_URL is not set. Copy .env.example to .env first."
  # Pull it out of .env without sourcing the file (which would run any code in it).
  DATABASE_URL="$(sed -n 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//p' .env | head -1)"
  DATABASE_URL="${DATABASE_URL%\"}"; DATABASE_URL="${DATABASE_URL#\"}"
  DATABASE_URL="${DATABASE_URL%\'}"; DATABASE_URL="${DATABASE_URL#\'}"
fi
[[ -n "$DATABASE_URL" ]] || die "DATABASE_URL is empty."
export DATABASE_URL

# Split the URL in Python — it handles percent-encoding in the password, which
# a regex would mangle. Only the non-secret parts are printed by this script.
eval "$(
  DB_URL="$DATABASE_URL" python3 - <<'PY'
import os, shlex, sys, urllib.parse
u = urllib.parse.urlparse(os.environ["DB_URL"])
if u.scheme not in ("postgresql", "postgres"):
    sys.exit(f"DATABASE_URL is not a PostgreSQL URL (scheme {u.scheme!r}).")
name = (u.path or "").lstrip("/")
if not name:
    sys.exit("DATABASE_URL names no database.")
for k, v in [
    ("PG_HOST", u.hostname or ""),
    ("PG_PORT", str(u.port or 5432)),
    ("PG_USER", urllib.parse.unquote(u.username or "")),
    ("PG_PASS", urllib.parse.unquote(u.password or "")),
    ("PG_DB", name),
]:
    print(f"{k}={shlex.quote(v)}")
PY
)"

[[ -n "$PG_USER" ]] || die "DATABASE_URL carries no username."
[[ -n "$PG_PASS" ]] || die "DATABASE_URL carries no password."

# --- 2. Refuse anything that is not this machine ----------------------------
# The live database holds real client data (decision log, D6). A script that
# creates roles and runs migrations must never be able to reach it.

is_local=0
for h in $LOCAL_HOSTS; do [[ "$PG_HOST" == "$h" ]] && is_local=1; done
if [[ $is_local -ne 1 ]]; then
  die "DATABASE_URL points at host '$PG_HOST', which is not local. Refusing to continue.
     This script only ever touches a database on ${LOCAL_HOSTS// /, }."
fi
info "host=$PG_HOST port=$PG_PORT database=$PG_DB role=$PG_USER  (local — ok)"

# --- 3. A PostgreSQL server, installed and running --------------------------

say "PostgreSQL server"

SUDO=""
[[ "$(id -u)" -ne 0 ]] && SUDO="sudo"

if ! command -v pg_ctlcluster >/dev/null 2>&1 && ! command -v pg_ctl >/dev/null 2>&1; then
  info "not installed — installing postgresql-$PG_VERSION_WANTED"
  $SUDO apt-get update -qq
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    "postgresql-$PG_VERSION_WANTED" || $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql
fi

command -v pg_lsclusters >/dev/null 2>&1 || die "No Debian/Ubuntu PostgreSQL cluster tooling found after install."

CLUSTER_LINE="$(pg_lsclusters --no-header 2>/dev/null | awk -v p="$PG_PORT" '$3 == p {print; exit}')"
[[ -n "$CLUSTER_LINE" ]] || CLUSTER_LINE="$(pg_lsclusters --no-header 2>/dev/null | head -1)"
[[ -n "$CLUSTER_LINE" ]] || die "PostgreSQL is installed but no cluster exists."

PG_VER="$(awk '{print $1}' <<<"$CLUSTER_LINE")"
PG_CLUSTER="$(awk '{print $2}' <<<"$CLUSTER_LINE")"
PG_STATUS="$(awk '{print $4}' <<<"$CLUSTER_LINE")"

if [[ "$PG_STATUS" != "online" ]]; then
  info "cluster $PG_VER/$PG_CLUSTER is $PG_STATUS — starting"
  $SUDO pg_ctlcluster "$PG_VER" "$PG_CLUSTER" start
else
  info "cluster $PG_VER/$PG_CLUSTER already online"
fi

# Wait for it to actually accept connections rather than assuming.
for _ in $(seq 1 30); do
  pg_isready -h "$PG_HOST" -p "$PG_PORT" -q && break
  sleep 1
done
pg_isready -h "$PG_HOST" -p "$PG_PORT" -q || die "PostgreSQL did not accept connections on $PG_HOST:$PG_PORT."
info "server: $(psql --version | awk '{print $3}') (cluster $PG_VER/$PG_CLUSTER, accepting connections)"

# --- 4. The role and the database -------------------------------------------

say "Role and database"

# Run SQL as the OS superuser over the unix socket. SQL arrives on stdin, so
# nothing sensitive appears in the process table.
as_super() {
  if [[ "$(id -u)" -eq 0 ]]; then
    su postgres -c "psql -v ON_ERROR_STOP=1 -qtA -f -"
  else
    sudo -u postgres psql -v ON_ERROR_STOP=1 -qtA -f -
  fi
}

# Build the DDL in Python so the password becomes a correctly-escaped SQL
# literal (and never a shell word).
role_sql() {
  PG_USER="$PG_USER" PG_PASS="$PG_PASS" python3 - <<'PY'
import os
def lit(s): return "'" + s.replace("'", "''") + "'"
def ident(s): return '"' + s.replace('"', '""') + '"'
u, p = os.environ["PG_USER"], os.environ["PG_PASS"]
print(f"""
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = {lit(u)}) THEN
    CREATE ROLE {ident(u)} LOGIN PASSWORD {lit(p)};
  ELSE
    ALTER ROLE {ident(u)} LOGIN PASSWORD {lit(p)};
  END IF;
END $$;
""")
PY
}

role_sql | as_super >/dev/null
info "role '$PG_USER' present"

# CREATE DATABASE cannot run inside a DO block, so check then create.
db_exists="$(printf "SELECT 1 FROM pg_database WHERE datname = '%s';" "${PG_DB//\'/\'\'}" | as_super || true)"
if [[ "$db_exists" == "1" ]]; then
  info "database '$PG_DB' already exists"
else
  printf 'CREATE DATABASE %s OWNER %s;\n' "\"${PG_DB//\"/\"\"}\"" "\"${PG_USER//\"/\"\"}\"" | as_super >/dev/null
  info "database '$PG_DB' created"
fi

# Prisma needs to create the shadow database for `migrate dev` and to own the
# public schema. Harmless on a local box; never granted anywhere else.
printf 'ALTER ROLE %s CREATEDB;\nGRANT ALL ON SCHEMA public TO %s;\n' \
  "\"${PG_USER//\"/\"\"}\"" "\"${PG_USER//\"/\"\"}\"" \
  | as_super >/dev/null 2>&1 || true

# --- 5. Prisma: generate, migrate, verify, seed ------------------------------

say "Prisma client"
pnpm --filter api prisma:generate >/dev/null
info "generated"

say "Migrations"
pnpm --filter api prisma:deploy

say "Migration status"
pnpm --filter api exec prisma migrate status

say "Seed"
pnpm --filter api db:seed

# --- 6. Row counts (the only data this script ever prints) -------------------

# Exact counts, not pg_stat_user_tables estimates: those need an ANALYZE and
# would make a re-run look different when nothing had changed.
say "Row counts"
printf '%s\n' "
SELECT relname,
       (xpath('/row/c/text()', query_to_xml(
          format('SELECT count(*) AS c FROM public.%I', relname),
          false, true, '')))[1]::text::bigint AS rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname = 'public'
ORDER BY relname;
" | PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -qtA -F'|' -f - \
  | awk -F'|' '$2 > 0 { printf "  %-28s %s\n", $1, $2 } { t += $2 } END { printf "  %-28s %s\n", "(total rows)", t }'

say "Ready — host=$PG_HOST port=$PG_PORT database=$PG_DB"
