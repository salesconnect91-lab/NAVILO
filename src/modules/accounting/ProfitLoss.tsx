import {useAuth} from '@/auth/AuthContext';
import { Link } from "react-router-dom";
import ConfigurableReport from '../transport/ConfigurableReport';
import NaviloDateInput from '@/components/NaviloDateInput';
import AccountingReportScopeSelect,{type AccountingReportScope} from './AccountingReportScopeSelect';
import {externalVehicleIncome,reconcileNormalVehicleIncome,splitTransportRevenue,mergeVehicleLedgerMovements,totalVehicleLedgerMovement,excludeDedicatedVehicleAttributions,dedicatedVehicleServiceIncomeTotal,dedicatedVehicleNormalSalesIncomeBreakdown,type VehicleIncome} from './transportIncomeBreakdown';
import {readExternalVehicleIncomeFast,type ExternalAttributionRow} from './externalVehicleIncomeFast';
import {companyVehicleIncomeRows} from './companyVehicleIncome';
import {excludeUnattributedManualJournalMovements} from './transportIncomeBreakdown';
﻿import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  documentContactText,
  documentTaxText,
  loadDocumentPrintSettings,
} from "@/lib/documentPrintSettings";
import { ErrorBanner, formatCurrency } from "@/components/ui";
import { fetchAllPages, fetchByIdChunks } from "@/lib/fetchAllPages";

type PLBucket =
  | "operatingRevenue"
  | "otherIncome"
  | "costOfSales"
  | "operatingExpenses"
  | "otherExpenses";

type PLItem = { name: string; amount: number; detailType: string; accountIds?: string[] };
type PLSectionData = { total: number; items: PLItem[] };
type PLData = Record<PLBucket, PLSectionData>;

type AccountRow = {
  id: string;
  code: string | null;
  name: string | null;
  type: string | null;
  parent_head: string | null;
  detail_type: string | null;
  is_group: boolean | null;
  allow_manual_entries: boolean | null;
  is_active: boolean | null;
};

type LedgerRow = {
  account_id: string | null;
  journal_entry_id: string | null;
  entry_date: string;
  debit: number | string | null;
  credit: number | string | null;
};

type JournalMeta = {
  id: string;
  entry_no?: string | null;
  source_module?: string | null;
  source_document_id?: string | null;
  trans_type: string | null;
  source_document_type?: string | null;
  fiscal_year_closure_id: string | null;
  monthly_profit_closure_id?: string | null;
};

type PLDrilldown = { title: string; accountIds: string[]; serviceSalesAdjustments?: {accountId:string;amount:number}[]; dedicatedAccountIds?: string[] };

const emptySection = (): PLSectionData => ({ total: 0, items: [] });
const emptyPLData = (): PLData => ({
  operatingRevenue: emptySection(),
  otherIncome: emptySection(),
  costOfSales: emptySection(),
  operatingExpenses: emptySection(),
  otherExpenses: emptySection(),
});

function printSectionRows(title: string, section: PLSectionData) {
  return [...section.items.map(item => [title, item.name, item.amount]), [title, 'Section total', section.total]];
}

function localDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const getLocalToday = () => localDateValue(new Date());
const getYearStart = () => {
  const today = new Date();
  return localDateValue(new Date(today.getFullYear(), 0, 1));
};

function formatReportDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function normalized(value?: string) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function classifyAccount(type: string, name: string, parentHead?: string, detailType?: string): PLBucket | null {
  const text = normalized(`${name} ${parentHead ?? ""} ${detailType ?? ""}`);
  if (type === "revenue" || type === "income") {
    return ["otherincome", "interestincome", "financeincome", "gainon", "miscellaneousincome"].some((key) => text.includes(key))
      ? "otherIncome"
      : "operatingRevenue";
  }
  if (type === "expense") {
    if (["costofgoodssold", "costofsales", "cogs", "directcost", "materialconsumption", "manufacturingcost", "productioncost"].some((key) => text.includes(key))) {
      return "costOfSales";
    }
    return ["financecost", "interestexpense", "bankcharges", "losson", "otherexpense", "taxexpense"].some((key) => text.includes(key))
      ? "otherExpenses"
      : "operatingExpenses";
  }
  return null;
}

function StatementSection({ title, section, tone, onDrilldown }: {
  title: string;
  section: PLSectionData;
  tone: "income" | "expense";
  onDrilldown?: (accountIds: string[], title: string) => void;
}) {
  const sectionAccountIds = [...new Set(section.items.flatMap(item => item.accountIds ?? []))];
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-slate-700">{title}</h3>
        {onDrilldown && sectionAccountIds.length ? (
          <button type="button" onClick={() => onDrilldown(sectionAccountIds, title)}
            title="Open the posted ledger entries behind this total"
            className={`cursor-pointer rounded px-1 font-mono text-sm font-bold underline decoration-dotted underline-offset-2 hover:bg-white ${tone === "income" ? "text-emerald-700" : "text-rose-700"}`}>
            {formatCurrency(section.total)}
          </button>
        ) : (
          <span className={`font-mono text-sm font-bold ${tone === "income" ? "text-emerald-700" : "text-rose-700"}`}>
            {formatCurrency(section.total)}
          </span>
        )}
      </div>
      {section.items.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-slate-400">No balances for this period.</div>
      ) : (
        <div className="divide-y divide-slate-100 px-4">
          {section.items.map((item) => {
            const row = (
              <>
                <div className="min-w-0 text-left">
                  <span className="block truncate font-medium text-slate-800">{item.name}</span>
                  <span className="block text-[12px] text-slate-400">{item.detailType}</span>
                </div>
                <span className={`shrink-0 font-mono font-semibold ${item.amount < 0 ? "text-rose-600" : "text-slate-900"}`}>
                  {formatCurrency(item.amount)}
                </span>
              </>
            );
            return onDrilldown && item.accountIds?.length ? (
              <button type="button" key={item.name} onClick={() => onDrilldown(item.accountIds ?? [], item.name)}
                title="Open the posted ledger entries behind this account"
                className="flex w-full cursor-pointer items-center justify-between gap-4 py-2.5 text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
                {row}
              </button>
            ) : (
              <div key={item.name} className="flex items-center justify-between gap-4 py-2.5 text-sm">{row}</div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ResultRow({ label, amount, prominent = false, onClick }: {
  label: string;
  amount: number;
  prominent?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className={`flex items-center justify-between rounded-xl border px-4 py-3 ${prominent ? (amount >= 0 ? "border-emerald-400 bg-slate-900 text-white" : "border-rose-400 bg-rose-950 text-white") : "border-slate-300 bg-slate-100 text-slate-900"}`}>
      <span className="text-sm font-bold uppercase tracking-wide">{label}</span>
      {onClick ? <button type="button" onClick={onClick} title="Open contributing posted ledger entries"
        className="cursor-pointer rounded font-mono text-lg font-bold underline decoration-dotted underline-offset-2 hover:opacity-80">{formatCurrency(amount)}</button>
        : <span className="font-mono text-lg font-bold">{formatCurrency(amount)}</span>}
    </div>
  );
}

export default function ProfitLoss() {
  const {activeBusinessUnit,activeCompany}=useAuth();
  const [data, setData] = useState<PLData>(emptyPLData);
  const [drilldown, setDrilldown] = useState<PLDrilldown | null>(null);
  const [drilldownRows, setDrilldownRows] = useState<LedgerRow[]>([]);
  const [drilldownAccountNames, setDrilldownAccountNames] = useState<Record<string,string>>({});
  const [drilldownJournals, setDrilldownJournals] = useState<Record<string,JournalMeta>>({});
  const [fromDate, setFromDate] = useState(getYearStart);
  const [toDate, setToDate] = useState(getLocalToday);
  const [hideZeroBalances, setHideZeroBalances] = useState(true);
  const [scope,setScope]=useState<AccountingReportScope>('branch');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportPrintSettings, setReportPrintSettings] = useState<any>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [transportIncome,setTransportIncome]=useState<{sales:number;service:number;other:number;vehicleLedgerTotal:number;dedicatedSales:number;vehicles:VehicleIncome[];residual:number;vehicleError:string;salesAccountIds:string[];serviceAccountIds:string[];serviceVehicleAccountIds:string[];serviceSalesAdjustments:{accountId:string;amount:number}[]}|null>(null);
  const [verifiedTransportUnit,setVerifiedTransportUnit]=useState<{companyId:string;businessUnitId:string;isTransport:boolean}|null>(null);
  const companyId=activeCompany?.company_id??'';
  const businessUnitId=activeBusinessUnit?.business_unit_id??'';
  // Access-context unit type can be missing on a cached or stale auth context.
  // Check the currently selected Business Unit in the database; never rely
  // on a company name or show another company's vehicles.
  const isTransport=String(activeBusinessUnit?.business_unit_type??'').toLowerCase()==='transport'
    ||(verifiedTransportUnit?.companyId===companyId
      &&verifiedTransportUnit.businessUnitId===businessUnitId
      &&verifiedTransportUnit.isTransport);

  useEffect(()=>{
    let active=true;
    setVerifiedTransportUnit(null);
    if(!companyId||!businessUnitId)return;
    void (async()=>{
      const result=await supabase.from('business_units')
        .select('unit_type').eq('id',businessUnitId).eq('company_id',companyId).maybeSingle();
      if(active&&!result.error&&result.data){
        setVerifiedTransportUnit({companyId,businessUnitId,
          isTransport:String(result.data.unit_type??'').toLowerCase()==='transport'});
      }
    })();
    return ()=>{active=false};
  },[companyId,businessUnitId]);

  const fetchPL = useCallback(async () => {
    if (!fromDate || !toDate) return;
    if (fromDate > toDate) {
      setError("From date cannot be after To date.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    let accounts: AccountRow[] = [];
    let rawLedger: LedgerRow[] = [];
    let mappings: Array<{mapping_key:string;account_id:string}> = [];
    let vehicleResult: {rows:Array<{vehicle_id:string;vehicle_no:string;amount:number|string}>;externalRows:ExternalAttributionRow[];vehicles:Array<{id:string;vehicle_no:string;revenue_account_id:string|null}>;error:string} = {rows:[],externalRows:[],vehicles:[],error:''};
    setTransportIncome(null);

    try {
      [accounts, rawLedger, mappings, vehicleResult] = await Promise.all([
        fetchAllPages<AccountRow>((fromRow,toRow) =>
          supabase
            .from("chart_of_accounts")
            .select("id,code,name,type,parent_head,detail_type,is_group,allow_manual_entries,is_active")
            .order("id",{ascending:true})
            .range(fromRow,toRow)
        ),
        (async()=>{const r=await supabase.rpc('accounting_report_balances_scoped',{p_from:fromDate,p_to:toDate,p_exclude_closing:true,p_scope:scope});if(r.error)throw r.error;return r.data||[]})(),
        isTransport&&companyId
          ? (async()=>{
              const result=await supabase.from('account_mappings').select('mapping_key,account_id')
                .eq('company_id',companyId).in('mapping_key',['sales_revenue','service_revenue']);
              if(result.error)throw result.error;
              return result.data??[];
            })():Promise.resolve([] as Array<{mapping_key:string;account_id:string}>),
        isTransport
          ? (async()=>{
              try{
                // A missing Normal Sale allocation needs no expensive aggregation.
                // External imports have separate, journal-backed source evidence.
                let normalQuery=supabase.from('transport_normal_vehicle_allocations')
                  .select('source_line_id').eq('company_id',companyId);
                if(scope!=='company')normalQuery=normalQuery.eq('business_unit_id',businessUnitId);
                const normalCheck=await normalQuery.limit(1);
                if(normalCheck.error)throw new Error(`Normal Sale allocation lookup failed: ${normalCheck.error.message}`);
                let normalRows:Array<{vehicle_id:string;vehicle_no:string;amount:number|string}>=[];
                if((normalCheck.data??[]).length){
                  const result=await supabase.rpc('transport_pl_normal_sales_vehicle_income_scoped',{
                    p_from:fromDate,p_to:toDate,p_scope:scope
                  });
                  if(result.error)throw result.error;
                  if(!Array.isArray(result.data?.rows))throw new Error('Incomplete Normal Sale vehicle breakdown');
                  normalRows=result.data.rows;
                }
                let locationId:string|null=null;
                if(scope==='branch'){
                  const location=await supabase.rpc('current_operating_location_id');
                  if(location.error)throw new Error(`Active location lookup failed: ${location.error.message}`);
                  if(!location.data)throw new Error('Active branch is missing for vehicle income breakdown');
                  locationId=String(location.data);
                }
                // Source rows use indexed company / order / journal lookups instead
                // of the expensive external vehicle-contributions UNION view.
                const externalRows=await readExternalVehicleIncomeFast({
                  companyId,businessUnitId,locationId,scope,fromDate,toDate,
                });
                const vehicles=await fetchAllPages<{id:string;vehicle_no:string;revenue_account_id:string|null}>(
                  (from,to)=>{
                    let q=supabase.from('transport_vehicles').select('id,vehicle_no,revenue_account_id')
                      .eq('company_id',companyId).eq('ownership_type','company').eq('is_active',true);
                    if(scope!=='company')q=q.eq('business_unit_id',businessUnitId);
                    return q.order('vehicle_no',{ascending:true}).range(from,to);
                  },500,
                );
                return {rows:normalRows,externalRows,vehicles,error:''};
              }catch(err){
                return {rows:[],externalRows:[],vehicles:[],error:err instanceof Error?err.message:'Vehicle income breakdown unavailable'};
              }
            })():Promise.resolve({rows:[],externalRows:[] as ExternalAttributionRow[],vehicles:[],error:''}),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Profit & Loss statement.");
      setLoading(false);
      return;
    }

    const journalIds = Array.from(new Set(rawLedger.map((line) => line.journal_entry_id).filter(Boolean))) as string[];

    let closingJournalIds = new Set<string>();
    let journalRows: JournalMeta[] = [];
    if (journalIds.length) {
      try {
        journalRows = await fetchByIdChunks<JournalMeta>(
          journalIds,
          (ids,fromRow,toRow) =>
            supabase
              .from("journal_entries")
              .select("id,entry_no,source_module,source_document_id,trans_type,source_document_type,fiscal_year_closure_id,monthly_profit_closure_id")
              .in("id",ids)
              .order("id",{ascending:true})
              .range(fromRow,toRow)
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load journal metadata.");
        setLoading(false);
        return;
      }
      closingJournalIds = new Set(
        journalRows
          .filter((entry) => entry.trans_type === "Year End Closing" || Boolean(entry.fiscal_year_closure_id) || Boolean(entry.monthly_profit_closure_id))
          .map((entry) => entry.id)
      );
    }

    // Year-end closing journals transfer annual profit/loss to Retained Earnings.
    // They belong in the General Ledger and Balance Sheet, but NOT in the historical
    // P&L itself, otherwise a closed year would incorrectly show zero profit/loss.
    const ledgerLines = rawLedger.filter((line) => !line.journal_entry_id || !closingJournalIds.has(line.journal_entry_id));
    const vehicleLedgerLines = excludeUnattributedManualJournalMovements(ledgerLines,journalRows);

    const accountMap = new Map<string, {
      id: string;
      name: string;
      type: string;
      detailType: string;
      bucket: PLBucket | null;
      isGroup: boolean;
      allowManualEntries: boolean;
      isActive: boolean;
    }>();

    accounts.forEach((account) => {
      const type = String(account.type ?? "").toLowerCase();
      const name = String(account.name ?? "").trim();
      const detailType = account.detail_type || "General";
      accountMap.set(account.id, {
        id: account.id,
        name,
        type,
        detailType,
        bucket: classifyAccount(type, name, account.parent_head || "General", detailType),
        isGroup: Boolean(account.is_group),
        allowManualEntries: Boolean(account.allow_manual_entries),
        isActive: account.is_active !== false,
      });
    });

    const bucketMaps: Record<PLBucket, Map<string, PLItem>> = {
      operatingRevenue: new Map(),
      otherIncome: new Map(),
      costOfSales: new Map(),
      operatingExpenses: new Map(),
      otherExpenses: new Map(),
    };

    if (!hideZeroBalances) {
      accountMap.forEach((account) => {
        if (account.bucket && !account.isGroup && account.allowManualEntries && account.isActive) {
          bucketMaps[account.bucket].set(account.name, { name: account.name, amount: 0, detailType: account.detailType, accountIds: [account.id] });
        }
      });
    }

    ledgerLines.forEach((line) => {
      if (!line.account_id) return;
      const account = accountMap.get(line.account_id);
      if (!account?.bucket) return;
      const debit = Number(line.debit ?? 0);
      const credit = Number(line.credit ?? 0);
      const movement = account.type === "revenue" || account.type === "income" ? credit - debit : debit - credit;
      const current = bucketMaps[account.bucket].get(account.name);
      bucketMaps[account.bucket].set(account.name, {
        name: account.name,
        amount: (current?.amount ?? 0) + movement,
        detailType: account.detailType,
        accountIds: [...new Set([...(current?.accountIds ?? []), line.account_id])],
      });
    });

    const next = emptyPLData();
    (Object.keys(bucketMaps) as PLBucket[]).forEach((bucket) => {
      const items = Array.from(bucketMaps[bucket].values())
        .filter((item) => !hideZeroBalances || Math.abs(item.amount) >= 0.005)
        .sort((a, b) => a.name.localeCompare(b.name));
      next[bucket] = { items, total: items.reduce((sum, item) => sum + item.amount, 0) };
    });

    if(isTransport){
      try{
        const salesAccountId=mappings.find(m=>m.mapping_key==='sales_revenue')?.account_id??'';
        const serviceAccountId=mappings.find(m=>m.mapping_key==='service_revenue')?.account_id??'';
        const {sales:mappedSales,service:mappedService}=splitTransportRevenue(ledgerLines,salesAccountId,serviceAccountId);
        const dedicatedSalesResult=await supabase.rpc('transport_pl_dedicated_vehicle_sales_income_scoped',{
          p_from:fromDate,p_to:toDate,p_scope:scope,
        });
        if(dedicatedSalesResult.error)throw dedicatedSalesResult.error;
        if(!Array.isArray(dedicatedSalesResult.data?.rows))throw new Error('Incomplete posted vehicle Sales Income source breakdown');
        const dedicatedSalesBreakdown=dedicatedVehicleNormalSalesIncomeBreakdown(
          vehicleResult.vehicles,
          accounts.map(a=>({id:a.id,code:a.code,type:a.type,is_group:a.is_group,is_active:a.is_active})),
          dedicatedSalesResult.data.rows,
        );
        const dedicatedSales=dedicatedSalesBreakdown.total;
        const sales=Number((mappedSales+dedicatedSales).toFixed(2));
        const linkedVehicleRows=companyVehicleIncomeRows(vehicleResult.vehicles,accounts.map(a=>({
          id:a.id,code:a.code,type:a.type,is_group:a.is_group,is_active:a.is_active,
        })),vehicleLedgerLines).map(row=>({
          vehicle_id:row.id,vehicle_no:row.vehicle_no,amount:row.amount,status:row.status,
        }));
        const dedicatedServiceIncome=dedicatedVehicleServiceIncomeTotal(
          vehicleResult.vehicles,
          accounts.map(a=>({id:a.id,code:a.code,type:a.type,detail_type:a.detail_type,is_group:a.is_group,is_active:a.is_active})),
          vehicleLedgerLines,
          new Set([serviceAccountId]),
          dedicatedSalesBreakdown.byAccount,
        );
        const service=Number((mappedService+dedicatedServiceIncome).toFixed(2));
        const dedicatedVehicleIds=new Set(linkedVehicleRows
          .filter(row=>row.status==='dedicated').map(row=>row.vehicle_id));
        const dedicatedVehicleAccountIds=new Set(linkedVehicleRows
          .filter(row=>row.status==='dedicated')
          .flatMap(row=>vehicleResult.vehicles.find(v=>v.id===row.vehicle_id)?.revenue_account_id??[]));
        // Vehicle-linked invoices already change that vehicle's one ledger.
        // Read its signed GL movement once so income and debits produce one
        // net profit/loss figure instead of adding the invoice a second time.
        const normalAttribution=excludeDedicatedVehicleAttributions(
          vehicleResult.rows,dedicatedVehicleIds,
        );
        const external=externalVehicleIncome(vehicleResult.externalRows.filter(x=>
          x.revenue_account_id===salesAccountId&&!dedicatedVehicleAccountIds.has(x.revenue_account_id)));
        const vehicleData=[...normalAttribution,...external].map(x=>({
          vehicle_id:String(x.vehicle_id??''),vehicle_no:String(x.vehicle_no??''),amount:Number(x.amount)
        }));
        const breakdown=vehicleResult.error
          ? {vehicles:[] as VehicleIncome[],allocated:0,residual:0}
          : reconcileNormalVehicleIncome(mappedSales,vehicleData,hideZeroBalances);
        const vehicleLedgerRows=vehicleResult.error?[]:linkedVehicleRows;
        const vehicleLedgerTotal=totalVehicleLedgerMovement(vehicleLedgerRows);
        const combinedVehicles=vehicleResult.error?breakdown.vehicles:
          mergeVehicleLedgerMovements(breakdown.vehicles,vehicleLedgerRows,hideZeroBalances);
        const serviceAccountIds=new Set<string>();
        if(serviceAccountId)serviceAccountIds.add(serviceAccountId);
        const linkCounts=new Map<string,number>();
        for(const vehicle of vehicleResult.vehicles)if(vehicle.revenue_account_id)
          linkCounts.set(vehicle.revenue_account_id,(linkCounts.get(vehicle.revenue_account_id)||0)+1);
        for(const vehicle of vehicleResult.vehicles){
          const id=vehicle.revenue_account_id;
          if(!id||id===serviceAccountId||(linkCounts.get(id)||0)>1)continue;
          const account=accounts.find(candidate=>candidate.id===id);
          if(!account||(account.type!=='revenue'&&account.type!=='income')||account.is_group===true||account.is_active===false)continue;
          const detail=(account.detail_type??'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
          if(['service_income','service_revenue','service'].includes(detail)&&account.code!=='4100'&&account.code!=='4200')serviceAccountIds.add(id);
        }
        setTransportIncome({
          sales,service,
          // Revenue classifications must add back to the posted GL total exactly once.
          other:Number((next.operatingRevenue.total-sales-service).toFixed(2)),
          vehicleLedgerTotal,dedicatedSales,
          vehicles:combinedVehicles,
          residual:breakdown.residual,
          vehicleError:vehicleResult.error,
          salesAccountIds:[...new Set([salesAccountId,...dedicatedSalesBreakdown.byAccount.keys()].filter((id):id is string=>Boolean(id)))],
          serviceAccountIds:[...serviceAccountIds],
          serviceVehicleAccountIds:[...serviceAccountIds].filter(id=>id!==serviceAccountId),
          serviceSalesAdjustments:[...dedicatedSalesBreakdown.byAccount].filter(([accountId])=>serviceAccountIds.has(accountId)).map(([accountId,amount])=>({accountId,amount})),
        });
      }catch(err){
        setError(err instanceof Error?err.message:'Transport Revenue classification unavailable');
        setTransportIncome(null);
      }
    }
    setDrilldownRows(ledgerLines);
    setDrilldownAccountNames(Object.fromEntries(accounts.map(account=>[account.id,account.name??"Unnamed account"])));
    setDrilldownJournals(Object.fromEntries(journalRows.map(journal=>[journal.id,journal])));
    setData(next);
    setLastUpdated(new Date());
    setLoading(false);
  }, [fromDate, toDate, hideZeroBalances, scope,isTransport,activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);


  useEffect(() => {
    void loadDocumentPrintSettings("reports").then(setReportPrintSettings).catch(() => setReportPrintSettings(null));
  }, []);

  useEffect(() => { void fetchPL(); }, [fetchPL]);

  const metrics = useMemo(() => {
    const grossProfit = data.operatingRevenue.total - data.costOfSales.total;
    const operatingProfit = grossProfit - data.operatingExpenses.total;
    const netProfit = operatingProfit + data.otherIncome.total - data.otherExpenses.total;
    const totalIncome = data.operatingRevenue.total + data.otherIncome.total;
    const totalExpenses = data.costOfSales.total + data.operatingExpenses.total + data.otherExpenses.total;
    return {
      grossProfit,
      operatingProfit,
      netProfit,
      totalIncome,
      totalExpenses,
      netMargin: totalIncome === 0 ? 0 : (netProfit / totalIncome) * 100,
    };
  }, [data]);

  // Revenue export rows preserve posted GL attribution without adding memo subtotals.
  const revenueExportRows:(string|number)[][]=isTransport&&transportIncome?[
    ['Sales Income — Normal Invoices','Sales Revenue GL plus invoice-linked revenue accounts',transportIncome.sales],
    ['Service Income — Trip Invoices','Service Revenue GL total',transportIncome.service],
    ...(Math.abs(transportIncome.other)>=0.005?[['Other Operating Revenue','Other revenue GL',transportIncome.other]]:[])
  ]:printSectionRows('Operating Revenue',data.operatingRevenue);

  const openDrilldown=(accountIds:string[],title:string,serviceSalesAdjustments:{accountId:string;amount:number}[]=[],dedicatedAccountIds:string[]=[] )=>{
    const uniqueIds=[...new Set(accountIds.filter(Boolean))];
    if(uniqueIds.length)setDrilldown({title,accountIds:uniqueIds,serviceSalesAdjustments,dedicatedAccountIds});
  };
  const pAndLAccountIds=(...sections:PLSectionData[])=>[...new Set(sections.flatMap(section=>section.items.flatMap(item=>item.accountIds??[])))];
  const otherTransportRevenueIds=()=>pAndLAccountIds(data.operatingRevenue)
    .filter(id=>!new Set([...(transportIncome?.salesAccountIds??[]),...(transportIncome?.serviceAccountIds??[])]).has(id));

  const setThisMonth = () => {
    const today = new Date();
    setFromDate(localDateValue(new Date(today.getFullYear(), today.getMonth(), 1)));
    setToDate(localDateValue(today));
  };

  const setThisYear = () => {
    setFromDate(getYearStart());
    setToDate(getLocalToday());
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12"><AccountingReportScopeSelect value={scope} onChange={setScope}/>
      <style>{`@media print{body *{visibility:hidden}#printable-profit-loss,#printable-profit-loss *{visibility:visible}#printable-profit-loss{position:absolute;left:0;top:0;width:100%}.no-print{display:none!important}}`}</style>

      <div id="printable-profit-loss" className="space-y-6" aria-busy={loading}>
        {reportPrintSettings && (
          <div className="hidden border-b border-slate-300 pb-4 text-center print:block">
            {reportPrintSettings.visibility.show_logo && reportPrintSettings.company.logo_url && <img src={reportPrintSettings.company.logo_url} alt="Company Logo" className="mx-auto mb-2 max-h-16 max-w-40 object-contain" />}
            {reportPrintSettings.visibility.show_company_name && <div className="text-xl font-bold">{reportPrintSettings.company.company_name}</div>}
            {reportPrintSettings.visibility.show_address && reportPrintSettings.company.address && <div className="mt-1 text-xs">{reportPrintSettings.company.address}</div>}
            {reportPrintSettings.visibility.show_phone_email && documentContactText(reportPrintSettings.company) && <div className="mt-1 text-xs">{documentContactText(reportPrintSettings.company)}</div>}
            {reportPrintSettings.visibility.show_tax_details && documentTaxText(reportPrintSettings.company) && <div className="mt-1 text-xs">{documentTaxText(reportPrintSettings.company)}</div>}
          </div>
        )}

        <header className="flex flex-col items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Profit & Loss Statement</h1>
            <p className="mt-1 text-sm text-slate-500">For the period {formatReportDate(fromDate)} to {formatReportDate(toDate)}</p>
            <p className="mt-1 text-xs text-slate-400">Monthly and year-end closing journals are excluded from P&L presentation.</p>
          </div>
          <button type="button" onClick={() => void fetchPL()} disabled={loading} className="no-print flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </header>

        {error && <ErrorBanner message={error} />}

        <div className="no-print rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-report-filters>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1.35fr_auto] lg:items-end">
            <label><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">From Date</span><NaviloDateInput type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
            <label><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">To Date</span><NaviloDateInput type="date" value={toDate} min={fromDate} max={getLocalToday()} onChange={(e) => setToDate(e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
            <label className="flex h-10 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3"><input type="checkbox" checked={hideZeroBalances} onChange={(e) => setHideZeroBalances(e.target.checked)} className="h-4 w-4" /><span className="text-sm font-medium text-slate-800">Hide zero-balance accounts</span></label>
            <div className="flex gap-2"><button type="button" onClick={setThisMonth} className="h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">This Month</button><button type="button" onClick={setThisYear} className="h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">This Year</button></div>
          </div>
          {lastUpdated && <div className="mt-2 text-right text-[12px] text-slate-400">Posted operational ledger entries only · Updated {lastUpdated.toLocaleTimeString()}</div>}
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-slate-400 shadow-sm">Loading Profit & Loss statement...</div>
        ) : (
          <>
            <details data-print-primary-source data-report-orientation="portrait" className="no-print"><summary>Export / customize Profit and Loss</summary><ConfigurableReport module="accounting" preferenceKey="accounting-profit-loss" report={{title:'Profit and Loss',description:`${fromDate} to ${toDate} · Posted canonical ledger; monthly and year-end closing excluded`,columns:['Section','Account','Amount'],rows:[...revenueExportRows,...printSectionRows('Cost of Sales',data.costOfSales),['Result','Gross Profit / Loss',metrics.grossProfit],...printSectionRows('Operating Expenses',data.operatingExpenses),['Result','Operating Profit / Loss',metrics.operatingProfit],...printSectionRows('Other Income',data.otherIncome),...printSectionRows('Other Expenses',data.otherExpenses),['Result','Net Profit / Loss',metrics.netProfit]]}}/></details><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {([
                ["Revenue", data.operatingRevenue.total, "text-emerald-700"],
                ["Cost of Sales", data.costOfSales.total, "text-rose-700"],
                ["Gross Profit", metrics.grossProfit, metrics.grossProfit >= 0 ? "text-emerald-700" : "text-rose-700"],
                ["Operating Expenses", data.operatingExpenses.total, "text-rose-700"],
                ["Net Profit / Loss", metrics.netProfit, metrics.netProfit >= 0 ? "text-blue-700" : "text-rose-700"],
              ] as Array<[string, number, string]>).map(([label, value, tone]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><span className="block text-[12px] font-bold uppercase tracking-wide text-slate-500">{label}</span><span className={`mt-1 block font-mono text-base font-bold ${tone}`}>{formatCurrency(value)}</span></div>
              ))}
            </div>

            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              {isTransport&&transportIncome?<>
                <StatementSection title="Sales Income — Normal Invoices"
                  section={{total:transportIncome.sales,items:Math.abs(transportIncome.sales)>=0.005||!hideZeroBalances?[{
                    name:'Sales Revenue — posted Normal Sales invoices',
                    amount:transportIncome.sales,detailType:'Mapped Sales Revenue plus invoice-linked revenue accounts',
                    accountIds:transportIncome.salesAccountIds,
                  }]:[]}} tone="income" onDrilldown={openDrilldown} />
                <StatementSection title="Service Income — Trip Invoices"
                  section={{total:transportIncome.service,items:Math.abs(transportIncome.service)>=0.005||!hideZeroBalances?[{
                    name:'Service Revenue — posted Trip invoices',
                    amount:transportIncome.service,detailType:'Mapped service revenue plus invoice-linked service accounts',
                    accountIds:transportIncome.serviceAccountIds,
                  }]:[]}} tone="income" onDrilldown={(ids,title)=>openDrilldown(ids,title,transportIncome.serviceSalesAdjustments,transportIncome.serviceVehicleAccountIds)} />
                {(Math.abs(transportIncome.other)>=0.005||!hideZeroBalances)&&
                  <StatementSection title="Other Operating Revenue" section={{total:transportIncome.other,
                    items:[{name:'Other revenue accounts / manual adjustments',amount:transportIncome.other,detailType:'Posted GL — outside Sales and Service Revenue',accountIds:otherTransportRevenueIds()}]}} tone="income" onDrilldown={openDrilldown}/>}
              </>:<StatementSection title="Operating Revenue" section={data.operatingRevenue} tone="income" onDrilldown={openDrilldown} />}
              <StatementSection title="Less: Cost of Sales" section={data.costOfSales} tone="expense" onDrilldown={openDrilldown} />
              <ResultRow label="Gross Profit / (Loss)" amount={metrics.grossProfit} onClick={()=>openDrilldown(pAndLAccountIds(data.operatingRevenue,data.costOfSales),"Gross Profit / (Loss)")} />
              <StatementSection title="Operating Expenses" section={data.operatingExpenses} tone="expense" onDrilldown={openDrilldown} />
              <ResultRow label="Operating Profit / (Loss)" amount={metrics.operatingProfit} onClick={()=>openDrilldown(pAndLAccountIds(data.operatingRevenue,data.costOfSales,data.operatingExpenses),"Operating Profit / (Loss)")} />
              {(data.otherIncome.items.length > 0 || !hideZeroBalances) && <StatementSection title="Other Income" section={data.otherIncome} tone="income" onDrilldown={openDrilldown} />}
              {(data.otherExpenses.items.length > 0 || !hideZeroBalances) && <StatementSection title="Other Expenses" section={data.otherExpenses} tone="expense" onDrilldown={openDrilldown} />}
              <ResultRow label="Net Profit / (Loss)" amount={metrics.netProfit} prominent onClick={()=>openDrilldown(pAndLAccountIds(data.operatingRevenue,data.costOfSales,data.operatingExpenses,data.otherIncome,data.otherExpenses),"Net Profit / (Loss)")} />
              <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-3" data-report-total>
                <div><span className="block text-xs text-slate-500">Total Income</span><span className="font-mono font-bold text-emerald-700">{formatCurrency(metrics.totalIncome)}</span></div>
                <div><span className="block text-xs text-slate-500">Total Expenses</span><span className="font-mono font-bold text-rose-700">{formatCurrency(metrics.totalExpenses)}</span></div>
                <div><span className="block text-xs text-slate-500">Net Margin</span><span className={`font-mono font-bold ${metrics.netMargin >= 0 ? "text-blue-700" : "text-rose-700"}`}>{metrics.netMargin.toFixed(2)}%</span></div>
              </div>
            </div>
          </>
        )}
      </div>

      {drilldown && (
        <div className="no-print fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-3" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setDrilldown(null)}}>
          <section role="dialog" aria-modal="true" aria-labelledby="pl-drilldown-title" className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3">
              <div><h2 id="pl-drilldown-title" className="text-sm font-bold text-slate-900">{drilldown.title} — Posted Ledger Details</h2>
                <p className="mt-1 text-xs text-slate-500">{formatReportDate(fromDate)} to {formatReportDate(toDate)} · current company, unit and report scope</p></div>
              <button type="button" onClick={()=>setDrilldown(null)} className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Close</button>
            </header>
            <div className="overflow-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-slate-100 text-slate-600"><tr>
                  <th className="px-3 py-2">Date</th><th className="px-3 py-2">Account</th><th className="px-3 py-2">Source</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2">Entry</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {drilldownRows.filter(line=>{
                    if(!line.account_id||!drilldown.accountIds.includes(line.account_id))return false;
                    if(!drilldown.dedicatedAccountIds?.includes(line.account_id)||!line.journal_entry_id)return true;
                    const journal=drilldownJournals[line.journal_entry_id];
                    const manualTypes=new Set(["","General","Journal Entry","Manual Journal","Journal Reversal"]);
                    return !journal||Boolean(journal.source_document_type)||!manualTypes.has(journal.trans_type??"");
                  }).map((line,index)=>{
                    const journal=line.journal_entry_id?drilldownJournals[line.journal_entry_id]:undefined;
                    const account=drilldownAccountNames[line.account_id??""]??"Unknown account";
                    const accountType=data.operatingRevenue.items.find(item=>(item.accountIds??[]).includes(line.account_id??""))?"income":data.otherIncome.items.find(item=>(item.accountIds??[]).includes(line.account_id??""))?"income":data.costOfSales.items.find(item=>(item.accountIds??[]).includes(line.account_id??""))||data.operatingExpenses.items.find(item=>(item.accountIds??[]).includes(line.account_id??""))||data.otherExpenses.items.find(item=>(item.accountIds??[]).includes(line.account_id??""))?"expense":"income";
                    const net=accountType==="income"?Number(line.credit??0)-Number(line.debit??0):Number(line.debit??0)-Number(line.credit??0);
                    return <tr key={line.journal_entry_id+":"+line.account_id+":"+line.entry_date+":"+index} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-3 py-2">{formatReportDate(line.entry_date)}</td>
                      <td className="px-3 py-2 font-medium">{account}</td>
                      <td className="px-3 py-2">{journal?.source_module&&journal?.source_document_type?`${journal.source_module} · ${journal.source_document_type}`:journal?.trans_type||"Ledger posting"}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(Number(line.debit??0))}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(Number(line.credit??0))}</td>
                      <td className={`px-3 py-2 text-right font-mono ${net<0?"text-rose-700":"text-slate-900"}`}>{formatCurrency(net)}</td>
                      <td className="px-3 py-2">{journal?.source_module==="sales"&&journal.source_document_type==="sales_invoice"&&journal.source_document_id?<Link to={`/sales/${journal.source_document_id}`} onClick={()=>setDrilldown(null)} className="font-semibold text-blue-700 underline">{journal.entry_no||"Open invoice"}</Link>:journal?.source_module==="purchase"&&journal.source_document_type==="purchase_invoice"&&journal.source_document_id?<Link to={`/purchase/${journal.source_document_id}`} onClick={()=>setDrilldown(null)} className="font-semibold text-blue-700 underline">{journal.entry_no||"Open invoice"}</Link>:line.journal_entry_id?<Link to={`/accounting/${line.journal_entry_id}`} onClick={()=>setDrilldown(null)} className="font-semibold text-blue-700 underline">{journal?.entry_no||"Open journal"}</Link>:"—"}</td>
                    </tr>;
                  })}
                  {drilldown.serviceSalesAdjustments?.map((adjustment,index)=><tr key={"service-sales-adjustment:"+adjustment.accountId+":"+index} className="bg-amber-50/60">
                    <td className="whitespace-nowrap px-3 py-2">—</td>
                    <td className="px-3 py-2 font-medium">{drilldownAccountNames[adjustment.accountId]??"Revenue account"}</td>
                    <td className="px-3 py-2">Memo adjustment · Sales Income already included above</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCurrency(adjustment.amount)}</td>
                    <td className="px-3 py-2 text-right font-mono">—</td>
                    <td className="px-3 py-2 text-right font-mono text-rose-700">{formatCurrency(-adjustment.amount)}</td>
                    <td className="px-3 py-2">—</td>
                  </tr>)}
                  {!drilldownRows.some(line=>{
                    if(!line.account_id||!drilldown.accountIds.includes(line.account_id))return false;
                    if(!drilldown.dedicatedAccountIds?.includes(line.account_id)||!line.journal_entry_id)return true;
                    const journal=drilldownJournals[line.journal_entry_id];
                    const manualTypes=new Set(["","General","Journal Entry","Manual Journal","Journal Reversal"]);
                    return !journal||Boolean(journal.source_document_type)||!manualTypes.has(journal.trans_type??"");
                  })&&
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No posted ledger entries found for this row in the selected period.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {reportPrintSettings && (
        <div className="mt-8 hidden border-t border-slate-300 pt-3 text-xs text-slate-500 print:block">
          {reportPrintSettings.visibility.show_footer && reportPrintSettings.company.document_footer && <div className="text-center">{reportPrintSettings.company.document_footer}</div>}
          {reportPrintSettings.visibility.show_signatures && <div className="mt-10 flex justify-between text-slate-700"><span>{reportPrintSettings.company.prepared_by_label || "Prepared By"}</span><span>{reportPrintSettings.company.checked_by_label || "Checked By"}</span><span>{reportPrintSettings.company.approved_by_label || "Approved By"}</span></div>}
          {reportPrintSettings.visibility.show_print_datetime && <div className="mt-4">Printed: {new Date().toLocaleString("en-PK")}</div>}
        </div>
      )}
    </div>
  );
}
