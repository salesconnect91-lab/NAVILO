revoke select on table
  public.business_unit_isolation_audit,
  public.inventory_aging_report,
  public.inventory_turnover_report,
  public.item_profitability_report,
  public.monthly_business_performance_report
from anon;

grant select on table
  public.business_unit_isolation_audit,
  public.inventory_aging_report,
  public.inventory_turnover_report,
  public.item_profitability_report,
  public.monthly_business_performance_report
to authenticated, service_role;
