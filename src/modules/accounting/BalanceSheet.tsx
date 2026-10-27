import ConfigurableReport from '../transport/ConfigurableReport';
import { Link } from "react-router-dom";
import NaviloDateInput from '@/components/NaviloDateInput';
import AccountingReportScopeSelect,{type AccountingReportScope} from './AccountingReportScopeSelect';
import {salarySheetPosition} from '@/lib/salaryBalanceSheet';
import {compareBalanceSheetPresentation} from '@/lib/balanceSheetPresentation';
import {classifiedBalanceSheetRows, classifiedBalanceSheetExport, coaBalanceSheetGroup, type BalanceSheetView} from '@/lib/balanceSheetLayouts';
import SearchableSelect from '@/components/SearchableSelect';
﻿import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  loadDocumentPrintSettings,
  documentContactText,
  documentTaxText,
} from "@/lib/documentPrintSettings";
import { ErrorBanner, formatCurrency } from "@/components/ui";
import { fetchAllPages, fetchByIdChunks } from "@/lib/fetchAllPages";

interface BSItem {
  name: string;
  amount: number;
  accountIds?: string[];
  parentHead?: string;
  detailType?: string;
}

interface BSSection {
  total: number;
  items: BSItem[];
}

interface BSGroup {
  head: string;
  total: number;
  items: BSItem[];
}

function getLocalToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatReportDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function normalizedDetailType(value?: string) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function balanceSheetAccountName(type: string, accountName: string, detailType?: string) {
  const detail = normalizedDetailType(detailType);
  if (type === "asset" && detail === "accountsreceivable") return "Accounts Receivable (Total)";
  if (type === "liability" && detail === "accountspayable") return "Accounts Payable (Total)";
  return accountName;
}

function groupItems(items: BSItem[], preferredOrder: string[], accountType:'asset'|'liability'|'equity'): BSGroup[] {
  const groups = new Map<string, BSItem[]>();
  items.forEach((item) => {
    const head = item.parentHead || "Other";
    groups.set(head, [...(groups.get(head) ?? []), item]);
  });

  return Array.from(groups.entries())
    .map(([head, group]) => ({
      head,
      items: [...group].sort((a, b) => compareBalanceSheetPresentation(a,b,accountType)),
      total: group.reduce((sum, item) => sum + item.amount, 0),
    }))
    .sort((a, b) => {
      const aIndex = preferredOrder.indexOf(a.head);
      const bIndex = preferredOrder.indexOf(b.head);
      if (aIndex === -1 && bIndex === -1) return a.head.localeCompare(b.head);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
}

export default function BalanceSheet() {
  const [assets, setAssets] = useState<BSSection>({ total: 0, items: [] });
  const [liabilities, setLiabilities] = useState<BSSection>({ total: 0, items: [] });
  const [equity, setEquity] = useState<BSSection>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportPrintSettings, setReportPrintSettings] = useState<any>(null);
  const [asOfDate, setAsOfDate] = useState(getLocalToday);
  const [statementView, setStatementView] = useState<BalanceSheetView>("classified");
  const [comparisonDate,setComparisonDate] = useState(() => {
    const today=new Date();today.setFullYear(today.getFullYear()-1);
    return [today.getFullYear(),String(today.getMonth()+1).padStart(2,"0"),String(today.getDate()).padStart(2,"0")].join("-");
  });
  const [customExpanded,setCustomExpanded] = useState<Record<string,boolean>>({});
  const [priorAssets,setPriorAssets] = useState<BSSection>({total:0,items:[]});
  const [priorLiabilities,setPriorLiabilities] = useState<BSSection>({total:0,items:[]});
  const [priorEquity,setPriorEquity] = useState<BSSection>({total:0,items:[]});
  const [hideZeroBalances, setHideZeroBalances] = useState(true);
  const [scope,setScope]=useState<AccountingReportScope>('branch');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchBalanceSheet = useCallback(async () => {
    setLoading(true);
    setError(null);

    let accountsRes: any[] = [];
    let ledgerRes: any[] = [];

    try {
      [accountsRes, ledgerRes] = await Promise.all([
        fetchAllPages<any>((fromRow,toRow) =>
          supabase
            .from("chart_of_accounts")
            .select("id, code, name, type, parent_id, parent_head, detail_type, is_group, allow_manual_entries, is_active")
            .order("id",{ascending:true})
            .range(fromRow,toRow)
        ),
        (async()=>{const r=await supabase.rpc('accounting_report_balances_scoped',{p_from:null,p_to:asOfDate,p_exclude_closing:false,p_scope:scope});if(r.error)throw r.error;return r.data||[]})(),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load balance sheet.");
      setLoading(false);
      return;
    }

    const salaryLinks=await fetchAllPages<any>((a,b)=>supabase.from('driver_salary_accounts').select('account_id,employees(name)').order('account_id').range(a,b)).catch((err)=>{setError(err.message);return null;});
    if(salaryLinks===null){setLoading(false);return;}
    const salaryNames=new Map<string,string>(salaryLinks.map(s=>[s.account_id,`${s.employees?.name||'Driver'} Salary Running Account`]));
    const accounts = accountsRes;
    const accountIndex = new Map<string,any>(accounts.map(a => [String(a.id),a]));
    const getAncestorNames=(account:any) => {
      const names:string[]=[];const visited=new Set<string>();
      let id=account.parent_id as string|null;
      while(id && !visited.has(id) && names.length < 24) {
        visited.add(id); const parent=accountIndex.get(id);
        if(!parent) break;
        names.push(String(parent.name??""));id=parent.parent_id??null;
      }
      return names;
    };

    const calculateSections=(ledgerLines:any[])=>{
    const accountMetaMap: Record<
      string,
      {
        name: string;
        type: string;
        parentHead: string;
        detailType: string;
        isGroup: boolean;
        allowManualEntries: boolean;
        isActive: boolean;
      }
    > = {};

    accounts.forEach((acc) => {
      const type = acc.type?.toLowerCase() || "";
      accountMetaMap[acc.id] = {
        name: acc.name,
        type,
        parentHead: coaBalanceSheetGroup(
          type,
          acc.name,
          acc.detail_type,
          acc.parent_head,
          getAncestorNames(acc)
        ),
        detailType: acc.detail_type || "General",
        isGroup: Boolean(acc.is_group),
        allowManualEntries: Boolean(acc.allow_manual_entries),
        isActive: acc.is_active !== false,
      };
    });

    const assetMap: Record<string, { amount: number; parentHead: string; detailType: string; accountIds: string[] }> = {};
    const liabilityMap: Record<string, { amount: number; parentHead: string; detailType: string; accountIds: string[] }> = {};
    const equityMap: Record<string, { amount: number; parentHead: string; detailType: string; accountIds: string[] }> = {};
    let totalRevenue = 0;
    let totalExpenses = 0;

    accounts.forEach((acc) => {
      const meta = accountMetaMap[acc.id];
      if (!meta) return;
      const target =
        meta.type === "asset"
          ? assetMap
          : meta.type === "liability"
            ? liabilityMap
            : meta.type === "equity"
              ? equityMap
              : null;
      const displayName = balanceSheetAccountName(meta.type, meta.name, meta.detailType);

      if (target && !salaryNames.has(acc.id) && !meta.isGroup && meta.allowManualEntries && meta.isActive && !target[displayName]) {
        target[displayName] = {
          amount: 0,
          parentHead: meta.parentHead,
          detailType: meta.detailType,
          accountIds: [acc.id],
        };
      }
    });

    ledgerLines.forEach((line) => {
      const meta = accountMetaMap[line.account_id];
      if (!meta) return;

      const type = meta.type;
      const debit = Number(line.debit ?? 0);
      const credit = Number(line.credit ?? 0);
      const accountName = balanceSheetAccountName(meta.type, meta.name, meta.detailType);

      if(salaryNames.has(line.account_id)){
        // Use the COA classification chosen by the owner, not movement sign.
        // Running salary debit net stays negative under the configured liability GL; no cash advance is assumed.
        // Accumulate every movement (previous code overwrote prior rows).
        const position=salarySheetPosition(type,debit,credit);
        if(position){
          const name=salaryNames.get(line.account_id)!;
          const target=position.bucket==='liability'?liabilityMap:assetMap;
          if(!target[name])target[name]={
            amount:0,
            parentHead:meta.parentHead,
            detailType:meta.detailType,
            accountIds:[line.account_id],
          };
          else if(!target[name].accountIds.includes(line.account_id))target[name].accountIds.push(line.account_id);
          target[name].amount+=position.signedAmount;
          return;
        }
      }

      if (type === "asset") {
        const net = debit - credit;
        if (!assetMap[accountName]) {
          assetMap[accountName] = { amount: 0, parentHead: meta.parentHead, detailType: meta.detailType, accountIds: [] };
        }
        if(!assetMap[accountName].accountIds.includes(line.account_id))assetMap[accountName].accountIds.push(line.account_id);
        assetMap[accountName].amount += net;
      } else if (type === "liability") {
        const net = credit - debit;
        if (!liabilityMap[accountName]) {
          liabilityMap[accountName] = { amount: 0, parentHead: meta.parentHead, detailType: meta.detailType, accountIds: [] };
        }
        if(!liabilityMap[accountName].accountIds.includes(line.account_id))liabilityMap[accountName].accountIds.push(line.account_id);
        liabilityMap[accountName].amount += net;
      } else if (type === "equity") {
        const net = credit - debit;
        if (!equityMap[accountName]) {
          equityMap[accountName] = { amount: 0, parentHead: meta.parentHead, detailType: meta.detailType, accountIds: [] };
        }
        if(!equityMap[accountName].accountIds.includes(line.account_id))equityMap[accountName].accountIds.push(line.account_id);
        equityMap[accountName].amount += net;
      } else if (type === "revenue") {
        totalRevenue += credit - debit;
      } else if (type === "expense") {
        totalExpenses += debit - credit;
      }
    });

    const currentProfitOrLoss = totalRevenue - totalExpenses;
    if (Math.abs(currentProfitOrLoss) >= 0.005) {
      equityMap["Current Profit / (Loss)"] = {
        amount: currentProfitOrLoss,
        parentHead: "Capital & Reserves",
        detailType: "Current Earnings",
      };
    }

    Object.entries(assetMap).forEach(([name, item]) => {
      const detail = normalizedDetailType(`${name} ${item.detailType ?? ""}`);
      if (item.amount < -0.005 && detail.includes("accountsreceivable")) {
        liabilityMap["Customer Advances"] = {
          amount: (liabilityMap["Customer Advances"]?.amount ?? 0) + Math.abs(item.amount),
          parentHead: "Current Liabilities",
          detailType: "Customer Credit Balances",
        };
        delete assetMap[name];
      } else if (
        item.amount < -0.005 &&
        (detail.includes("bankaccount") || detail.includes("bankbalance"))
      ) {
        liabilityMap["Bank Overdraft"] = {
          amount: (liabilityMap["Bank Overdraft"]?.amount ?? 0) + Math.abs(item.amount),
          parentHead: "Current Liabilities",
          detailType: "Bank Overdraft",
        };
        delete assetMap[name];
      }
    });

    Object.entries(liabilityMap).forEach(([name, item]) => {
      const detail = normalizedDetailType(`${name} ${item.detailType ?? ""}`);
      if (item.amount < -0.005 && detail.includes("accountspayable")) {
        assetMap["Supplier Advances"] = {
          amount: (assetMap["Supplier Advances"]?.amount ?? 0) + Math.abs(item.amount),
          parentHead: "Current Assets",
          detailType: "Supplier Debit Balances",
        };
        delete liabilityMap[name];
      }
    });

    const assetList: BSItem[] = Object.keys(assetMap)
      .map((key) => ({
        name: key,
        amount: assetMap[key].amount,
        parentHead: assetMap[key].parentHead,
        detailType: assetMap[key].detailType,
        accountIds: assetMap[key].accountIds,
      }))
      .filter((item) => !hideZeroBalances || Math.abs(item.amount) >= 0.005);

    const liabilityList: BSItem[] = Object.keys(liabilityMap)
      .map((key) => ({
        name: key,
        amount: liabilityMap[key].amount,
        parentHead: liabilityMap[key].parentHead,
        detailType: liabilityMap[key].detailType,
        accountIds: liabilityMap[key].accountIds,
      }))
      .filter((item) => !hideZeroBalances || Math.abs(item.amount) >= 0.005);

    const equityList: BSItem[] = Object.keys(equityMap)
      .map((key) => ({
        name: key,
        amount: equityMap[key].amount,
        parentHead: equityMap[key].parentHead,
        detailType: equityMap[key].detailType,
        accountIds: equityMap[key].accountIds,
      }))
      .filter((item) => !hideZeroBalances || Math.abs(item.amount) >= 0.005);

    return {
      assets:{total:assetList.reduce((sum,item)=>sum+item.amount,0),items:assetList},
      liabilities:{total:liabilityList.reduce((sum,item)=>sum+item.amount,0),items:liabilityList},
      equity:{total:equityList.reduce((sum,item)=>sum+item.amount,0),items:equityList},
    };
    };
    const current=calculateSections(ledgerRes);
    let previous:{assets:BSSection;liabilities:BSSection;equity:BSSection}={assets:{total:0,items:[]},liabilities:{total:0,items:[]},equity:{total:0,items:[]}};
    if(statementView==="comparative"){
      if(!comparisonDate || comparisonDate>=asOfDate){
        setError("Comparison date must be earlier than the as-of date.");
        setLoading(false);return;
      }
      const r=await supabase.rpc("accounting_report_balances_scoped",{
        p_from:null,p_to:comparisonDate,p_exclude_closing:false,p_scope:scope
      });
      if(r.error){setError(r.error.message);setLoading(false);return;}
      previous=calculateSections(r.data||[]);
    }
    setAssets(current.assets);
    setLiabilities(current.liabilities);
    setEquity(current.equity);
    setPriorAssets(previous.assets);
    setPriorLiabilities(previous.liabilities);
    setPriorEquity(previous.equity);
    setLastUpdated(new Date());
    setLoading(false);
  }, [asOfDate, hideZeroBalances, scope, statementView, comparisonDate]);

  useEffect(() => {
    void loadDocumentPrintSettings("reports")
      .then(setReportPrintSettings)
      .catch(() => setReportPrintSettings(null));
  }, []);

  useEffect(() => {
    void fetchBalanceSheet();
  }, [fetchBalanceSheet]);

  const totalLiabilitiesAndEquity = liabilities.total + equity.total;
  const equationDifference = assets.total - totalLiabilitiesAndEquity;
  const isBalanced = Math.abs(equationDifference) < 0.01;

  const assetGroups = useMemo(
    () => groupItems(assets.items, ["Current Assets", "Non-Current Assets"], "asset"),
    [assets.items]
  );
  const liabilityGroups = useMemo(
    () => groupItems(liabilities.items, ["Current Liabilities", "Non-Current Liabilities"], "liability"),
    [liabilities.items]
  );
  const equityGroups = useMemo(() => groupItems(equity.items, ["Capital & Reserves"], "equity"), [equity.items]);

  const priorAssetGroups=useMemo(()=>groupItems(priorAssets.items,["Current Assets","Non-Current Assets"],"asset"),[priorAssets.items]);
  const priorLiabilityGroups=useMemo(()=>groupItems(priorLiabilities.items,["Current Liabilities","Non-Current Liabilities"],"liability"),[priorLiabilities.items]);
  const priorEquityGroups=useMemo(()=>groupItems(priorEquity.items,["Capital & Reserves"],"equity"),[priorEquity.items]);
  const comparisonDifference=priorAssets.total-priorLiabilities.total-priorEquity.total;
  const statementSections=[
    {title:"Assets" as const,groups:assetGroups,total:assets.total,previousGroups:priorAssetGroups,previousTotal:priorAssets.total},
    {title:"Liabilities" as const,groups:liabilityGroups,total:liabilities.total,previousGroups:priorLiabilityGroups,previousTotal:priorLiabilities.total},
    {title:"Equity" as const,groups:equityGroups,total:equity.total,previousGroups:priorEquityGroups,previousTotal:priorEquity.total},
  ];
  const statementRows=classifiedBalanceSheetRows(statementSections,statementView,customExpanded,equationDifference,comparisonDifference);
  const reportData=classifiedBalanceSheetExport(statementRows,statementView,asOfDate,comparisonDate);
  const comparable=statementView==="comparative";
  const balanceSheetItems=row.section==="Assets"?assets.items:row.section==="Liabilities"?liabilities.items:equity.items;
  const balanceSheetAccountIds=row.kind==="detail"?(balanceSheetItems.find(item=>item.name===row.account)?.accountIds??[]):[];
  const balanceSheetLedgerHref=(accountId:string,date:string)=>`/accounting/ledgers?account=${encodeURIComponent(accountId)}&to=${encodeURIComponent(date)}`;
  const statementColumnCount=2+(comparable?1:0);
  const printReport={
    title:"Balance Sheet",
    description:"As of "+asOfDate+(comparable?" compared with "+comparisonDate:"")+" · "+statementView+" presentation · Posted ledger · Difference "+equationDifference.toFixed(2),
    columns:reportData.columns,rows:reportData.rows,
  };

  const negativeInventoryItems = assets.items.filter(
    (item) =>
      normalizedDetailType(`${item.name} ${item.detailType ?? ""}`).includes("inventory") &&
      item.amount < -0.005
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-12" aria-busy={loading}><AccountingReportScopeSelect value={scope} onChange={setScope}/>{!loading && !error && <details data-print-primary-source data-report-orientation={comparable?"landscape":"portrait"} className="no-print"><summary>Print / PDF / Excel · Selected Balance Sheet layout</summary><ConfigurableReport module="accounting" preferenceKey={"accounting-balance-sheet-"+statementView} report={printReport}/></details>}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #printable-balance-sheet, #printable-balance-sheet * { visibility: visible; }
          #printable-balance-sheet { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div id="printable-balance-sheet" className="space-y-6">
        {reportPrintSettings && (
          <div className="hidden print:block border-b border-slate-300 pb-4 text-center">
            {reportPrintSettings.visibility.show_logo && reportPrintSettings.company.logo_url && (
              <img
                src={reportPrintSettings.company.logo_url}
                alt="Company Logo"
                className="mx-auto mb-2 max-h-16 max-w-40 object-contain"
              />
            )}
            {reportPrintSettings.visibility.show_company_name && (
              <div className="text-xl font-bold">{reportPrintSettings.company.company_name}</div>
            )}
            {reportPrintSettings.visibility.show_address && reportPrintSettings.company.address && (
              <div className="mt-1 text-xs">{reportPrintSettings.company.address}</div>
            )}
            {reportPrintSettings.visibility.show_phone_email && documentContactText(reportPrintSettings.company) && (
              <div className="mt-1 text-xs">{documentContactText(reportPrintSettings.company)}</div>
            )}
            {reportPrintSettings.visibility.show_tax_details && documentTaxText(reportPrintSettings.company) && (
              <div className="mt-1 text-xs">{documentTaxText(reportPrintSettings.company)}</div>
            )}
          </div>
        )}

        <header className="flex flex-col items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Balance Sheet</h1>
            <p className="mt-1 text-sm text-slate-500">Financial position from posted ledgers</p>
            <p className="mt-1 text-xs text-slate-400">As of {formatReportDate(asOfDate)}</p>
          </div>
          <div className="no-print flex items-center gap-2">
            <button
              type="button"
              data-navilo-keep-local-action="true"
              onClick={() => void fetchBalanceSheet()}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </header>

        {error && <ErrorBanner message={error} />}

        <div data-report-filters className="no-print rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">As-of Date</span>
              <NaviloDateInput
                type="date"
                value={asOfDate}
                max={getLocalToday()}
                onChange={(event) => setAsOfDate(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <label className="block" data-report-filter-label="Statement layout" data-report-filter-value={statementView}>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Statement layout</span>
              <SearchableSelect preserveLabel className="input h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                aria-label="Statement layout" searchPlaceholder="Search statement format..."
                value={statementView} onChange={e=>setStatementView(e.target.value as BalanceSheetView)}>
                <option value="classified">Classified (default)</option>
                <option value="summary">Summary · Group totals</option>
                <option value="detailed">Detailed · Ledger classifications</option>
                <option value="comparative">Comparative · Two dates</option>
                <option value="custom">Custom · Expand selected groups</option>
              </SearchableSelect>
            </label>
            {comparable && <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Compare as of</span>
              <NaviloDateInput type="date" value={comparisonDate} max={asOfDate}
                onChange={e=>setComparisonDate(e.target.value)}
                className="input h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"/>
            </label>}
            <label className="flex h-10 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3">
              <input
                type="checkbox"
                checked={hideZeroBalances}
                onChange={(event) => setHideZeroBalances(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-slate-800">Hide zero-balance accounts</span>
            </label>

            <div className="text-left text-xs text-slate-500 lg:text-right">
              <div>Posted entries through selected date</div>
              {lastUpdated && <div>Updated {lastUpdated.toLocaleTimeString()}</div>}
            </div>
          </div>
        </div>

        {statementView==="custom" && <div className="no-print rounded-lg border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold text-slate-700">Expand or collapse group details (totals remain visible)</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {statementSections.flatMap(section=>section.groups.map(group=>{
              const key=section.title+":"+group.head;
              return <label key={key} className="inline-flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={customExpanded[key]!==false}
                  onChange={e=>setCustomExpanded(previous=>({...previous,[key]:e.target.checked}))}/>
                {section.title} / {group.head}
              </label>;
            }))}
          </div>
        </div>}

        {negativeInventoryItems.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span className="font-semibold">Inventory warning:</span>{" "}
            {negativeInventoryItems.map((item) => item.name).join(", ")} has a negative balance. Review stock posting and valuation entries.
          </div>
        )}

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-slate-400 shadow-sm">
            Loading Balance Sheet...
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-bold text-slate-900">Statement of Financial Position</div>
                <div className="mt-0.5 text-xs text-slate-500">As of {formatReportDate(asOfDate)}{comparable?" · Compared with "+formatReportDate(comparisonDate):""}</div>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-slate-500">Accounting equation</span>
                <span className={`rounded-full px-2.5 py-1 font-semibold ${isBalanced ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                  {isBalanced ? "Balanced" : "Out of Balance"}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-sm" data-business-data>
                <thead><tr className="bg-white text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="border-b border-slate-200 px-4 py-2 font-semibold">Account / Group</th>
                  <th className="border-b border-slate-200 px-4 py-2 text-right font-semibold">{comparable?"As of "+formatReportDate(asOfDate):"Amount"}</th>
                  {comparable && <th className="border-b border-slate-200 px-4 py-2 text-right font-semibold">As of {formatReportDate(comparisonDate)}</th>}
                </tr></thead>
                <tbody>
                  {statementRows.map((row,index)=>{
                    const isSection=row.kind==="section";
                    if(isSection)return <tr key={index} className="bg-slate-100">
                      <th scope="rowgroup" colSpan={statementColumnCount}
                        className="px-4 py-2 text-left text-xs font-bold uppercase tracking-wider text-slate-800">{row.account}</th>
                    </tr>;
                    const emphasis=row.kind==="total"||row.kind==="subtotal"||row.kind==="check";
                    const style=row.kind==="group"?"bg-slate-100/80 font-bold text-slate-800":row.kind==="subheading"?
                      "border-t border-slate-200 bg-blue-50/60 font-semibold text-slate-800":row.kind==="total"?
                      "border-t-2 border-slate-600 bg-slate-50 font-bold":row.kind==="subtotal"?
                      "border-t border-slate-300 bg-slate-50 font-semibold":row.kind==="check"?
                      "border-t border-slate-300 bg-blue-50 font-bold":"border-t border-slate-100";
                    const leftPadding=row.kind==="detail"?"pl-12":row.kind==="subheading"?"pl-7":row.kind==="subtotal"&&row.classification?"pl-7":"pl-4";
                    return <tr key={index} className={style}>
                      <td className={`py-1.5 pr-4 text-xs ${leftPadding} ${row.kind==="detail"?"":"font-semibold"}`}>{row.account}</td>
                      <td className={`px-4 py-1.5 text-right font-mono text-xs ${emphasis?"font-bold":""}`}>
                        {row.current===null?"":row.kind==="detail"&&balanceSheetAccountIds.length?
                          <Link to={balanceSheetLedgerHref(balanceSheetAccountIds[0],asOfDate)} title="Open this account's General Ledger as of this date" className="text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900">{formatCurrency(row.current)}</Link>:
                          formatCurrency(row.current)}
                      </td>
                      {comparable && <td className={`px-4 py-1.5 text-right font-mono text-xs ${emphasis?"font-bold":""}`}>
                        {row.previous===null?"":row.kind==="detail"&&balanceSheetAccountIds.length?
                          <Link to={balanceSheetLedgerHref(balanceSheetAccountIds[0],comparisonDate)} title="Open this account's General Ledger as of the comparison date" className="text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900">{formatCurrency(row.previous)}</Link>:
                          formatCurrency(row.previous)}
                      </td>}
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>

            <div className={`flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${isBalanced ? "border-emerald-200 bg-emerald-50/60" : "border-rose-200 bg-rose-50/70"}`}>
              <div>
                <div className="text-sm font-semibold text-slate-900">Accounting Equation Check</div>
                <div className="mt-0.5 text-xs text-slate-500">Total Assets = Total Liabilities + Equity</div>
              </div>
              <div className="text-left sm:text-right">
                <div className="font-mono text-sm font-bold text-slate-900">Difference {formatCurrency(equationDifference)}</div>
                <div className={`mt-0.5 text-xs font-semibold ${isBalanced ? "text-emerald-700" : "text-rose-700"}`}>
                  {isBalanced ? "Balanced" : "Review required"}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {reportPrintSettings && (
        <div className="hidden print:block mt-8 border-t border-slate-300 pt-3 text-xs text-slate-500">
          {reportPrintSettings.visibility.show_footer &&
            (reportPrintSettings.company.document_footer || reportPrintSettings.company.document_footer_urdu) && (
              <div className="text-center">
                {reportPrintSettings.company.document_footer}
                {reportPrintSettings.company.document_footer_urdu && <div>{reportPrintSettings.company.document_footer_urdu}</div>}
              </div>
            )}
          {reportPrintSettings.visibility.show_signatures && (
            <div className="mt-10 flex justify-between text-slate-700">
              <span>{reportPrintSettings.company.prepared_by_label || "Prepared By"}</span>
              <span>{reportPrintSettings.company.checked_by_label || "Checked By"}</span>
              <span>{reportPrintSettings.company.approved_by_label || "Approved By"}</span>
            </div>
          )}
          {reportPrintSettings.visibility.show_print_datetime && (
            <div className="mt-4">Printed: {new Date().toLocaleString("en-PK")}</div>
          )}
        </div>
      )}
    </div>
  );
}
