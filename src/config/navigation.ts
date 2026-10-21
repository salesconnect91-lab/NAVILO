import * as Lucide from "lucide-react";
import { hasPermission, type ModuleKey, type PermissionMatrix } from "@/auth/permissions";
import { FEATURE_BY_KEY } from "./featureRegistry";
export type NavNode={key:string;label:string;to?:string;end?:boolean;module?:ModuleKey;requiresModule?:ModuleKey;businessType?:string;ownerOnly?:boolean;accessAdminOnly?:boolean;steelOnly?:boolean;icon?:Lucide.LucideIcon;children?:NavNode[]};

export const navigation:NavNode[]=[
  {key:"dashboard",to:"/",label:"Dashboard / ڈیش بورڈ",icon:Lucide.LayoutDashboard,end:true,module:"dashboard"},
  {key:"master",label:"Master Data / ماسٹر ڈیٹا",icon:Lucide.Database,module:"master",children:[
    {key:"items",to:"/master-data",label:"Items / آئٹمز",end:true,module:"master",requiresModule:"inventory"},{key:"categories",to:"/master-data/categories",label:"Categories / کیٹیگریز",module:"master",requiresModule:"inventory"},{key:"customers",to:"/master-data/customers",label:"Customers / گاہک",module:"master"},{key:"suppliers",to:"/master-data/suppliers",label:"Suppliers / سپلائرز",module:"master"},{key:"employees",to:"/master-data/employees",label:"Employees / ملازمین",module:"master"},{key:"warehouses",to:"/master-data/warehouses",label:"Warehouses / ویئرہاؤسز",module:"master",requiresModule:"inventory"},{key:"godowns-master",to:"/godown/master",label:"Godowns / گودام",module:"inventory"},{key:"uom",to:"/master-data/uom",label:"Units of Measure / پیمائشی اکائیاں",module:"master",requiresModule:"inventory"},{key:"transporters",to:"/master-data/transporters",label:"Transporters / ٹرانسپورٹرز",module:"master",requiresModule:"transport",businessType:"transport"},{key:"transport-vehicles",to:"/master-data/vehicles",label:"Vehicles / گاڑیاں",module:"master",requiresModule:"transport",businessType:"transport"},{key:"transport-drivers",to:"/master-data/drivers",label:"Drivers / ڈرائیورز",module:"master",requiresModule:"transport",businessType:"transport"},{key:"transport-truck-types",to:"/master-data/truck-types",label:"Truck Types",module:"master",requiresModule:"transport",businessType:"transport"},{key:"transport-locations",to:"/master-data/transport-locations",label:"Transport Locations",module:"master",requiresModule:"transport",businessType:"transport"},{key:"transport-ownership",to:"/master-data/vehicle-ownership",label:"Vehicle Ownership",module:"master",requiresModule:"transport",businessType:"transport"},{key:"charges",to:"/sales/charges",label:"Charge Master / چارج ماسٹر",module:"master",requiresModule:"sales"},
  ]},
  {key:"sales",label:"Sales / سیلز",icon:Lucide.ShoppingCart,module:"sales",children:[{key:"sales-invoice-group",label:"Invoices / انوائسز",module:"sales",children:[{key:"sales-invoices",to:"/sales",label:"Sales Invoices / سیلز انوائسز",end:true,module:"sales"},{key:"transport-normal-sales-create",to:"/sales/new?type=normal",label:"Create Normal Sale Invoice",end:true,module:"sales",businessType:"transport"},{key:"sales-consolidated",to:"/sales/consolidated",label:"Consolidated Invoices / مشترکہ انوائسز",module:"sales",steelOnly:true}]},{key:"sales-workflow",to:"/sales/workflow",label:"Quotation to Dispatch / کوٹیشن تا ڈسپیچ",module:"sales"},{key:"sales-order-book",to:"/sales/order-book",label:"Sales Order Book / سیلز آرڈر بک",module:"sales"}]},
  {key:"purchase",label:"Purchase / خریداری",icon:Lucide.Truck,module:"purchase",children:[{key:"purchase-invoice-group",label:"Invoices / انوائسز",module:"purchase",children:[{key:"purchase-invoices",to:"/purchase",label:"Purchase Invoices / خریداری انوائسز",end:true,module:"purchase"},{key:"transport-normal-purchase-create",to:"/purchase/normal/new",label:"Create Normal Purchase Invoice",end:true,module:"purchase",businessType:"transport"},{key:"purchase-consolidated",to:"/purchase/consolidated",label:"Consolidated Purchase / مشترکہ خریداری",module:"purchase"}]},{key:"purchase-workflow",to:"/purchase/workflow",label:"Requisition to GRN / ریکوزیشن تا وصولی",module:"purchase"},{key:"purchase-order-book",to:"/purchase/order-book",label:"Purchase Order Book / پرچیز آرڈر بک",module:"purchase"}]},
  {key:"inventory",label:"Inventory / Stock / اسٹاک",icon:Lucide.Boxes,module:"inventory",children:[{key:"current-stock",to:"/godown",label:"Current Stock / موجودہ اسٹاک",end:true,module:"inventory"},{key:"stock-movements",to:"/godown/movements",label:"Stock Movements / اسٹاک موومنٹس",module:"inventory"},{key:"inventory-advanced",to:"/godown/advanced",label:"Advanced Controls / ایڈوانس کنٹرول",module:"inventory"}]},
  {key:"production",label:"Production / Furnace & Mill",icon:Lucide.Factory,module:"production",steelOnly:true,children:[{key:"work-orders",to:"/production",label:"Work Orders / ورک آرڈرز",end:true,module:"production",steelOnly:true},{key:"manufacturing-core",to:"/production/core",label:"Manufacturing Core / مینوفیکچرنگ",module:"production",steelOnly:true},{key:"furnace-yield",to:"/production/yields",label:"Furnace Yield / فرنس پیداوار",module:"production",steelOnly:true}]},
  {key:"cutting",label:"Cutting & Loading / کٹنگ و لوڈنگ",icon:Lucide.Scissors,module:"production",steelOnly:true,children:[{key:"cutting-orders",to:"/cutting",label:"Cutting Orders / کٹنگ آرڈرز",end:true,module:"production",steelOnly:true},{key:"gate-pass",to:"/cutting/gate-pass",label:"Gate Pass & Weighbridge / گیٹ پاس و وزن کانٹا",module:"production",steelOnly:true}]},
  {key:"transport",label:"Transport",icon:Lucide.Truck,module:"transport",businessType:"transport",children:[
    {key:"transport-trips-register",to:"/transport?view=trips",label:"Trips",module:"transport"},
    {key:"transport-mobile-quick-entry",to:"/transport/mobile",label:"Mobile Quick Entry",module:"transport"},
    {key:"transport-audit",to:"/transport?view=audit",label:"Trip Audit",module:"transport"},
    {key:"transport-party-reports",label:"Reports & Allocation",module:"transport",children:[
      {key:"transport-customer-reports",to:"/transport?panel=customer-reports",label:"Customer Reports",module:"transport"},
      {key:"transport-supplier-reports",to:"/transport?panel=supplier-reports",label:"Supplier Reports",module:"transport"},
      {key:"transport-allocation",to:"/transport?panel=bulk-allocation",label:"Bulk Allocation",module:"transport"},
      {key:"transport-vehicle-ledger",to:"/transport?panel=vehicle-reports",label:"Vehicle Ledger & P&L",module:"transport"},
      {key:"transport-trip-reports",to:"/reports/transport?mode=trips",label:"Trip-wise Reports",module:"reports",requiresModule:"transport"},
      {key:"transport-profitability-reporting",to:"/reports/transport?mode=profit",label:"Posted Trip Profitability",module:"reports",requiresModule:"transport"}
    ]}
  ]},
  {key:"accounting",label:"Accounting / اکاؤنٹنگ",icon:Lucide.Calculator,module:"accounting",children:[
    {key:"accounting-transactions",label:"Transactions / لین دین",module:"accounting",children:[{key:"journal",to:"/accounting",label:"Journal Entries / جرنل اندراجات",end:true,module:"accounting"},{key:"cash-counter",to:"/accounting/cash-counter",label:"Cash Counter / کیش کاؤنٹر",module:"accounting"},{key:"payment-reversals",to:"/accounting/payment-reversals",label:"Payment Reversals / ادائیگی واپسی",module:"accounting"},{key:"returns",to:"/accounting/returns",label:"Credit / Debit Notes / ریٹرن نوٹس",module:"accounting"}]},
    {key:"accounting-books",label:"Books & Registers / بکس و رجسٹر",module:"accounting",children:[{key:"vat-register",to:"/accounting/vat-register",label:"VAT Register / وی اے ٹی رجسٹر",module:"accounting"},{key:"day-book",to:"/accounting/day-book",label:"Day Book / روزنامچہ",module:"accounting"},{key:"ledgers",to:"/accounting/ledgers",label:"General Ledgers / جنرل لیجر",module:"accounting"},{key:"payroll-ledger",to:"/accounting/payroll",label:"Payroll & Salary Ledger / تنخواہ لیجر",module:"accounting"},{key:"loan-ledger",to:"/accounting/loans",label:"Loan & Lender Ledger / قرض خواہ لیجر",module:"accounting"},{key:"bank-recon",to:"/accounting/bank-reconciliation",label:"Bank Reconciliation / بینک ریکنسیلی ایشن",module:"accounting"}]},
    {key:"financial-statements",label:"Financial Statements / مالی بیانات",module:"accounting",children:[{key:"trial-balance",to:"/accounting/trial-balance",label:"Trial Balance / ٹرائل بیلنس",module:"accounting"},{key:"profit-loss",to:"/accounting/profit-loss",label:"Profit & Loss / نفع و نقصان",module:"accounting"},{key:"balance-sheet",to:"/accounting/balance-sheet",label:"Balance Sheet / بیلنس شیٹ",module:"accounting"},{key:"cash-flow",to:"/accounting/cash-flow",label:"Cash Flow / کیش فلو",module:"accounting"},{key:"daily-cash-closing",to:"/accounting/daily-closing",label:"Daily Cash & Bank Closing",module:"accounting"}]},
    {key:"accounting-controls",label:"Controls & Closing / کنٹرول و کلوزنگ",module:"accounting",children:[{key:"period-closing",to:"/accounting/periods",label:"Period Closing / پیریڈ کلوزنگ",module:"accounting"},{key:"year-closing",to:"/accounting/year-closing",label:"Year Closing / سالانہ اختتام",module:"accounting"},{key:"financial-controls",to:"/accounting/controls",label:"Financial Controls / مالی کنٹرولز",module:"accounting"},{key:"audit-trail",to:"/accounting/audit-trail",label:"Audit Trail / آڈٹ ٹریل",module:"accounting"}]},
    {key:"accounting-setup",label:"Accounting Setup / اکاؤنٹنگ سیٹ اپ",module:"accounting",children:[{key:"coa",to:"/accounting/accounts",label:"Chart of Accounts / چارٹ آف اکاؤنٹس",module:"accounting"},{key:"mapping",to:"/accounting/mappings",label:"Account Mapping / اکاؤنٹ میپنگ",module:"accounting"},{key:"opening-balances",to:"/accounting/opening-balances",label:"Opening Balances / اوپننگ بیلنس",module:"accounting"}]},
  ]},
  {key:"reports",label:"Reports / رپورٹس",icon:Lucide.ChartNoAxesCombined,module:"reports",children:[
    {key:"sales-customer-reports",label:"Sales & Customer / سیلز و گاہک",module:"reports",requiresModule:"sales",children:[
      {key:"sales-margin-report",to:"/reports/sales-margin",label:"Sales & Margin / سیلز و مارجن",module:"reports"},{key:"sales-register-report",to:"/reports/sales-register",label:"Sales Register / سیلز رجسٹر",module:"reports"},{key:"customer-aging-report",to:"/reports/customer-aging",label:"Customer Aging / گاہک ایجنگ",module:"reports"},{key:"customer-items-report",to:"/reports/customer-item-history",label:"Customer Item History / گاہک آئٹم ہسٹری",module:"reports"},{key:"customer-profitability-report",to:"/reports/customer-profitability",label:"Customer Profitability / گاہک منافع",module:"reports"},{key:"item-profitability-report",to:"/reports/item-profitability",label:"Item Profitability / آئٹم منافع",module:"reports"},{key:"salesperson-profitability-report",to:"/reports/salesperson-profitability",label:"Salesperson Profitability / سیلز پرسن منافع",module:"reports"},{key:"customer-collections-report",to:"/reports/customer-collections",label:"Customer Collections / وصولیاں",module:"reports"},{key:"salesperson-report",to:"/sales/report",label:"Salesperson Performance / سیلز پرسن",module:"reports"},{key:"customer-statement",to:"/accounting/customer-invoice-statement",label:"Customer Statement / گاہک اسٹیٹمنٹ",module:"accounting"},
    ]},
    {key:"purchase-supplier-reports",label:"Purchase & Supplier / خریداری و سپلائر",module:"reports",requiresModule:"purchase",children:[
      {key:"purchase-register-report",to:"/reports/purchase-register",label:"Purchase Register / پرچیز رجسٹر",module:"reports"},{key:"supplier-aging-report",to:"/reports/supplier-aging",label:"Supplier Aging / سپلائر ایجنگ",module:"reports"},{key:"supplier-items-report",to:"/reports/supplier-item-history",label:"Supplier Item History / سپلائر آئٹم ہسٹری",module:"reports"},{key:"supplier-performance-report",to:"/reports/supplier-performance",label:"Supplier Performance / سپلائر کارکردگی",module:"reports"},{key:"purchase-price-variance-report",to:"/reports/purchase-price-variance",label:"Purchase Price Variance / خریداری ریٹ فرق",module:"reports"},
    ]},
    {key:"inventory-reports",label:"Inventory / اسٹاک رپورٹس",module:"reports",requiresModule:"inventory",children:[
      {key:"stock-valuation-report",to:"/reports/stock-valuation",label:"Stock Valuation / اسٹاک ویلیو",module:"reports"},{key:"daily-stock-trading-report",to:"/reports/daily-stock-trading",label:"Daily Stock & Trading Summary / روزانہ اسٹاک",module:"reports"},{key:"trading-margin-report",to:"/reports/trading-margin",label:"Purchase vs Sales Rate & Margin / خرید و فروخت مارجن",module:"reports"},{key:"inventory-aging-report",to:"/reports/inventory-aging",label:"Inventory Aging / Slow Moving",module:"reports"},{key:"inventory-turnover-report",to:"/reports/inventory-turnover",label:"Inventory Turnover / اسٹاک ٹرن اوور",module:"reports"},{key:"stock-exceptions-report",to:"/reports/stock-exceptions",label:"Stock Exceptions / اسٹاک ایکسیپشنز",module:"reports"},{key:"steel-stock",to:"/reports/steel-stock",label:"Stock Control / اسٹاک کنٹرول",module:"reports"},
    ]},
    {key:"management-reports",label:"Management & MIS / مینجمنٹ",module:"reports",children:[{key:"business-unit-performance-report",to:"/reports/business-unit-performance",label:"Business Unit Performance / بزنس یونٹ",module:"reports"},{key:"monthly-mis-report",to:"/reports/monthly-mis",label:"Monthly Business MIS / ماہانہ ایم آئی ایس",module:"reports"}]},
    {key:"control-reports",label:"Control & Reconciliation / کنٹرول رپورٹس",module:"reports",requiresModule:"accounting",children:[{key:"returns-register-report",to:"/reports/returns-register",label:"Returns Register / ریٹرنز رجسٹر",module:"reports"},{key:"reconciliation-report",to:"/reports/ar-ap-reconciliation",label:"AR / AP Reconciliation / ریکنسیلی ایشن",module:"reports"},{key:"exceptions-report",to:"/reports/exceptions",label:"Exceptions / ایکسیپشنز",module:"reports"},{key:"service-charges-report",to:"/reports/service-charges",label:"Service Charges / سروس چارجز",module:"reports"}]},
    {key:"operations-reports",label:"Operations / آپریشن رپورٹس",module:"reports",requiresModule:"production",children:[{key:"gate-pass-report",to:"/reports/gate-pass",label:"Gate Pass Report / گیٹ پاس رپورٹ",module:"reports"}]},
  ]},
  {key:"owner",to:"/owner",label:"Owner Control / مالک کنٹرول",icon:Lucide.ShieldCheck,ownerOnly:true},
  {key:"settings",label:"Settings / سیٹنگز",icon:Lucide.Settings,module:"settings",children:[
    {key:"company-settings",to:"/settings",label:"Company / کمپنی",end:true,module:"settings"},
    {key:"import-center",to:"/settings/imports",label:"Import Center / امپورٹ سینٹر",module:"settings"},
    {key:"transport-profit-distribution",to:"/settings/profit-distribution",label:"Profit Closing Guide",module:"settings",requiresModule:"transport",businessType:"transport",accessAdminOnly:true},
    {key:"access-settings",to:"/settings/access",label:"Users & Branches / یوزرز اور برانچز",module:"settings",accessAdminOnly:true},
    {key:"licence-settings",to:"/settings/licence",label:"Licence & Billing / لائسنس",module:"settings",accessAdminOnly:true},
    {key:"approval-settings",to:"/settings/approvals",label:"Approval Workflows / منظوری کے مراحل",module:"settings",accessAdminOnly:true},
    {key:"tax-settings",to:"/settings/tax",label:"Tax Settings / ٹیکس سیٹنگز",module:"settings"},
    {key:"document-settings",to:"/settings/documents",label:"Document & Print / ڈاکومنٹ و پرنٹ",module:"settings"},
    {key:"order-book-settings",to:"/settings/order-book",label:"Order Book Settings / آرڈر بک سیٹنگز",module:"settings"},
    {key:"gate-pass-settings",to:"/settings/gate-pass",label:"Gate Pass & Weighbridge / گیٹ پاس و کانٹا",module:"settings"},
  ]},
];

export function shellLabel(label:string):string{
  // Keep English as the canonical shell source. GlobalLanguageRuntime translates
  // this source into the exact selected single/bilingual language set.
  return label.replace(/\s\/\s(?=[\u0600-\u06FF]).*$/u,"").trim();
}
export function matches(n:NavNode,path:string):boolean {
  const question=path.indexOf('?'),pathname=question>=0?path.slice(0,question):path,search=question>=0?path.slice(question+1):'';
  let active=false;
  if(n.to){
    const targetQuestion=n.to.indexOf('?'),targetPath=targetQuestion>=0?n.to.slice(0,targetQuestion):n.to,targetSearch=targetQuestion>=0?n.to.slice(targetQuestion+1):'';
    const pathMatch=pathname===targetPath||(!n.end&&targetPath!=='/'&&pathname.startsWith(targetPath+'/'));
    if(pathMatch&&targetSearch){
      const target=new URLSearchParams(targetSearch),current=new URLSearchParams(search);
      active=[...target.entries()].every(([key,value])=>current.get(key)===value);
    }else active=pathMatch;
  }
  return active||Boolean(n.children?.some(child=>matches(child,path)));
}
export function filterNode(n:NavNode,role:string|undefined,owner:boolean,mods:string[],unitType:string|undefined,permissions:PermissionMatrix|undefined,isFeatureEnabled:(key:string)=>boolean):NavNode|null{
  if(unitType === "transport" && (n.key === "sales-consolidated" || n.key === "purchase-consolidated"))return null;
  if(n.key === "transporters" && unitType === "transport" && mods.includes("transport"))return null;
  if(n.ownerOnly&&!owner)return null;
  if(n.accessAdminOnly&&!owner&&role!=="company_owner"&&role!=="admin")return null;
  if(n.steelOnly&&unitType&&unitType!=="steel")return null;
  if(n.businessType&&unitType&&unitType!==n.businessType)return null;
  if(n.requiresModule&&!mods.includes(n.requiresModule))return null;
  if(n.module&&(!mods.includes(n.module)||!hasPermission(role as never,n.module,"view",permissions,owner)))return null;
  if(n.to&&FEATURE_BY_KEY.has(n.key)&&!isFeatureEnabled(n.key))return null;
  const children=n.children?.map(c=>filterNode(c,role,owner,mods,unitType,permissions,isFeatureEnabled)).filter(Boolean) as NavNode[]|undefined;
  if(n.children&&!children?.length&&!n.to)return null;
  return{...n,children};
}
export function flatten(nodes:NavNode[]):NavNode[]{return nodes.flatMap(n=>[n,...(n.children?flatten(n.children):[])])}
export function title(pathname:string){
  if(pathname==="/transport/mobile")return"Transport Mobile";
  if(pathname==="/transport")return"Transport";
  if(pathname==="/sales/new")return"New Sales Invoice";
  if(/^\/sales\/[^/]+\/edit$/.test(pathname))return"Edit Sales Invoice";
  if(/^\/sales\/[^/]+$/.test(pathname)&&!["/sales/report","/sales/charges","/sales/consolidated","/sales/order-book","/sales/workflow"].includes(pathname))return"Sales Invoice";
  if(pathname==="/purchase/trip-service/new")return"Trip Service Purchase Invoice";
  if(pathname==="/purchase/normal/new")return"Normal Purchase Invoice";
  if(pathname==="/purchase/new")return"New Purchase Invoice";
  if(/^\/purchase\/[^/]+\/edit$/.test(pathname))return"Edit Purchase Invoice";
  const candidates=flatten(navigation).filter(n=>n.to&&(pathname===n.to||(!n.end&&n.to!=="/"&&pathname.startsWith(`${n.to}/`))));return shellLabel(candidates.sort((a,b)=>(b.to?.length??0)-(a.to?.length??0))[0]?.label??"ERP");
}
