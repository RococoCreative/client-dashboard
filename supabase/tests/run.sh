#!/usr/bin/env bash
# The local SQL harness. It starts a throwaway PostgreSQL cluster, loads stand-ins for
# Supabase's own schemas (stubs.sql), applies every migration in supabase/migrations/ in
# order, re-applies 0024 and later to prove they are idempotent, loads the test helpers
# (helpers.sql), and runs each supabase/tests/*.test.sql in its own rolled-back transaction.
#
# It needs a local PostgreSQL 16 or newer. It is not part of CI (CI has no PostgreSQL); run it
# by hand for any change under supabase/:
#
#   npm run test:sql
#
# Developer switches:
#   SQL_THROUGH=0023  apply migrations up to and including that number, then stop (no tests).
#   SQL_KEEP=1        leave the cluster running afterwards and print how to connect to it.
#
# PG_BIN points at a PostgreSQL bin directory; SQL_PORT picks the port (default 54329).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TESTS="$ROOT/supabase/tests"
MIGRATIONS="$ROOT/supabase/migrations"

# Find the binaries.
if [[ -n "${PG_BIN:-}" ]]; then
  :
elif [[ -d /usr/lib/postgresql/16/bin ]]; then
  PG_BIN=/usr/lib/postgresql/16/bin
else
  PG_BIN="$(pg_config --bindir 2>/dev/null || true)"
fi
PG_MAJOR=""
if [[ -x "$PG_BIN/postgres" ]]; then
  PG_MAJOR="$("$PG_BIN/postgres" --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
fi
if [[ -z "$PG_MAJOR" || "$PG_MAJOR" -lt 16 ]]; then
  echo "The SQL harness needs PostgreSQL 16 or newer. Set PG_BIN to its bin directory."
  exit 2
fi

# The work directory sits under /tmp literally: the server's socket path must stay under 107
# bytes, and when running as root the server runs as the postgres OS user, which cannot
# traverse root-only directories.
WORK="$(mktemp -d /tmp/hubsql.XXXXXX)"
chmod 755 "$WORK"

# Server-side commands run as postgres when we are root; psql always runs as the current user.
AS_SERVER=()
if [[ "$(id -u)" -eq 0 ]]; then
  chown postgres "$WORK"
  AS_SERVER=(runuser -u postgres --)
fi

PORT="${SQL_PORT:-54329}"

cleanup() {
  if [[ "${SQL_KEEP:-}" == "1" ]]; then
    echo "Cluster kept: psql -h $WORK -p $PORT -U postgres"
    echo "Stop it with: ${AS_SERVER[*]} $PG_BIN/pg_ctl -D $WORK/data -m fast stop && rm -rf $WORK"
    return
  fi
  "${AS_SERVER[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${AS_SERVER[@]}" "$PG_BIN/initdb" -U postgres --auth=trust --no-sync -E UTF8 --locale=C \
  -D "$WORK/data" >/dev/null
"${AS_SERVER[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" \
  -o "-k $WORK -p $PORT -c listen_addresses='' -c fsync=off" \
  -l "$WORK/server.log" -w start >/dev/null

PSQL=("$PG_BIN/psql" -X -q -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1)

"${PSQL[@]}" -f "$TESTS/stubs.sql" >/dev/null

# A migration is within range unless SQL_THROUGH is set and its number is greater.
within_range() {
  local number="$1"
  [[ -z "${SQL_THROUGH:-}" ]] || ((10#$number <= 10#$SQL_THROUGH))
}

mkdir -p "$WORK/migrations"
applied=0
reapplied=0
MIGRATION_FILES=()
for file in "$MIGRATIONS"/[0-9][0-9][0-9][0-9]_*.sql; do
  [[ -e "$file" ]] || continue
  name="$(basename "$file")"
  within_range "${name:0:4}" || continue
  # The one transformation the harness ever makes: pg_cron and pg_net cannot be installed in
  # a throwaway cluster, so their create extension lines are dropped and stubs.sql provides
  # cron and net stand-ins. Nothing else is ever rewritten.
  sed -E '/^[[:space:]]*create[[:space:]]+extension[[:space:]]+if[[:space:]]+not[[:space:]]+exists[[:space:]]+(pg_cron|pg_net)\b.*;[[:space:]]*$/Id' \
    "$file" >"$WORK/migrations/$name"
  MIGRATION_FILES+=("$name")
done

# First pass: every migration once, each as one transaction, as the Supabase SQL editor runs it.
for name in "${MIGRATION_FILES[@]}"; do
  if ! "${PSQL[@]}" --single-transaction -f "$WORK/migrations/$name" >"$WORK/out" 2>&1; then
    echo "Migration $name failed."
    cat "$WORK/out"
    exit 1
  fi
  applied=$((applied + 1))
done

# Second pass: 0024 and later must survive being pasted again.
for name in "${MIGRATION_FILES[@]}"; do
  ((10#${name:0:4} >= 24)) || continue
  if ! "${PSQL[@]}" --single-transaction -f "$WORK/migrations/$name" >"$WORK/out" 2>&1; then
    echo "Migration $name is not idempotent."
    cat "$WORK/out"
    exit 1
  fi
  reapplied=$((reapplied + 1))
done

if [[ -n "${SQL_THROUGH:-}" ]]; then
  echo "Applied migrations through $SQL_THROUGH; tests skipped."
  exit 0
fi

"${PSQL[@]}" -f "$TESTS/helpers.sql" >/dev/null

passed=0
failed=0
found=0
for file in "$TESTS"/*.test.sql; do
  [[ -e "$file" ]] || continue
  found=$((found + 1))
  if "${PSQL[@]}" -c 'begin' -f "$file" -c 'rollback' >"$WORK/out" 2>&1; then
    passed=$((passed + 1))
  else
    echo "FAIL $(basename "$file")"
    sed 's/^/  /' "$WORK/out"
    failed=$((failed + 1))
  fi
done

echo "SQL tests: $passed passed, $failed failed ($applied migrations applied, $reapplied re-applied)"
if ((failed > 0 || found == 0)); then
  exit 1
fi
exit 0
