-- ---------------------------------------------------------------------------
-- 017_rls_writes.sql
-- Permission-gated write policies for simple single-table catalog / partner
-- CRUD. Financial documents and all multi-table mutations continue to go
-- through security-definer RPCs only.
-- ---------------------------------------------------------------------------

-- Catalog: products, product_units, categories  -> products.write
create policy products_write_insert on public.products
  for insert to authenticated
  with check (public.app_can(business_id, 'products.write'));
create policy products_write_update on public.products
  for update to authenticated
  using (public.app_can(business_id, 'products.write'))
  with check (public.app_can(business_id, 'products.write'));

create policy product_units_write_insert on public.product_units
  for insert to authenticated
  with check (public.app_can(business_id, 'products.write'));
create policy product_units_write_update on public.product_units
  for update to authenticated
  using (public.app_can(business_id, 'products.write'))
  with check (public.app_can(business_id, 'products.write'));
create policy product_units_write_delete on public.product_units
  for delete to authenticated
  using (public.app_can(business_id, 'products.write'));

create policy categories_write_insert on public.categories
  for insert to authenticated
  with check (public.app_can(business_id, 'products.write'));
create policy categories_write_update on public.categories
  for update to authenticated
  using (public.app_can(business_id, 'products.write'))
  with check (public.app_can(business_id, 'products.write'));

-- Partners
create policy hawkers_write_insert on public.hawkers
  for insert to authenticated
  with check (public.app_can(business_id, 'hawkers.write'));
create policy hawkers_write_update on public.hawkers
  for update to authenticated
  using (public.app_can(business_id, 'hawkers.write'))
  with check (public.app_can(business_id, 'hawkers.write'));

create policy suppliers_write_insert on public.suppliers
  for insert to authenticated
  with check (public.app_can(business_id, 'suppliers.write'));
create policy suppliers_write_update on public.suppliers
  for update to authenticated
  using (public.app_can(business_id, 'suppliers.write'))
  with check (public.app_can(business_id, 'suppliers.write'));

-- Business settings (cash accounts)
create policy cash_accounts_write_insert on public.cash_accounts
  for insert to authenticated
  with check (public.app_can(business_id, 'settings.manage'));
create policy cash_accounts_write_update on public.cash_accounts
  for update to authenticated
  using (public.app_can(business_id, 'settings.manage'))
  with check (public.app_can(business_id, 'settings.manage'));

-- Table privileges for the above (RLS policies only apply when granted).
grant insert, update on public.products, public.product_units, public.categories,
  public.hawkers, public.suppliers, public.cash_accounts to authenticated;

grant delete on public.product_units to authenticated;
