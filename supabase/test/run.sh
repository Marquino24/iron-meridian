#!/usr/bin/env bash
# Run the policy tests against a throwaway database on a local PostgreSQL 16:
#   sudo -u postgres bash supabase/test/run.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=iron_meridian_policy_test
dropdb --if-exists "$DB"
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f mock-supabase.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../schema.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f policies.sql
dropdb "$DB"
