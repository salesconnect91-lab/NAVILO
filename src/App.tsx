import type { ReactNode } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { FeatureAccessProvider, FeaturePathGuard, useFeatureAccess } from "@/auth/FeatureAccess";
import { canPerformModule, canViewModule, type ModuleAction, type ModuleKey } from "@/auth/permissions";
import type { FeatureAction } from "@/config/featureRegistry";
import Login from "@/auth/Login";
import ResetPassword from "@/auth/ResetPassword";
import ProtectedRoute from "@/auth/ProtectedRoute";
import Layout from "@/components/Layout";
import CompanySwitcher from "@/components/CompanySwitcher";
import BusinessUnitSwitcher from "@/components/BusinessUnitSwitcher";
import PrintPreviewController from "@/components/PrintPreviewController";
import GatePassSummaryPrintBridge from "@/components/GatePassSummaryPrintBridge";
import GlobalModalManager from "@/components/GlobalModalManager";
import DashboardGlobalSearch from "@/components/DashboardGlobalSearch";
import ReportSurface from "@/components/reports/ReportSurface";
import Dashboard from "@/modules/Dashboard";
import MasterData from "@/modules/master-data/MasterData";
import SalesInvoiceList from "@/modules/sales/SalesInvoiceList";
import SalesInvoiceCreate from "@/modules/sales/SalesInvoiceCreate";
import SalesInvoiceDetail from "@/modules/sales/SalesInvoiceDetail";
import SalespersonReportHub from "@/modules/sales/SalespersonReportHub";
import SalespersonLedger from "@/modules/sales/SalespersonLedger";
import ChargeMaster from "@/modules/sales/ChargeMaster";
import Purchase from "@/modules/purchase/Purchase";
import Godown from "@/modules/master-data/Godown";
import Production from "@/modules/production/Production";
import Cutting from "@/modules/cutting/Cutting";
import Accounting from "@/modules/accounting/Accounting";
import CustomerInvoiceStatement from "@/modules/accounting/CustomerInvoiceStatement";
import Settings from "@/modules/settings/Settings";
import Reports from "@/modules/reports/Reports";
import SteelStockControl from "@/modules/reports/SteelStockControl";
import SupplierAgingReport from "@/modules/reports/SupplierAgingReport";
import ConsolidatedInvoices from "@/modules/sales/ConsolidatedInvoices";
import OrderBook from "@/modules/orders/OrderBook";
import OwnerPanel from "@/modules/platform/OwnerPanel";
import OpeningBalanceMigration from "@/modules/platform/OpeningBalanceMigration";
import TransportWorkspace from "@/modules/transport/TransportWorkspace";

function OwnerOnly({ children }: { children?: ReactNode }) {
  const { isPlatformOwner } = useAuth();
  if (!isPlatformOwner) return <Navigate to="/" replace />;
  return <>{children ?? <OwnerPanel />}</>;
}

function moduleLicensed(companyModules:string[]|undefined,module:ModuleKey){return !companyModules||companyModules.includes(module)}

function ModuleOnly({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { isPlatformOwner, activeCompany, activeBusinessUnit } = useAuth();
  const roleAllowed = canViewModule(activeBusinessUnit?.membership_role ?? activeCompany?.membership_role, module, isPlatformOwner);
  const companyAllowed = moduleLicensed(activeCompany?.enabled_modules,module);
  const unitAllowed = !activeBusinessUnit || activeBusinessUnit.enabled_modules.includes(module);
  return roleAllowed && companyAllowed && unitAllowed ? <>{children}</> : <Navigate to="/" replace />;
}

function ModuleActionOnly({ module, action, featureKey, children }: { module: ModuleKey; action: ModuleAction; featureKey?: string; children: ReactNode }) {
  const { isPlatformOwner, activeCompany, activeBusinessUnit } = useAuth();
  const { isFeatureEnabled } = useFeatureAccess();
  const role = activeBusinessUnit?.membership_role ?? activeCompany?.membership_role;
  const permissions = activeBusinessUnit?.permissions ?? activeCompany?.permissions;
  const roleAllowed = canPerformModule(role, module, action, permissions, isPlatformOwner);
  const companyAllowed = moduleLicensed(activeCompany?.enabled_modules,module);
  const unitAllowed = !activeBusinessUnit || activeBusinessUnit.enabled_modules.includes(module);
  const featureAllowed = !featureKey || isFeatureEnabled(featureKey, action as FeatureAction);
  return roleAllowed && companyAllowed && unitAllowed && featureAllowed ? <>{children}</> : <Navigate to="/" replace />;
}

function BusinessTypeOnly({ type, children }: { type: string; children: ReactNode }) {
  const { activeBusinessUnit } = useAuth();
  return !activeBusinessUnit || activeBusinessUnit.business_unit_type === type ? <>{children}</> : <Navigate to="/" replace />;
}

function WorkspaceSwitchers() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/owner")) return null;
  return <><CompanySwitcher /><BusinessUnitSwitcher /></>;
}

function GlobalExperience() {
  return <><PrintPreviewController /><GatePassSummaryPrintBridge /><GlobalModalManager /></>;
}

function DashboardHome() {
  const { activeCompany,activeBusinessUnit }=useAuth();
  if(activeBusinessUnit?.business_unit_type==="transport"){
    const licensed=moduleLicensed(activeCompany?.enabled_modules,"transport")&&activeBusinessUnit.enabled_modules.includes("transport");
    return licensed?<TransportWorkspace/>:<div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"><strong>Transport service is not active.</strong> Enable Transport ERP in Owner Control for this company and Transport business unit.</div>;
  }
  return <><DashboardGlobalSearch /><Dashboard /></>;
}

export default function App() {
  const { loading, accountingSetupError, retryAccountingSetup, signOut, activeCompany, activeBusinessUnit } = useAuth();
  const workspaceKey = `${activeCompany?.company_id ?? "no-company"}:${activeBusinessUnit?.business_unit_id ?? "no-unit"}`;

  if (loading) return <><GlobalExperience /><div className="min-h-screen flex items-center justify-center"><div className="text-slate-400">Loading… / لوڈ ہو رہا ہے…</div></div></>;
  if (accountingSetupError) return <><GlobalExperience /><div className="min-h-screen bg-slate-50 px-4 py-12"><div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-sm"><h1 className="text-lg font-bold text-slate-900">Accounting setup could not be completed / اکاؤنٹنگ سیٹ اپ مکمل نہیں ہو سکا</h1><p className="mt-2 text-sm text-slate-600">ERP access is paused so transactions cannot be posted without a complete Chart of Accounts. / مکمل چارٹ آف اکاؤنٹس کے بغیر ٹرانزیکشن پوسٹ نہیں کی جا سکتی۔</p><div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{accountingSetupError}</div><div className="mt-5 flex gap-3"><button type="button" className="btn-primary" onClick={retryAccountingSetup}>Retry accounting setup / دوبارہ اکاؤنٹنگ سیٹ اپ کریں</button><button type="button" className="btn" onClick={() => void signOut()}>Sign out / لاگ آؤٹ</button></div></div></div></>;

  return <><GlobalExperience /><Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/*" element={<ProtectedRoute><FeatureAccessProvider><><WorkspaceSwitchers /><FeaturePathGuard><Layout key={workspaceKey}><Routes>
      <Route path="/" element={<ModuleOnly module="dashboard"><DashboardHome /></ModuleOnly>} />
      <Route path="/owner" element={<OwnerOnly />} />
      <Route path="/owner/opening-balances" element={<OwnerOnly><OpeningBalanceMigration /></OwnerOnly>} />
      <Route path="/master-data/*" element={<ModuleOnly module="master"><MasterData /></ModuleOnly>} />
      <Route path="/sales" element={<ModuleOnly module="sales"><SalesInvoiceList /></ModuleOnly>} />
      <Route path="/sales/new" element={<ModuleActionOnly module="sales" action="create" featureKey="sales-invoices"><SalesInvoiceCreate /></ModuleActionOnly>} />
      <Route path="/sales/:id/edit" element={<ModuleActionOnly module="sales" action="edit" featureKey="sales-invoices"><SalesInvoiceCreate /></ModuleActionOnly>} />
      <Route path="/sales/report" element={<ModuleOnly module="reports"><ReportSurface><SalespersonReportHub /></ReportSurface></ModuleOnly>} />
      <Route path="/sales/person-ledger" element={<ModuleOnly module="reports"><ReportSurface><SalespersonLedger /></ReportSurface></ModuleOnly>} />
      <Route path="/sales/charges" element={<ModuleOnly module="master"><ChargeMaster /></ModuleOnly>} />
      <Route path="/sales/consolidated" element={<ModuleOnly module="sales"><ConsolidatedInvoices /></ModuleOnly>} />
      <Route path="/sales/order-book" element={<ModuleOnly module="sales"><OrderBook type="sales" /></ModuleOnly>} />
      <Route path="/sales/:id" element={<ModuleOnly module="sales"><SalesInvoiceDetail /></ModuleOnly>} />
      <Route path="/purchase/*" element={<ModuleOnly module="purchase"><Purchase /></ModuleOnly>} />
      <Route path="/godown/*" element={<ModuleOnly module="inventory"><Godown /></ModuleOnly>} />
      <Route path="/production/*" element={<BusinessTypeOnly type="steel"><ModuleOnly module="production"><Production /></ModuleOnly></BusinessTypeOnly>} />
      <Route path="/cutting/*" element={<BusinessTypeOnly type="steel"><ModuleOnly module="production"><Cutting /></ModuleOnly></BusinessTypeOnly>} />
      <Route path="/transport/*" element={<BusinessTypeOnly type="transport"><ModuleOnly module="transport"><TransportWorkspace /></ModuleOnly></BusinessTypeOnly>} />
      <Route path="/accounting/customer-invoice-statement" element={<ModuleOnly module="accounting"><ReportSurface><CustomerInvoiceStatement /></ReportSurface></ModuleOnly>} />
      <Route path="/accounting/*" element={<ModuleOnly module="accounting"><Accounting /></ModuleOnly>} />
      <Route path="/reports/steel-stock" element={<BusinessTypeOnly type="steel"><ModuleOnly module="reports"><ReportSurface><SteelStockControl /></ReportSurface></ModuleOnly></BusinessTypeOnly>} />
      <Route path="/reports/supplier-aging" element={<ModuleOnly module="reports"><ReportSurface><SupplierAgingReport /></ReportSurface></ModuleOnly>} />
      <Route path="/reports/*" element={<ModuleOnly module="reports"><ReportSurface><Reports /></ReportSurface></ModuleOnly>} />
      <Route path="/settings/*" element={<ModuleOnly module="settings"><Settings /></ModuleOnly>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></Layout></FeaturePathGuard></></FeatureAccessProvider></ProtectedRoute>} />
  </Routes></>;
}
