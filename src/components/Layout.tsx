import * as Lucide from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { useFeatureAccess } from "@/auth/FeatureAccess";
import { hasPermission, roleLabel, type ModuleKey, type PermissionMatrix } from "@/auth/permissions";
import { FEATURE_BY_KEY } from "@/config/featureRegistry";
import { usePlatformBranding } from "@/lib/platformBranding";
import UniversalDataTools from "@/components/UniversalDataTools";

type NavNode={key:string;label:string;to?:string;end?:boolean;module?:ModuleKey;ownerOnly?:boolean;accessAdminOnly?:boolean;steelOnly?:boolean;icon?:Lucide.LucideIcon;children?:NavNode[]};

const navigation:NavNode[]=[
  {key:"dashboard",to:"/",label:"Dashboard / ڈیش بورڈ",icon:Lucide.LayoutDashboard,end:true,module:"dashboard"},
  {key:"master",label:"Master Data / ماسٹر ڈیٹا",icon:Lucide.Database,module:"master",children:[
    {key:"items",to:"/master-data",label:"Items / آئٹمز",end:true,module:"master"},{key:"categories",to:"/master-data/categories",label:"Categories / کیٹیگریز",module:"master"},{key:"customers",to:"/master-data/customers",label:"Customers / گاہک",module:"master"},{key:"suppliers",to:"/master-data/suppliers",label:"Suppliers / سپلائرز",module:"master"},{key:"employees",to:"/master-data/employees",label:"Employees / ملازمین",module:"master"},{key:"warehouses",to:"/master-data/warehouses",label:"Warehouses / ویئرہاؤسز",module:"master"},{key:"godowns-master",to:"/godown/master",label:"Godowns / گودام",module:"inventory"},{key:"uom",to:"/master-data/uom",label:"Units of Measure / پیمائشی اکائیاں",module:"master"},{key:"transporters",to:"/master-data/transporters",label:"Transporters / ٹرانسپورٹرز",module:"master"},{key:"charges",to:"/sales/charges",label:"Charge Master / چارج ماسٹر",module:"master"},
  ]},
  {key:"sales",label:"Sales / سیلز",icon:Lucide.ShoppingCart,module:"sales",children:[{key:"sales-invoices",to:"/sales",label:"Sales Invoices / سیلز انوائسز",end:true,module:"sales"},{key:"sales-workflow",to:"/sales/workflow",label:"Quotation to Dispatch / کوٹیشن تا ڈسپیچ",module:"sales"},{key:"sales-order-book",to:"/sales/order-book",label:"Sales Order Book / سیلز آرڈر بک",module:"sales"},{key:"sales-consolidated",to:"/sales/consolidated",label:"Consolidated Invoices / مشترکہ انوائسز",module:"sales",steelOnly:true}]},
  {key:"purchase",label:"Purchase / خریداری",icon:Lucide.Truck,module:"purchase",children:[{key:"purchase-invoices",to:"/purchase",label:"Purchase Invoices / خریداری انوائسز",end:true,module:"purchase"},{key:"purchase-workflow",to:"/purchase/workflow",label:"Requisition to GRN / ریکوزیشن تا وصولی",module:"purchase"},{key:"purchase-consolidated",to:"/purchase/consolidated",label:"Consolidated Purchase / مشترکہ خریداری",module:"purchase"},{key:"purchase-order-book",to:"/purchase/order-book",label:"Purchase Order Book / پرچیز آرڈر بک",module:"purchase"}]},
  {key:"inventory",label:"Inventory / Stock / اسٹاک",icon:Lucide.Boxes,module:"inventory",children:[{key:"current-stock",to:"/godown",label:"Current Stock / موجودہ اسٹاک",end:true,module:"inventory"},{key:"stock-movements",to:"/godown/movements",label:"Stock Movements / اسٹاک موومنٹس",module:"inventory"}]},
  {key:"production",label:"Production / Furnace & Mill",icon:Lucide.Factory,module:"production",steelOnly:true,children:[{key:"work-orders",to:"/production",label:"Work Orders / ورک آرڈرز",end:true,module:"production",steelOnly:true},{key:"furnace-yield",to:"/production/yields",label:"Furnace Yield / فرنس پیداوار",module:"production",steelOnly:true}]},
  {key:"cutting",label:"Cutting & Loading / کٹنگ و لوڈنگ",icon:Lucide.Scissors,module:"production",steelOnly:true,children:[{key:"cutting-orders",to:"/cutting",label:"Cutting Orders / کٹنگ آرڈرز",end:true,module:"production",steelOnly:true},{key:"gate-pass",to:"/cutting/gate-pass",label:"Gate Pass & Weighbridge / گیٹ پاس و وزن کانٹا",module:"production",steelOnly:true}]},
  {key:"accounting",label:"Accounting / اکاؤنٹنگ",icon:Lucide.Calculator,module:"accounting",children:[
    {key:"accounting-transactions",label:"Transactions / لین دین",module:"accounting",children:[{key:"journal",to:"/accounting",label:"Journal Entries / جرنل اندراجات",end:true,module:"accounting"},{key:"cash-counter",to:"/accounting/cash-counter",label:"Cash Counter / کیش کاؤنٹر",module:"accounting"},{key:"payment-reversals",to:"/accounting/payment-reversals",label:"Payment Reversals / ادائیگی واپسی",module:"accounting"},{key:"returns",to:"/accounting/returns",label:"Credit / Debit Notes / ریٹرن نوٹس",module:"accounting"}]},
    {key:"accounting-books",label:"Books & Registers / بکس و رجسٹر",module:"accounting",children:[{key:"vat-register",to:"/accounting/vat-register",label:"VAT Register / وی اے ٹی رجسٹر",module:"accounting"},{key:"day-book",to:"/accounting/day-book",label:"Day Book / روزنامچہ",module:"accounting"},{key:"ledgers",to:"/accounting/ledgers",label:"General Ledgers / جنرل لیجر",module:"accounting"},{key:"payroll-ledger",to:"/accounting/payroll",label:"Payroll & Salary Ledger / تنخواہ لیجر",module:"accounting"},{key:"loan-ledger",to:"/accounting/loans",label:"Loan & Lender Ledger / قرض خواہ لیجر",module:"accounting"},{key:"bank-recon",to:"/accounting/bank-reconciliation",label:"Bank Reconciliation / بینک ریکنسیلی ایشن",module:"accounting"}]},
    {key:"financial-statements",label:"Financial Statements / مالی بیانات",module:"accounting",children:[{key:"trial-balance",to:"/accounting/trial-balance",label:"Trial Balance / ٹرائل بیلنس",module:"accounting"},{key:"profit-loss",to:"/accounting/profit-loss",label:"Profit & Loss / نفع و نقصان",module:"accounting"},{key:"balance-sheet",to:"/accounting/balance-sheet",label:"Balance Sheet / بیلنس شیٹ",module:"accounting"},{key:"cash-flow",to:"/accounting/cash-flow",label:"Cash Flow / کیش فلو",module:"accounting"}]},
    {key:"accounting-controls",label:"Controls & Closing / کنٹرول و کلوزنگ",module:"accounting",children:[{key:"period-closing",to:"/accounting/periods",label:"Period Closing / پیریڈ کلوزنگ",module:"accounting"},{key:"year-closing",to:"/accounting/year-closing",label:"Year Closing / سالانہ اختتام",module:"accounting"},{key:"financial-controls",to:"/accounting/controls",label:"Financial Controls / مالی کنٹرولز",module:"accounting"},{key:"audit-trail",to:"/accounting/audit-trail",label:"Audit Trail / آڈٹ ٹریل",module:"accounting"}]},
    {key:"accounting-setup",label:"Accounting Setup / اکاؤنٹنگ سیٹ اپ",module:"accounting",children:[{key:"coa",to:"/accounting/accounts",label:"Chart of Accounts / چارٹ آف اکاؤنٹس",module:"accounting"},{key:"mapping",to:"/accounting/mappings",label:"Account Mapping / اکاؤنٹ میپنگ",module:"accounting"},{key:"opening-balances",to:"/accounting/opening-balances",label:"Opening Balances / اوپننگ بیلنس",module:"accounting"}]},
  ]},
  {key:"reports",label:"Reports / رپورٹس",icon:Lucide.ChartNoAxesCombined,module:"reports",children:[
    {key:"sales-customer-reports",label:"Sales & Customer / سیلز و گاہک",module:"reports",children:[
      {key:"sales-margin-report",to:"/reports/sales-margin",label:"Sales & Margin / سیلز و مارجن",module:"reports"},{key:"sales-register-report",to:"/reports/sales-register",label:"Sales Register / سیلز رجسٹر",module:"reports"},{key:"customer-aging-report",to:"/reports/customer-aging",label:"Customer Aging / گاہک ایجنگ",module:"reports"},{key:"customer-items-report",to:"/reports/customer-item-history",label:"Customer Item History / گاہک آئٹم ہسٹری",module:"reports"},{key:"customer-profitability-report",to:"/reports/customer-profitability",label:"Customer Profitability / گاہک منافع",module:"reports"},{key:"item-profitability-report",to:"/reports/item-profitability",label:"Item Profitability / آئٹم منافع",module:"reports"},{key:"salesperson-profitability-report",to:"/reports/salesperson-profitability",label:"Salesperson Profitability / سیلز پرسن منافع",module:"reports"},{key:"customer-collections-report",to:"/reports/customer-collections",label:"Customer Collections / وصولیاں",module:"reports"},{key:"salesperson-report",to:"/sales/report",label:"Salesperson Performance / سیلز پرسن",module:"reports"},{key:"customer-statement",to:"/accounting/customer-invoice-statement",label:"Customer Statement / گاہک اسٹیٹمنٹ",module:"accounting"},
    ]},
    {key:"purchase-supplier-reports",label:"Purchase & Supplier / خریداری و سپلائر",module:"reports",children:[
      {key:"purchase-register-report",to:"/reports/purchase-register",label:"Purchase Register / پرچیز رجسٹر",module:"reports"},{key:"supplier-aging-report",to:"/reports/supplier-aging",label:"Supplier Aging / سپلائر ایجنگ",module:"reports"},{key:"supplier-items-report",to:"/reports/supplier-item-history",label:"Supplier Item History / سپلائر آئٹم ہسٹری",module:"reports"},{key:"supplier-performance-report",to:"/reports/supplier-performance",label:"Supplier Performance / سپلائر کارکردگی",module:"reports"},{key:"purchase-price-variance-report",to:"/reports/purchase-price-variance",label:"Purchase Price Variance / خریداری ریٹ فرق",module:"reports"},
    ]},
    {key:"inventory-reports",label:"Inventory / اسٹاک رپورٹس",module:"reports",children:[
      {key:"stock-valuation-report",to:"/reports/stock-valuation",label:"Stock Valuation / اسٹاک ویلیو",module:"reports"},{key:"inventory-aging-report",to:"/reports/inventory-aging",label:"Inventory Aging / Slow Moving",module:"reports"},{key:"inventory-turnover-report",to:"/reports/inventory-turnover",label:"Inventory Turnover / اسٹاک ٹرن اوور",module:"reports"},{key:"stock-exceptions-report",to:"/reports/stock-exceptions",label:"Stock Exceptions / اسٹاک ایکسیپشنز",module:"reports"},{key:"stock-aging",to:"/godown/aging",label:"Stock Aging / اسٹاک ایجنگ",module:"reports"},{key:"steel-stock",to:"/reports/steel-stock",label:"Steel Stock Control / اسٹیل اسٹاک کنٹرول",module:"reports",steelOnly:true},
    ]},
    {key:"management-reports",label:"Management & MIS / مینجمنٹ",module:"reports",children:[{key:"business-unit-performance-report",to:"/reports/business-unit-performance",label:"Business Unit Performance / بزنس یونٹ",module:"reports"},{key:"monthly-mis-report",to:"/reports/monthly-mis",label:"Monthly Business MIS / ماہانہ ایم آئی ایس",module:"reports"}]},
    {key:"control-reports",label:"Control & Reconciliation / کنٹرول رپورٹس",module:"reports",children:[{key:"returns-register-report",to:"/reports/returns-register",label:"Returns Register / ریٹرنز رجسٹر",module:"reports"},{key:"reconciliation-report",to:"/reports/ar-ap-reconciliation",label:"AR / AP Reconciliation / ریکنسیلی ایشن",module:"reports"},{key:"exceptions-report",to:"/reports/exceptions",label:"Exceptions / ایکسیپشنز",module:"reports"},{key:"service-charges-report",to:"/reports/service-charges",label:"Service Charges / سروس چارجز",module:"reports"}]},
    {key:"operations-reports",label:"Operations / آپریشن رپورٹس",module:"reports",children:[{key:"gate-pass-report",to:"/reports/gate-pass",label:"Gate Pass Report / گیٹ پاس رپورٹ",module:"reports"}]},
  ]},
  {key:"owner",to:"/owner",label:"Owner Control / مالک کنٹرول",icon:Lucide.ShieldCheck,ownerOnly:true},
  {key:"settings",label:"Settings / سیٹنگز",icon:Lucide.Settings,module:"settings",children:[
    {key:"company-settings",to:"/settings",label:"Company / کمپنی",end:true,module:"settings"},
    {key:"access-settings",to:"/settings/access",label:"Users & Branches / یوزرز اور برانچز",module:"settings",accessAdminOnly:true},
    {key:"approval-settings",to:"/settings/approvals",label:"Approval Workflows / منظوری کے مراحل",module:"settings",accessAdminOnly:true},
    {key:"tax-settings",to:"/settings/tax",label:"Tax Settings / ٹیکس سیٹنگز",module:"settings"},
    {key:"document-settings",to:"/settings/documents",label:"Document & Print / ڈاکومنٹ و پرنٹ",module:"settings"},
    {key:"order-book-settings",to:"/settings/order-book",label:"Order Book Settings / آرڈر بک سیٹنگز",module:"settings"},
    {key:"gate-pass-settings",to:"/settings/gate-pass",label:"Gate Pass & Weighbridge / گیٹ پاس و کانٹا",module:"settings"},
  ]},
];

function matches(n:NavNode,p:string):boolean{return Boolean(n.to&&(p===n.to||(!n.end&&n.to!=="/"&&p.startsWith(n.to+"/"))))||Boolean(n.children?.some(c=>matches(c,p)))}
function filterNode(n:NavNode,role:string|undefined,owner:boolean,mods:string[],unitType:string|undefined,permissions:PermissionMatrix|undefined,isFeatureEnabled:(key:string)=>boolean):NavNode|null{
  if(n.ownerOnly&&!owner)return null;
  if(n.accessAdminOnly&&!owner&&role!=="company_owner"&&role!=="admin")return null;
  if(n.steelOnly&&unitType&&unitType!=="steel")return null;
  if(n.module&&(!mods.includes(n.module)||!hasPermission(role as never,n.module,"view",permissions,owner)))return null;
  if(n.to&&FEATURE_BY_KEY.has(n.key)&&!isFeatureEnabled(n.key))return null;
  const children=n.children?.map(c=>filterNode(c,role,owner,mods,unitType,permissions,isFeatureEnabled)).filter(Boolean) as NavNode[]|undefined;
  if(n.children&&!children?.length&&!n.to)return null;
  return{...n,children};
}
function flatten(nodes:NavNode[]):NavNode[]{return nodes.flatMap(n=>[n,...(n.children?flatten(n.children):[])])}
function title(pathname:string){const candidates=flatten(navigation).filter(n=>n.to&&(pathname===n.to||(!n.end&&n.to!=="/"&&pathname.startsWith(`${n.to}/`))));return candidates.sort((a,b)=>(b.to?.length??0)-(a.to?.length??0))[0]?.label??"ERP";}

export default function Layout({children}:{children:ReactNode}){
  const{user,signOut,isPlatformOwner,activeCompany,activeBusinessUnit}=useAuth();
  const{isFeatureEnabled}=useFeatureAccess();
  const{branding}=usePlatformBranding();
  const location=useLocation(),navigate=useNavigate();
  const role=activeBusinessUnit?.membership_role??activeCompany?.membership_role;
  const permissions=(activeBusinessUnit?.permissions??activeCompany?.permissions) as PermissionMatrix|undefined;
  const mods=activeBusinessUnit?.enabled_modules??[];
  const[collapsed,setCollapsed]=useState(false),[mobileOpen,setMobileOpen]=useState(false),[open,setOpen]=useState<Record<string,boolean>>({});
  const visible=useMemo(()=>navigation.map(n=>filterNode(n,role,isPlatformOwner,mods,activeBusinessUnit?.business_unit_type,permissions,(key)=>isFeatureEnabled(key,"view"))).filter(Boolean) as NavNode[],[role,isPlatformOwner,mods,activeBusinessUnit?.business_unit_type,permissions,isFeatureEnabled]);
  const pageTitle=title(location.pathname);
  const showSidebarBrand=branding.show_branding&&branding.show_in_sidebar;
  useEffect(()=>{document.title=branding.show_branding&&branding.erp_name?`${pageTitle} · ${branding.erp_name}`:pageTitle},[pageTitle,branding.show_branding,branding.erp_name]);
  const render=(n:NavNode,d=0):ReactNode=>{
    const active=matches(n,location.pathname),has=Boolean(n.children?.length),expanded=open[n.key]??active,Icon=n.icon;
    if(has)return <div key={n.key}><button type="button" onClick={()=>setOpen(v=>({...v,[n.key]:!expanded}))} className={`flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-2 text-left ${d===0?"text-[13px] font-bold":"text-[12.5px] font-semibold"} ${active?"bg-white/[0.09] text-white":"text-slate-400 hover:bg-white/5 hover:text-slate-100"}`}>{Icon&&<Icon className="h-4 w-4"/>}<span className="min-w-0 flex-1 truncate">{n.label}</span><Lucide.ChevronDown className={`h-3.5 w-3.5 ${expanded?"rotate-180":""}`}/></button>{expanded&&!collapsed&&<div className={`${d===0?"ml-4":"ml-3"} mt-1 border-l border-white/10 pl-2`}>{n.children?.map(c=>render(c,d+1))}</div>}</div>;
    if(!n.to)return null;
    return <NavLink key={n.key} to={n.to} end={n.end} onClick={()=>setMobileOpen(false)} className={({isActive})=>`flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] font-semibold ${isActive?"bg-blue-600 text-white":"text-slate-400 hover:bg-white/5 hover:text-slate-100"}`}>{Icon&&<Icon className="h-4 w-4"/>}{!collapsed&&<span className="truncate">{n.label}</span>}</NavLink>;
  };
  const side=collapsed?"lg:w-[68px]":"lg:w-[252px]",offset=collapsed?"lg:ml-[68px]":"lg:ml-[252px]";
  return <div className="erp-shell min-h-screen bg-[#f6f7f9] text-slate-900">
    {mobileOpen&&<button onClick={()=>setMobileOpen(false)} className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"/>}
    <aside className={`fixed inset-y-0 left-0 z-50 flex w-[252px] flex-col border-r border-[#1e293b] bg-[#0f1726] text-slate-300 transition-all ${side} ${mobileOpen?"translate-x-0":"-translate-x-full lg:translate-x-0"}`}>
      <div className="flex h-16 items-center border-b border-white/10 px-3">{showSidebarBrand&&branding.logo_url?<img src={branding.logo_url} alt={branding.erp_name||"ERP"} className="h-11 w-11 rounded-xl object-contain"/>:<div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.05]"><Lucide.LayoutGrid className="h-5 w-5 text-slate-500"/></div>}{!collapsed&&<div className="ml-2 min-w-0">{showSidebarBrand&&branding.erp_name?<><div className="truncate text-[14px] font-black text-white">{branding.erp_name}</div>{branding.show_tagline&&branding.tagline&&<div className="truncate text-[11px] text-slate-500">{branding.tagline}</div>}</>:<div className="text-[13px] font-bold text-slate-400">ERP Workspace</div>}</div>}</div>
      <nav className="flex-1 overflow-y-auto px-2 py-3"><div className="space-y-1">{visible.map(n=>render(n))}</div></nav>
      <div className="border-t border-white/10 p-2">{!collapsed&&<div className="mb-2 rounded-md bg-white/[0.03] px-2 py-2"><div className="text-[11px] uppercase text-slate-600">Active Company</div><div className="truncate text-[12px] font-bold text-slate-300">{location.pathname.startsWith("/owner")?"Owner Workspace":activeCompany?.company_name??"No company"}</div><div className="text-[11px] text-slate-500">{user?.email??"Signed in"} · {isPlatformOwner?"Platform Owner":roleLabel(role)}</div></div>}<button onClick={async()=>{await signOut();navigate("/login")}} className="flex h-9 w-full items-center justify-center gap-2 text-[12px] text-slate-500"><Lucide.LogOut className="h-4 w-4"/>{!collapsed&&"Sign out / لاگ آؤٹ"}</button></div>
    </aside>
    <div className={`min-h-screen transition-all ${offset}`}>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95"><div className="flex min-h-16 items-center gap-3 px-4 py-2 lg:px-5"><button onClick={()=>setMobileOpen(true)} className="lg:hidden"><Lucide.Menu/></button><button onClick={()=>setCollapsed(v=>!v)} className="hidden h-9 w-9 items-center justify-center rounded-md border lg:flex"><Lucide.PanelLeftClose className={`h-4 w-4 ${collapsed?"rotate-180":""}`}/></button>{location.pathname!=="/"&&<button onClick={()=>navigate(-1)} className="hidden h-9 items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-3 text-[13px] font-black text-blue-800 sm:inline-flex"><Lucide.ArrowLeft className="h-4 w-4"/>Back / واپس</button>}<div className="min-w-0 flex-1"><div className="truncate text-[16px] font-black text-slate-950">{pageTitle}</div></div><UniversalDataTools/><div className="hidden text-right lg:block"><div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{location.pathname.startsWith("/owner")?"Platform Workspace":"Active Company / فعال کمپنی"}</div><div className="max-w-[220px] truncate text-[12px] font-black text-slate-800">{location.pathname.startsWith("/owner")?(branding.show_branding&&branding.erp_name?`${branding.erp_name} Platform`:"Owner Platform"):activeCompany?.company_name??"No company selected"}</div></div></div></header>
      <main id="navilo-main-content" className="px-3 py-4 sm:px-4 lg:px-5">{children}</main>
    </div>
  </div>;
}
