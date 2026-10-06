-- A referenced plan is an entitlement record, not disposable catalog data.
-- Keep both customer and payment history linked if an administrator attempts
-- a direct DELETE outside the API's archive-aware plan removal flow.
DO $$
DECLARE
  target_table regclass;
  plan_column smallint;
  fk record;
  found_plan_fk boolean;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'public.isp_customers'::regclass,
    'public.isp_transactions'::regclass
  ]
  LOOP
    SELECT attnum
      INTO plan_column
      FROM pg_attribute
     WHERE attrelid = target_table
       AND attname = 'plan_id'
       AND NOT attisdropped;

    found_plan_fk := false;
    FOR fk IN
      SELECT conname, confdeltype
        FROM pg_constraint
       WHERE contype = 'f'
         AND conrelid = target_table
         AND confrelid = 'public.isp_plans'::regclass
         AND array_length(conkey, 1) = 1
         AND conkey[1] = plan_column
    LOOP
      found_plan_fk := true;
      IF fk.confdeltype <> 'r' THEN
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', target_table, fk.conname);
        EXECUTE format(
          'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (plan_id) REFERENCES public.isp_plans(id) ON DELETE RESTRICT',
          target_table,
          fk.conname
        );
      END IF;
    END LOOP;

    IF NOT found_plan_fk THEN
      RAISE EXCEPTION 'Expected plan_id foreign key to public.isp_plans was not found on %', target_table;
    END IF;
  END LOOP;
END
$$;
