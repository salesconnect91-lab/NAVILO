import { lazy, Suspense, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { FeatureAccessProvider, FeaturePathGuard, useFeatureAccess } from "@/auth/FeatureAccess";
import { canPerformModule, type ModuleAction, type ModuleKey } from "@/auth/permissions";
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
const Dashboard = lazy(() => import("@/modules/Dashboard"));
const MasterData = lazy(() => import("@/modules/master-data/MasterData"));
const SalesInvoiceList = lazy(() => import("@/modules/sales/SalesInvoiceList"));
const SalesInvoiceCreate = lazy(() => import("@/modules/sales/SalesInvoiceCreate"));
const SalesInvoiceDetail = lazy(() => import("@/modules/sales/SalesInvoiceDetail"));
const SalespersonReportHub = lazy(() => import("@/modules/sales/SalespersonReportHub"));
const SalespersonLedger = lazy(() => import("@/modules/sales/SalespersonLedger"));
const ChargeMaster = lazy(() => import("@/modules/sales/ChargeMaster"));
const Purchase = lazy(() => import("@/modules/purchase/Purchase"));
const Godown = lazy(() => import("@/modules/master-data/Godown"));
const Production = lazy(() => import("@/modules/production/Production"));
const Cutting = lazy(() => import("@/modules/cutting/Cutting"));
const Accounting = lazy(() => import("@/modules/accounting/Accounting"));
const CustomerInvoiceStatement = lazy(() => import("@/modules/accounting/CustomerInvoiceStatement"));
const Settings = lazy(() => import("@/modules/settings/Settings"));
const Reports = lazy(() => import("@/modules/reports/Reports"));
const SteelStockControl = lazy(() => import("@/modules/reports/SteelStockControl"));
const SupplierAgingReport = lazy(() => import("@/modules/reports/SupplierAgingReport"));
const ConsolidatedInvoices = lazy(() => import("@/modules/sales/ConsolidatedInvoices"));
const OrderBook = lazy(() => import("@/modules/orders/OrderBook"));
const OwnerPanel = lazy(() => import("@/modules/platform/OwnerPanel"));
const OpeningBalanceMigration = lazy(() => import("@/modules/platform/OpeningBalanceMigration"));
const TransportWorkspace = lazy(() => import("@/modules/transport/TransportWorkspace"));
const PreInvoiceWorkspace = lazy(() => import("@/modules/commercial/PreInvoiceWorkspace"));

function OwnerOnly({ children }: { children?: ReactNode }) {
  const { isPlatformOwner } = useAuth();
  if (!isPlatformOwner) return <Navigate to="/" replace />;
  return <>{children ?? <OwnerPanel />}</>;
}

function moduleLicensed(companyModules:string[]|undefined,module:ModuleKey){return !companyModules||companyModules.includes(module)}

function ModuleOnly({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { isPlatformOwner, activeCompany, activeBusinessUnit } = useAuth();
  const role = activeBusinessUnit?.membership_role ?? activeCompany?.membership_role;
  const permissions = activeBusinessUnit?.permissions ?? activeCompany?.permissions;
  const roleAllowed = canPerformModule(role, module, "view", permissions, isPlatformOwner);
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
      <Route path="/*" element={<ProtectedRoute><FeatureAccessProvider><><WorkspaceSwitchers /><FeaturePathGuard><Layout key={workspaceKey}><Suspense fallback={<div role="status" className="mx-auto max-w-5xl rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">Loading workspace…</div>}><Routes>
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
      <Route path="/sales/workflow" element={<ModuleOnly module="sales"><PreInvoiceWorkspace side="sales" /></ModuleOnly>} />
      <Route path="/sales/:id" element={<ModuleOnly module="sales"><SalesInvoiceDetail /></ModuleOnly>} />
      <Route path="/purchase/*" element={<ModuleOnly module="purchase"><Purchase /></ModuleOnly>} />
      <Route path="/godown/*" element={<ModuleOnly module="inventory"><Godown /></ModuleOnly>} />
      <Route path="/production/*" element={<BusinessTypeOnly type="steel"><ModuleOnly module="production"><Production /></ModuleOnly></BusinessTypeOnly>} />
      <Route path="/cutting/*" element={<BusinessTypeOnly type="steel"><ModuleOnly module="production"><Cutting /></ModuleOnly></BusinessTypeOnly>} />
      <Route path="/transport/*" element={<BusinessTypeOnly type="transport"><ModuleOnly module="transport"><TransportWorkspace /></ModuleOnly></BusinessTypeOnly>} />
      <Route path="/accounting/customer-invoice-statement" element={<ModuleOnly module="accounting"><ReportSurface><CustomerInvoiceStatement /></ReportSurface></ModuleOnly>} />
      <Route path="/accounting/*" element={<ModuleOnly module="accounting"><Accounting /></ModuleOnly>} />
      <Route path="/reports/steel-stock" element={<ModuleOnly module="reports"><ReportSurface><SteelStockControl /></ReportSurface></ModuleOnly>} />
      <Route path="/reports/supplier-aging" element={<ModuleOnly module="reports"><ReportSurface><SupplierAgingReport /></ReportSurface></ModuleOnly>} />
      <Route path="/reports/daily-stock-trading" element={<ReportSurface><Reports /></ReportSurface>} />
      <Route path="/reports/trading-margin" element={<ReportSurface><Reports /></ReportSurface>} />
      <Route path="/reports/*" element={<ModuleOnly module="reports"><ReportSurface><Reports /></ReportSurface></ModuleOnly>} />
      <Route path="/settings/*" element={<ModuleOnly module="settings"><Settings /></ModuleOnly>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></Suspense></Layout></FeaturePathGuard></></FeatureAccessProvider></ProtectedRoute>} />
  </Routes></>;
}
