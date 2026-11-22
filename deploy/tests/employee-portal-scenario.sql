do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and left(p.proname, 9) = 'employee_' and p.prosecdef
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or not has_function_privilege('service_role', p.oid, 'EXECUTE'))
  ) then raise exception 'Employee RPC grants are not service-role only'; end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and left(c.relname, 9) = 'employee_' and c.relkind = 'r'
      and (not c.relrowsecurity or has_table_privilege('anon', c.oid, 'SELECT')
        or has_table_privilege('authenticated', c.oid, 'SELECT'))
  ) then raise exception 'An employee table is not properly isolated'; end if;
end $$;

set local role service_role;
do $$
declare
  employee uuid;
  destination uuid;
  withdrawal uuid;
  result jsonb;
  month_start date := date_trunc('month', current_date)::date;
  month_end date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
begin
  select (public.employee_create_invited(
    'TEST-1','employee-test','Local Test Employee',null,null,'employee-test',
    1200.25,'bank','fixture-ciphertext','••••1234','fixture-token',now() + interval '1 day','test-admin'
  )->>'id')::uuid into employee;
  perform public.employee_activate_invitation('fixture-token','fixture-password-hash');
  if (public.employee_admin_summary()->>'active_employee_count')::integer <> 1 then
    raise exception 'Activated user is not reflected in the directory summary';
  end if;
  perform public.employee_post_payroll(month_start,month_end,'test-admin');
  perform public.employee_post_payroll(month_start,month_end,'test-admin');
  if (select count(*) from public.employee_payroll_records where employee_id = employee) <> 1
      or (public.employee_dashboard_snapshot(employee)->>'available_balance')::numeric <> 1200.25 then
    raise exception 'Payroll was not credited exactly once';
  end if;
  if (select enabled from public.employee_payout_controls where id='global') then
    raise exception 'Withdrawal controls must be disabled by default';
  end if;
  update public.employee_payout_controls set enabled = true, enabled_destination_types = array['bank'] where id='global';
  select id into destination from public.employee_payout_destinations where employee_id = employee;
  select (public.employee_request_withdrawal(employee,destination,600.10,'fixture-request-001')->>'id')::uuid into withdrawal;
  result := public.employee_request_withdrawal(employee,destination,600.10,'fixture-request-001');
  if (result->>'id')::uuid <> withdrawal
      or (public.employee_dashboard_snapshot(employee)->>'available_balance')::numeric <> 600.15 then
    raise exception 'Withdrawal did not reserve the expected amount exactly once';
  end if;
  begin
    perform public.employee_request_withdrawal(employee,destination,601,'fixture-request-002');
    raise exception 'Over-withdrawal unexpectedly succeeded' using errcode='XX000';
  exception when raise_exception then
    if sqlerrm not ilike '%balance%' then raise; end if;
  end;
  perform public.employee_review_withdrawal(withdrawal,'test-admin','reject','fixture rejection');
  if (public.employee_dashboard_snapshot(employee)->>'available_balance')::numeric <> 1200.25 then
    raise exception 'Rejecting a withdrawal did not release the reservation';
  end if;
  select (public.employee_request_withdrawal(employee,destination,100.10,'fixture-request-003')->>'id')::uuid into withdrawal;
  perform public.employee_review_withdrawal(withdrawal,'test-admin','approve',null);
  perform public.employee_record_confirmed_payout(withdrawal,'test-admin','fixture-bank-reference');
  result := public.employee_dashboard_snapshot(employee);
  if (result->>'available_balance')::numeric <> 1100.15 or (result->>'total_withdrawn')::numeric <> 100.10 then
    raise exception 'Recorded bank transfer did not produce the expected ledger totals';
  end if;
end $$;
