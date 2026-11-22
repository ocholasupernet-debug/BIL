#!/usr/bin/env bash
# Exercises the employee migration in a fresh, socket-only PostgreSQL cluster.
set -euo pipefail
umask 077
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cluster=$(mktemp -d /tmp/bil-employee-pg.XXXXXX)
local_env=(env -i "PATH=$PATH" "HOME=$cluster" "PGHOST=$cluster" PGPORT=55474 PGUSER=postgres PGDATABASE=postgres)
cleanup() {
  if [[ -f "$cluster/pg/postmaster.pid" ]]; then
    "${local_env[@]}" pg_ctl -D "$cluster/pg" -m fast -w stop >/dev/null
  fi
  rm -rf -- "$cluster"
}
trap cleanup EXIT
"${local_env[@]}" initdb -D "$cluster/pg" -U postgres -A trust --no-locale >/dev/null
"${local_env[@]}" pg_ctl -D "$cluster/pg" -l "$cluster/server.log" \
  -o "-k $cluster -p 55474 -c listen_addresses=''" -w start >/dev/null
psql=("${local_env[@]}" psql -X --no-password -v ON_ERROR_STOP=1 -q)
export LC_ALL=C
"${psql[@]}" <<'SQL'
create role anon;
create role authenticated;
create role service_role bypassrls;
-- Reproduce the explicit default grants Supabase can give new API objects.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
SQL
migration="$root/artifacts/api-server/migrations/2026_employee_portal.sql"
"${psql[@]}" --single-transaction -f "$migration"
"${psql[@]}" --single-transaction -f "$migration" 2>"$cluster/reapply.log"
"${psql[@]}" --single-transaction -f "$root/deploy/tests/employee-portal-scenario.sql"
reserve() {
  "${psql[@]}" -v request_key="$1" <<'SQL'
set role service_role;
select public.employee_request_withdrawal(p.id,d.id,700,:'request_key')
from public.employee_profiles p join public.employee_payout_destinations d on d.employee_id=p.id
where p.employee_number='TEST-1';
SQL
}
reserve fixture-concurrent-001 >"$cluster/reserve1.log" 2>&1 & first=$!
reserve fixture-concurrent-002 >"$cluster/reserve2.log" 2>&1 & second=$!
first_status=0; wait "$first" || first_status=$?
second_status=0; wait "$second" || second_status=$?
if [[ "$first_status" -eq 0 && "$second_status" -ne 0 ]]; then
  grep -qi 'balance' "$cluster/reserve2.log"
elif [[ "$second_status" -eq 0 && "$first_status" -ne 0 ]]; then
  grep -qi 'balance' "$cluster/reserve1.log"
else
  echo "Exactly one competing withdrawal should succeed"; exit 1
fi
"${psql[@]}" <<'SQL'
do $$
declare
  employee uuid;
  withdrawal uuid;
begin
  select id into strict employee from public.employee_profiles where employee_number='TEST-1';
  if (public.employee_dashboard_snapshot(employee)->>'available_balance')::numeric <> 400.15 then
    raise exception 'Concurrent withdrawals reserved the wrong amount';
  end if;
  select id into strict withdrawal from public.employee_withdrawal_requests
    where employee_id=employee and status='pending';
  perform public.employee_cancel_withdrawal(employee,withdrawal);
  if (public.employee_dashboard_snapshot(employee)->>'available_balance')::numeric <> 1100.15 then
    raise exception 'Cancellation did not release the reservation';
  end if;
  begin
    update public.employee_financial_ledger set amount=amount where employee_id=employee;
    raise exception 'An immutable ledger entry could be changed' using errcode='XX000';
  exception when raise_exception then
    if sqlerrm not ilike '%reversal%' then raise; end if;
  end;
end $$;
SQL
echo "Employee schema replay, role isolation, payroll, concurrent withdrawals, cancellation, and immutable ledger scenario passed."
