export type FeatureAction = "view" | "create" | "edit" | "post" | "delete" | "print" | "export";

export type FeatureDefinition = {
  key: string;
  module: "dashboard" | "master" | "sales" | "purchase" | "inventory" | "production" | "transport" | "accounting" | "reports" | "settings";
  label: string;
  category: "core" | "master" | "transaction" | "book" | "statement" | "control" | "setup" | "report" | "settings";
  route: string;
  description?: string;
  actions: FeatureAction[];
  businessUnitTypes?: string[];
  defaultEnabled?: boolean;
  coreLocked?: boolean;
  sortOrder: number;
};

const operational: FeatureAction[] = ["view", "create", "edit", "post", "delete", "print", "export"];
const master: FeatureAction[] = ["view", "create", "edit", "delete", "print", "export"];
const report: FeatureAction[] = ["view", "print", "export"];
const setup: FeatureAction[] = ["view", "edit", "print", "export"];

export const FEATURE_REGISTRY: FeatureDefinition[] = [
  { key:"dashboard", module:"dashboard", label:"Dashboard", category:"core", route:"/", actions:["view","print","export"], defaultEnabled:true, coreLocked:true, sortOrder:10 },
  { key:"items", module:"master", label:"Items", category:"master", route:"/master-data", actions:master, sortOrder:100 },
  { key:"categories", module:"master", label:"Categories", category:"master", route:"/master-data/categories", actions:master, sortOrder:110 },
  { key:"customers", module:"master", label:"Customers", category:"master", route:"/master-data/customers", actions:master, sortOrder:120 },
  { key:"suppliers", module:"master", label:"Suppliers", category:"master", route:"/master-data/suppliers", actions:master, sortOrder:130 },
  { key:"employees", module:"master", label:"Employees", category:"master", route:"/master-data/employees", actions:master, sortOrder:140 },
  { key:"warehouses", module:"master", label:"Warehouses", category:"master", route:"/master-data/warehouses", actions:master, sortOrder:150 },
  { key:"godowns-master", module:"inventory", label:"Godowns", category:"master", route:"/godown/master", actions:master, sortOrder:160 },
  { key:"uom", module:"master", label:"Units of Measure", category:"master", route:"/master-data/uom", actions:master, sortOrder:170 },
  { key:"transporters", module:"master", label:"Transporters", category:"master", route:"/master-data/transporters", actions:master, sortOrder:180 },
  { key:"charges", module:"master", label:"Charge Master", category:"master", route:"/sales/charges", actions:master, sortOrder:190 },
  { key:"sales-invoices", module:"sales", label:"Sales Invoices", category:"transaction", route:"/sales", actions:operational, sortOrder:200 },
  { key:"sales-order-book", module:"sales", label:"Sales Order Book", category:"transaction", route:"/sales/order-book", actions:operational, sortOrder:210 },
  { key:"sales-consolidated", module:"sales", label:"Consolidated Sales Invoices", category:"transaction", route:"/sales/consolidated", actions:operational, businessUnitTypes:["steel"], sortOrder:220 },
  { key:"purchase-invoices", module:"purchase", label:"Purchase Invoices", category:"transaction", route:"/purchase", actions:operational, sortOrder:300 },
  { key:"purchase-consolidated", module:"purchase", label:"Consolidated Purchase", category:"transaction", route:"/purchase/consolidated", actions:operational, sortOrder:310 },
  { key:"purchase-order-book", module:"purchase", label:"Purchase Order Book", category:"transaction", route:"/purchase/order-book", actions:operational, sortOrder:320 },
  { key:"current-stock", module:"inventory", label:"Current Stock", category:"transaction", route:"/godown", actions:["view","print","export"], sortOrder:400 },
  { key:"stock-movements", module:"inventory", label:"Stock Movements", category:"transaction", route:"/godown/movements", actions:operational, sortOrder:410 },
  { key:"work-orders", module:"production", label:"Work Orders", category:"transaction", route:"/production", actions:operational, businessUnitTypes:["steel"], sortOrder:500 },
  { key:"furnace-yield", module:"production", label:"Furnace Yield", category:"transaction", route:"/production/yields", actions:operational, businessUnitTypes:["steel"], sortOrder:510 },
  { key:"cutting-orders", module:"production", label:"Cutting Orders", category:"transaction", route:"/cutting", actions:operational, businessUnitTypes:["steel"], sortOrder:520 },
  { key:"gate-pass", module:"production", label:"Gate Pass & Weighbridge", category:"transaction", route:"/cutting/gate-pass", actions:operational, businessUnitTypes:["steel"], sortOrder:530 },
  { key:"transport-workspace", module:"transport", label:"Transport Workspace", category:"transaction", route:"/transport", actions:operational, businessUnitTypes:["transport"], sortOrder:600 },
  { key:"journal", module:"accounting", label:"Journal Entries", category:"transaction", route:"/accounting", actions:operational, sortOrder:700 },
  { key:"cash-counter", module:"accounting", label:"Cash Counter", category:"transaction", route:"/accounting/cash-counter", actions:operational, sortOrder:710 },
  { key:"payment-reversals", module:"accounting", label:"Payment Reversals", category:"transaction", route:"/accounting/payment-reversals", actions:["view","post","print","export"], sortOrder:720 },
  { key:"returns", module:"accounting", label:"Credit / Debit Notes", category:"transaction", route:"/accounting/returns", actions:operational, sortOrder:730 },
  { key:"vat-register", module:"accounting", label:"VAT Register", category:"book", route:"/accounting/vat-register", actions:report, sortOrder:740 },
  { key:"day-book", module:"accounting", label:"Day Book", category:"book", route:"/accounting/day-book", actions:report, sortOrder:750 },
  { key:"ledgers", module:"accounting", label:"General Ledgers", category:"book", route:"/accounting/ledgers", actions:report, sortOrder:760 },
  { key:"payroll-ledger", module:"accounting", label:"Payroll & Salary Ledger", category:"book", route:"/accounting/payroll", actions:operational, sortOrder:770 },
  { key:"loan-ledger", module:"accounting", label:"Loan & Lender Ledger", category:"book", route:"/accounting/loans", actions:operational, sortOrder:780 },
  { key:"bank-recon", module:"accounting", label:"Bank Reconciliation", category:"book", route:"/accounting/bank-reconciliation", actions:operational, sortOrder:790 },
  { key:"trial-balance", module:"accounting", label:"Trial Balance", category:"statement", route:"/accounting/trial-balance", actions:report, sortOrder:800 },
  { key:"profit-loss", module:"accounting", label:"Profit & Loss", category:"statement", route:"/accounting/profit-loss", actions:report, sortOrder:810 },
  { key:"balance-sheet", module:"accounting", label:"Balance Sheet", category:"statement", route:"/accounting/balance-sheet", actions:report, sortOrder:820 },
  { key:"cash-flow", module:"accounting", label:"Cash Flow", category:"statement", route:"/accounting/cash-flow", actions:report, sortOrder:830 },
  { key:"period-closing", module:"accounting", label:"Period Closing", category:"control", route:"/accounting/periods", actions:["view","edit","post","print","export"], sortOrder:840 },
  { key:"year-closing", module:"accounting", label:"Year Closing", category:"control", route:"/accounting/year-closing", actions:["view","post","print","export"], sortOrder:850 },
  { key:"financial-controls", module:"accounting", label:"Financial Controls", category:"control", route:"/accounting/controls", actions:["view","edit","print","export"], sortOrder:860 },
  { key:"audit-trail", module:"accounting", label:"Audit Trail", category:"control", route:"/accounting/audit-trail", actions:report, sortOrder:870 },
  { key:"coa", module:"accounting", label:"Chart of Accounts", category:"setup", route:"/accounting/accounts", actions:master, sortOrder:880 },
  { key:"mapping", module:"accounting", label:"Account Mapping", category:"setup", route:"/accounting/mappings", actions:setup, sortOrder:890 },
  { key:"opening-balances", module:"accounting", label:"Opening Balances", category:"setup", route:"/accounting/opening-balances", actions:["view","create","edit","post","print","export"], sortOrder:900 },
  { key:"customer-statement", module:"accounting", label:"Customer Statement", category:"report", route:"/accounting/customer-invoice-statement", actions:report, sortOrder:910 },
  { key:"sales-margin-report", module:"reports", label:"Sales & Margin", category:"report", route:"/reports/sales-margin", actions:report, sortOrder:1000 },
  { key:"sales-register-report", module:"reports", label:"Sales Register", category:"report", route:"/reports/sales-register", actions:report, sortOrder:1010 },
  { key:"customer-aging-report", module:"reports", label:"Customer Aging", category:"report", route:"/reports/customer-aging", actions:report, sortOrder:1020 },
  { key:"customer-items-report", module:"reports", label:"Customer Item History", category:"report", route:"/reports/customer-item-history", actions:report, sortOrder:1030 },
  { key:"customer-profitability-report", module:"reports", label:"Customer Profitability", category:"report", route:"/reports/customer-profitability", actions:report, sortOrder:1040 },
  { key:"item-profitability-report", module:"reports", label:"Item Profitability", category:"report", route:"/reports/item-profitability", actions:report, sortOrder:1050 },
  { key:"salesperson-profitability-report", module:"reports", label:"Salesperson Profitability", category:"report", route:"/reports/salesperson-profitability", actions:report, sortOrder:1060 },
  { key:"customer-collections-report", module:"reports", label:"Customer Collections", category:"report", route:"/reports/customer-collections", actions:report, sortOrder:1070 },
  { key:"salesperson-report", module:"reports", label:"Salesperson Performance", category:"report", route:"/sales/report", actions:report, sortOrder:1080 },
  { key:"salesperson-ledger", module:"reports", label:"Salesperson Ledger", category:"report", route:"/sales/person-ledger", actions:report, sortOrder:1090 },
  { key:"purchase-register-report", module:"reports", label:"Purchase Register", category:"report", route:"/reports/purchase-register", actions:report, sortOrder:1100 },
  { key:"supplier-aging-report", module:"reports", label:"Supplier Aging", category:"report", route:"/reports/supplier-aging", actions:report, sortOrder:1110 },
  { key:"supplier-items-report", module:"reports", label:"Supplier Item History", category:"report", route:"/reports/supplier-item-history", actions:report, sortOrder:1120 },
  { key:"supplier-performance-report", module:"reports", label:"Supplier Performance", category:"report", route:"/reports/supplier-performance", actions:report, sortOrder:1130 },
  { key:"purchase-price-variance-report", module:"reports", label:"Purchase Price Variance", category:"report", route:"/reports/purchase-price-variance", actions:report, sortOrder:1140 },
  { key:"stock-valuation-report", module:"reports", label:"Stock Valuation", category:"report", route:"/reports/stock-valuation", actions:report, sortOrder:1150 },
  { key:"inventory-aging-report", module:"reports", label:"Inventory Aging", category:"report", route:"/reports/inventory-aging", actions:report, sortOrder:1160 },
  { key:"inventory-turnover-report", module:"reports", label:"Inventory Turnover", category:"report", route:"/reports/inventory-turnover", actions:report, sortOrder:1170 },
  { key:"stock-exceptions-report", module:"reports", label:"Stock Exceptions", category:"report", route:"/reports/stock-exceptions", actions:report, sortOrder:1180 },
  { key:"stock-aging", module:"reports", label:"Stock Aging", category:"report", route:"/godown/aging", actions:report, sortOrder:1190 },
  { key:"steel-stock", module:"reports", label:"Steel Stock Control", category:"report", route:"/reports/steel-stock", actions:report, businessUnitTypes:["steel"], sortOrder:1200 },
  { key:"business-unit-performance-report", module:"reports", label:"Business Unit Performance", category:"report", route:"/reports/business-unit-performance", actions:report, sortOrder:1210 },
  { key:"monthly-mis-report", module:"reports", label:"Monthly Business MIS", category:"report", route:"/reports/monthly-mis", actions:report, sortOrder:1220 },
  { key:"returns-register-report", module:"reports", label:"Returns Register", category:"report", route:"/reports/returns-register", actions:report, sortOrder:1230 },
  { key:"reconciliation-report", module:"reports", label:"AR / AP Reconciliation", category:"report", route:"/reports/ar-ap-reconciliation", actions:report, sortOrder:1240 },
  { key:"exceptions-report", module:"reports", label:"Exceptions", category:"report", route:"/reports/exceptions", actions:report, sortOrder:1250 },
  { key:"service-charges-report", module:"reports", label:"Service Charges", category:"report", route:"/reports/service-charges", actions:report, sortOrder:1260 },
  { key:"gate-pass-report", module:"reports", label:"Gate Pass Report", category:"report", route:"/reports/gate-pass", actions:report, sortOrder:1270 },
  { key:"company-settings", module:"settings", label:"Company Settings", category:"settings", route:"/settings", actions:setup, sortOrder:1300 },
  { key:"access-settings", module:"settings", label:"Users & Branches", category:"settings", route:"/settings/access", description:"Company user, role, permission and branch access management.", actions:["view","create","edit","delete"], sortOrder:1305 },
  { key:"approval-settings", module:"settings", label:"Approval Workflows", category:"settings", route:"/settings/approvals", description:"Maker-checker workflow, threshold and decision controls.", actions:["view","create","edit","delete","post"], sortOrder:1307 },
  { key:"tax-settings", module:"settings", label:"Tax Settings", category:"settings", route:"/settings/tax", actions:setup, sortOrder:1310 },
  { key:"document-settings", module:"settings", label:"Document & Print Settings", category:"settings", route:"/settings/documents", actions:setup, sortOrder:1320 },
  { key:"order-book-settings", module:"settings", label:"Order Book Settings", category:"settings", route:"/settings/order-book", actions:setup, sortOrder:1330 },
  { key:"gate-pass-settings", module:"settings", label:"Gate Pass & Weighbridge Settings", category:"settings", route:"/settings/gate-pass", actions:setup, sortOrder:1340 },
];

export const FEATURE_BY_KEY = new Map(FEATURE_REGISTRY.map((feature) => [feature.key, feature]));

export function featureCatalogPayload() {
  return FEATURE_REGISTRY.map((feature) => ({
    feature_key: feature.key,
    module_key: feature.module,
    label: feature.label,
    category: feature.category,
    route_pattern: feature.route,
    description: feature.description ?? null,
    supported_actions: feature.actions,
    business_unit_types: feature.businessUnitTypes ?? null,
    default_enabled: feature.defaultEnabled ?? true,
    core_locked: feature.coreLocked ?? false,
    sort_order: feature.sortOrder,
  }));
}

export function matchFeatureForPath(pathname: string) {
  const candidates = FEATURE_REGISTRY.filter((feature) => {
    if (feature.route === "/") return pathname === "/";
    return pathname === feature.route || pathname.startsWith(`${feature.route}/`);
  });
  return candidates.sort((a, b) => b.route.length - a.route.length)[0] ?? null;
}
