-- ---------------------------------------------------------------------------
-- 020_reporting_helpers.sql
-- Ledger-based receivable / payable totals for the dashboard.
--
-- A partner's outstanding balance is the running ledger total
-- (recalc_*_ledger): positive means the hawker owes us / we owe the supplier.
-- Summing the latest balance per partner gives an accurate receivable /
-- payable figure that already accounts for payments and credit returns.
-- ---------------------------------------------------------------------------

create or replace function public.total_receivables(p_business_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(bal), 0)
    from (
      select coalesce(
               (select t.balance_after
                  from public.hawker_transactions t
                 where t.hawker_id = h.id
                 order by t.entry_date desc, t.created_at desc, t.id desc
                 limit 1),
               0) as bal
        from public.hawkers h
       where h.business_id = p_business_id
    ) s
   where bal > 0;
$$;

create or replace function public.total_payables(p_business_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(bal), 0)
    from (
      select coalesce(
               (select t.balance_after
                  from public.supplier_transactions t
                 where t.supplier_id = s.id
                 order by t.entry_date desc, t.created_at desc, t.id desc
                 limit 1),
               0) as bal
        from public.suppliers s
       where s.business_id = p_business_id
    ) s
   where bal > 0;
$$;

grant execute on function public.total_receivables(uuid) to authenticated;
grant execute on function public.total_payables(uuid) to authenticated;