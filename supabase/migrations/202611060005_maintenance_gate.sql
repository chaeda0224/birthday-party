create or replace function public.bp_maintenance_claim() returns boolean
language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
  update private.bp_maintenance set last_run=clock_timestamp()
    where last_run<clock_timestamp()-interval '1 minute';
  get diagnostics changed=row_count;
  return changed>0;
end $$;
notify pgrst,'reload schema';
