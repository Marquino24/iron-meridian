#!/usr/bin/env bash
# Run the policy tests against a throwaway database on a local PostgreSQL 16:
#   sudo -u postgres bash supabase/test/run.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=iron_meridian_policy_test
dropdb --if-exists "$DB"
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f mock-supabase.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../../docs/supabase-setup.sql
# Running it twice must work (and keep the data).
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../../docs/supabase-setup.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f policies.sql
# Re-running the setup resets the owner list to the script's and keeps testers.
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../../docs/supabase-setup.sql
psql -q -t -A -d "$DB" -c "select 'owners after re-run: ' || string_agg(email, ', ') from private.owner_emails" -c "select 'testers kept: ' || count(*) from public.beta_users"
dropdb "$DB"
