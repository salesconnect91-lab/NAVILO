import {useAuth} from '@/auth/AuthContext';
import { Link, useNavigate } from "react-router-dom";
import ConfigurableReport from '../transport/ConfigurableReport';
import NaviloDateInput from '@/components/NaviloDateInput';
import SearchableSelect from '@/components/SearchableSelect';
import AccountingReportScopeSelect,{type AccountingReportScope} from './AccountingReportScopeSelect';
import {externalVehicleIncome,reconcileNormalVehicleIncome,splitTransportRevenue,mergeVehicleLedgerMovements,totalVehicleLedgerMovement,excludeDedicatedVehicleAttributions,dedicatedVehicleNormalSalesIncomeBreakdown,reconcileTransportProfitLossSources,type VehicleIncome} from './transportIncomeBreakdown';
import {readExternalVehicleIncomeFast,type ExternalAttributionRow} from './externalVehicleIncomeFast';
import {companyVehicleIncomeRows} from './companyVehicleIncome';
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

type PLItem = { name: string; amount: number; detailType: string; accountIds?: string[]; journalIds?: string[] };
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

type PLDrilldown = { title: string; accountIds: string[]; journalIds?: string[]; excludeJournalIds?: string[]; serviceSalesAdjustments?: {accountId:string;amount:number}[]; dedicatedAccountIds?: string[] };

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

function vehicleLedgerLabel(type: string, vehicleNo: string, accountName?: string) {
  const inferredType = type.trim() || (accountName ?? "").replace(vehicleNo, "").trim().replace(/[\\s–—-]+$/, "");
  return [inferredType, vehicleNo].filter(Boolean).join(" · ") || accountName || vehicleNo;
}

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

function StatementSection({ title, section, onDrilldown, showDetails = true }: {
  title: string;
  section: PLSectionData;
  tone: "income" | "expense";
  onDrilldown?: (accountIds: string[], title: string, journalIds?: string[]) => void;
  showDetails?: boolean;
}) {
  const sectionAccountIds = [...new Set(section.items.flatMap(item => item.accountIds ?? []))];
  return (
    <>
      <tr className="bg-slate-100">
        <th scope="rowgroup" colSpan={2} className="px-4 py-2 text-left text-xs font-bold uppercase tracking-wider text-slate-800">{title}</th>
      </tr>
      {!showDetails ? (
        <tr><td colSpan={2} className="px-4 py-1.5 text-xs text-slate-500">Account details hidden · section total remains visible.</td></tr>
      ) : section.items.length === 0 ? (
        <tr><td colSpan={2} className="px-4 py-2 text-xs text-slate-400">No balances for this period.</td></tr>
      ) : section.items.map((item,index) => (
        <tr key={item.accountIds?.[0] ?? item.name} className={index%2===1 ? "bg-slate-50/60" : "border-t border-slate-100"}>
          <td className="py-1.5 pr-4 pl-12 text-xs">
            {onDrilldown && item.accountIds?.length ? <button type="button" onClick={() => onDrilldown(item.accountIds ?? [], item.name, item.journalIds)} title="Open this account's General Ledger" className="text-left font-medium text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900">{item.name}</button> : <span className="font-medium text-slate-800">{item.name}</span>}
            {item.detailType && normalized(item.detailType) !== normalized(item.name) && <span className="ml-2 text-[11px] text-slate-500">{item.detailType}</span>}
          </td>
          <td className="px-4 py-1.5 text-right font-mono text-xs">
            {onDrilldown && item.accountIds?.length ? <button type="button" onClick={() => onDrilldown(item.accountIds ?? [], item.name, item.journalIds)} title="Open this account's General Ledger" className="text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900">{formatCurrency(item.amount)}</button> : <span className="text-slate-800">{formatCurrency(item.amount)}</span>}
          </td>
        </tr>
      ))}
      <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
        <td className="py-1.5 pr-4 pl-7 text-xs">Total {title}</td>
        <td className="px-4 py-1.5 text-right font-mono text-xs">{onDrilldown && sectionAccountIds.length ? <button type="button" onClick={() => onDrilldown(sectionAccountIds, title)} className="text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900">{formatCurrency(section.total)}</button> : formatCurrency(section.total)}</td>
      </tr>
    </>
  );
}

function ResultRow({ label, amount, onClick }: {
  label: string;
  amount: number;
  prominent?: boolean;
  onClick?: () => void;
}) {
  return (
    <tr className="border-t-2 border-slate-600 bg-slate-50 text-slate-900">
      <th scope="row" className="py-2 pr-4 pl-4 text-left text-xs font-bold uppercase tracking-wide">{label}</th>
      <td className="px-4 py-2 text-right font-mono text-xs font-bold">
        {onClick ? <button type="button" onClick={onClick} title="Open contributing posted ledger entries" className="cursor-pointer text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900">{formatCurrency(amount)}</button> : formatCurrency(amount)}
      </td>
    </tr>
  );
}

export default function ProfitLoss() {
  const navigate = useNavigate();
  const {activeBusinessUnit,activeCompany}=useAuth();
  const [data, setData] = useState<PLData>(emptyPLData);
  const [drilldown, setDrilldown] = useState<PLDrilldown | null>(null);
  const [drilldownRows, setDrilldownRows] = useState<LedgerRow[]>([]);
  const [drilldownAccountNames, setDrilldownAccountNames] = useState<Record<string,string>>({});
  const [drilldownJournals, setDrilldownJournals] = useState<Record<string,JournalMeta>>({});
  const [fromDate, setFromDate] = useState(getYearStart);
  const [toDate, setToDate] = useState(getLocalToday);
  const [hideZeroBalances, setHideZeroBalances] = useState(true);
  const [presentationView, setPresentationView] = useState<"classified" | "detailed" | "summary">("classified");
  const [scope,setScope]=useState<AccountingReportScope>('branch');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportPrintSettings, setReportPrintSettings] = useState<any>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [transportIncome,setTransportIncome]=useState<{sales:number;mappedSales:number;service:number;other:number;vehicleLedgerTotal:number;vehicleLedgerAdjustment:number;vehicleLedgerAccounts:{account_id:string;account_name:string;vehicle_no:string;truck_type:string;debit:number;credit:number;net:number}[];dedicatedSales:number;vehicles:VehicleIncome[];residual:number;vehicleError:string;salesAccountIds:string[];serviceAccountIds:string[];serviceVehicleAccountIds:string[];serviceSalesAdjustments:{accountId:string;amount:number}[]}|null>(null);
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
    let vehicleResult: {rows:Array<{vehicle_id:string;vehicle_no:string;amount:number|string}>;externalRows:ExternalAttributionRow[];vehicles:Array<{id:string;vehicle_no:string;revenue_account_id:string|null;truck_type:string|null}>;error:string} = {rows:[],externalRows:[],vehicles:[],error:''};
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
                const vehicles=await fetchAllPages<{id:string;vehicle_no:string;revenue_account_id:string|null;truck_type:string|null}>(
                  (from,to)=>{
                    let q=supabase.from('transport_vehicles').select('id,vehicle_no,revenue_account_id,truck_type')
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
    // Carry-forward balances belong on the Balance Sheet; exclude the RPC row dated fromDate - 1.
    const ledgerLines = rawLedger.filter((line) => line.entry_date >= fromDate && (!line.journal_entry_id || !closingJournalIds.has(line.journal_entry_id)));
    const vehicleLedgerLines = ledgerLines;
    const presentationLedgerLines=ledgerLines;

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
        if (account.bucket && !account.isGroup && account.isActive) {
          bucketMaps[account.bucket].set(account.id, { name: account.name, amount: 0, detailType: account.detailType, accountIds: [account.id] });
        }
      });
    }

    presentationLedgerLines.forEach((line) => {
      if (!line.account_id) return;
      const account = accountMap.get(line.account_id);
      if (!account?.bucket) return;
      const debit = Number(line.debit ?? 0);
      const credit = Number(line.credit ?? 0);
      const movement = account.type === "revenue" || account.type === "income" ? credit - debit : debit - credit;
      const current = bucketMaps[account.bucket].get(line.account_id);
      bucketMaps[account.bucket].set(line.account_id, {
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
        const {sales:mappedSales,service:mappedService}=splitTransportRevenue(presentationLedgerLines,salesAccountId,serviceAccountId);
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
          account_id:vehicleResult.vehicles.find(vehicle=>vehicle.id===row.id)?.revenue_account_id??null,
        }));
        const service=mappedService;
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
        const vehicleLedgerAccounts=vehicleResult.error?[]:linkedVehicleRows
          .filter(row=>row.status==='dedicated')
          .map(row=>{
            const accountId=vehicleResult.vehicles.find(vehicle=>vehicle.id===row.vehicle_id)?.revenue_account_id;
            const movements=vehicleLedgerLines.filter(line=>line.account_id===accountId);
            const debit=Number(movements.reduce((sum,line)=>sum+Number(line.debit??0),0).toFixed(2));
            const credit=Number(movements.reduce((sum,line)=>sum+Number(line.credit??0),0).toFixed(2));
            const accountName=accounts.find(account=>account.id===accountId)?.name??row.vehicle_no;
            const vehicle=vehicleResult.vehicles.find(item=>item.id===row.vehicle_id);
            return {account_id:accountId??'',account_name:accountName,
              vehicle_no:row.vehicle_no,truck_type:vehicle?.truck_type?.trim()||accountName.replace(row.vehicle_no,'').trim().replace(/[\\s–—-]+$/,''),
              debit,credit,net:Number((credit-debit).toFixed(2))};
          }).filter(row=>!hideZeroBalances||Math.abs(row.net)>=0.005)
            .sort((a,b)=>a.vehicle_no.localeCompare(b.vehicle_no,undefined,{numeric:true}));
        const incomeSources=reconcileTransportProfitLossSources(
          next.operatingRevenue.total+next.otherIncome.total,sales,service,vehicleLedgerTotal,dedicatedSales,
        );
        const vehicleLedgerAdjustment=incomeSources.vehicleLedgerAdjustment;
        const combinedVehicles=vehicleResult.error?breakdown.vehicles:
          mergeVehicleLedgerMovements(breakdown.vehicles,vehicleLedgerRows,false);
        const vehicleAmounts=new Map(combinedVehicles.map(row=>[row.vehicle_id,row]));
        const allCompanyVehicleRows=vehicleResult.vehicles.map(vehicle=>{
          const income=vehicleAmounts.get(vehicle.id);
          return {vehicle_id:vehicle.id,vehicle_no:vehicle.vehicle_no,amount:Number((income?.amount??0).toFixed(2))};
        }).sort((a,b)=>a.vehicle_no.localeCompare(b.vehicle_no,undefined,{numeric:true}));
        const serviceAccountIds=new Set<string>();
        if(serviceAccountId)serviceAccountIds.add(serviceAccountId);
        setTransportIncome({
          sales,mappedSales,service,
          // Revenue classifications must add back to the posted GL total exactly once.
          other:incomeSources.otherIncome,
          vehicleLedgerTotal,vehicleLedgerAdjustment,vehicleLedgerAccounts,dedicatedSales,
          vehicles:allCompanyVehicleRows,
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

  // P&L exports show account balances, with each vehicle ledger netted once.
  const revenueExportRows:(string|number)[][]=isTransport&&transportIncome?[
    ...transportIncome.vehicleLedgerAccounts.map(row=>['Income — Vehicles',row.vehicle_no,row.net] as (string|number)[]),
    ...[...data.operatingRevenue.items,...data.otherIncome.items]
      .filter(item=>!(item.accountIds??[]).some(id=>transportIncome.vehicleLedgerAccounts.some(vehicle=>vehicle.account_id===id)))
      .map(item=>['Other Income',item.name,item.amount] as (string|number)[]),
    ['Income','Total Income',metrics.totalIncome],
  ]:printSectionRows('Operating Revenue',data.operatingRevenue);

  const openDrilldown=(accountIds:string[],_title:string,_journalIds?:string[],_excludeJournalIds?:string[] )=>{
    const uniqueIds=[...new Set(accountIds.filter(Boolean))];
    if(!uniqueIds.length)return;
    const params=new URLSearchParams({from:fromDate,to:toDate});
    if(uniqueIds.length===1)params.set("account",uniqueIds[0]);
    navigate(`/accounting/ledgers?${params.toString()}`);
  };
  const pAndLAccountIds=(...sections:PLSectionData[])=>[...new Set(sections.flatMap(section=>section.items.flatMap(item=>item.accountIds??[])))];
  const visibleDrilldownRows=drilldown?drilldownRows.filter(line=>Boolean(line.account_id)
    &&drilldown.accountIds.includes(line.account_id!)
    &&(!drilldown.journalIds?.length||Boolean(line.journal_entry_id&&drilldown.journalIds.includes(line.journal_entry_id)))
    &&(!drilldown.excludeJournalIds?.length||!line.journal_entry_id||!drilldown.excludeJournalIds.includes(line.journal_entry_id))):[];

  const vehicleAccountIds=new Set(transportIncome?.vehicleLedgerAccounts.map(row=>row.account_id)??[]);
  const printableTransportIncomeRows=isTransport&&transportIncome?[
    ...transportIncome.vehicleLedgerAccounts.map(row=>({name:vehicleLedgerLabel(row.truck_type,row.vehicle_no,row.account_name),amount:row.net})),
    ...[...data.operatingRevenue.items,...data.otherIncome.items]
      .filter(row=>!(row.accountIds??[]).some(id=>vehicleAccountIds.has(id)))
      .map(row=>({name:row.name,amount:row.amount})),
  ]:[];
  const printableTransportExpenses=[...data.costOfSales.items,...data.operatingExpenses.items,...data.otherExpenses.items];

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
    <div className="mx-auto max-w-[1500px] space-y-4 pb-6"><AccountingReportScopeSelect value={scope} onChange={setScope}/>
      <style>{`@page{size:A4 portrait;margin:12mm}@media(max-width:640px){#printable-profit-loss section>div:first-child{align-items:flex-start;flex-wrap:wrap}#printable-profit-loss section>div:first-child h3{max-width:100%;white-space:normal;overflow-wrap:anywhere}#printable-profit-loss section .divide-y>div,#printable-profit-loss section .divide-y>button{align-items:flex-start}#printable-profit-loss .vehicle-ledger-drcr table{min-width:500px}}@media print{html,body{background:#fff!important;margin:0!important;padding:0!important}body *{visibility:hidden}#printable-profit-loss,#printable-profit-loss *{visibility:visible}#printable-profit-loss{position:absolute!important;left:0!important;top:0!important;width:100%!important;max-width:none!important;margin:0!important;padding:0!important;gap:10px!important;color:#111827!important}.no-print{display:none!important}#printable-profit-loss .profit-loss-screen{display:none!important}#printable-profit-loss .profit-loss-print-statement{display:block!important;break-inside:auto}#printable-profit-loss header{break-inside:avoid;page-break-inside:avoid;box-shadow:none!important}#printable-profit-loss section{break-inside:avoid;page-break-inside:avoid;box-shadow:none!important}#printable-profit-loss .vehicle-ledger-drcr{break-inside:auto;page-break-inside:auto}#printable-profit-loss .vehicle-ledger-drcr table{width:100%!important;min-width:0!important;table-layout:fixed;border-collapse:collapse!important;font-size:9pt!important}#printable-profit-loss .vehicle-ledger-drcr th,#printable-profit-loss .vehicle-ledger-drcr td{padding:5px 7px!important;border-bottom:1px solid #d1d5db!important;white-space:normal!important}#printable-profit-loss .vehicle-ledger-drcr thead{display:table-header-group}#printable-profit-loss .vehicle-ledger-drcr tr{break-inside:avoid;page-break-inside:avoid}#printable-profit-loss .vehicle-ledger-drcr .overflow-x-auto{overflow:visible!important}.profit-loss-print-statement table{width:100%;border-collapse:collapse;font-size:9pt;line-height:1.25}.profit-loss-print-statement th,.profit-loss-print-statement td{padding:4px 6px;border-bottom:1px solid #e1e5ea;text-align:left}.profit-loss-print-statement .pl-amount{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.profit-loss-print-statement .pl-band{background:#eef1f5;font-weight:700}.profit-loss-print-statement .pl-total{font-weight:700;border-top:1px solid #6b7280}.profit-loss-print-statement .pl-final{font-weight:800;border-top:1px solid #4b5563;border-bottom:3px double #4b5563;background:#eef1f5}.profit-loss-print-statement header{text-align:center;margin:0 0 14mm;border:0!important;padding:0!important;background:#fff!important}.profit-loss-print-statement header h1{font-size:15pt;margin:2mm 0;color:#27364a}.profit-loss-print-statement header p{font-size:9pt;margin:0;color:#475569}.no-print{display:none!important}}`}</style>

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

        {isTransport&&transportIncome&&<div className="profit-loss-print-statement hidden">
          <header>
            <div className="text-base font-bold">{reportPrintSettings?.company?.company_name||activeCompany?.company_name||'NAVILO'}</div>
            <h1>Profit and Loss</h1>
            <p>{formatReportDate(fromDate)} – {formatReportDate(toDate)}</p>
          </header>
          <table>
            <thead><tr><th>Account</th><th className="pl-amount">Total</th></tr></thead>
            <tbody>
              <tr className="pl-band"><td colSpan={2}>Income</td></tr>
              {printableTransportIncomeRows.map((row,index)=><tr key={`pl-income-${index}`}><td>{row.name}</td><td className="pl-amount">{formatCurrency(row.amount)}</td></tr>)}
              <tr className="pl-total"><td>Total for Income</td><td className="pl-amount">{formatCurrency(metrics.totalIncome)}</td></tr>
              <tr className="pl-band"><td colSpan={2}>Expenses</td></tr>
              {printableTransportExpenses.map((row,index)=><tr key={`pl-expense-${index}`}><td>{row.name}</td><td className="pl-amount">{formatCurrency(row.amount)}</td></tr>)}
              <tr className="pl-total"><td>Total for Expenses</td><td className="pl-amount">{formatCurrency(metrics.totalExpenses)}</td></tr>
              <tr className="pl-final"><td>Net Earnings</td><td className="pl-amount">{formatCurrency(metrics.netProfit)}</td></tr>
            </tbody>
          </table>
        </div>}

        <header className={`flex flex-col items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center ${isTransport?'profit-loss-screen':''}`}>
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

        <div className="no-print rounded-xl border border-slate-200 bg-white p-3 shadow-sm" data-report-filters>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.35fr_auto] lg:items-end">
            <label><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">From Date</span><NaviloDateInput type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
            <label><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">To Date</span><NaviloDateInput type="date" value={toDate} min={fromDate} max={getLocalToday()} onChange={(e) => setToDate(e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
            <label className="flex h-10 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3"><input type="checkbox" checked={hideZeroBalances} onChange={(e) => setHideZeroBalances(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" /><span className="text-sm font-medium text-slate-800">Hide zero-balance accounts</span></label>
            <label className="block" data-report-filter-label="Statement layout" data-report-filter-value={presentationView}><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Statement layout</span><SearchableSelect preserveLabel className="input h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" aria-label="Statement layout" searchPlaceholder="Search statement format..." value={presentationView} onChange={e=>setPresentationView(e.target.value as "classified"|"detailed"|"summary")}><option value="classified">Classified (default)</option><option value="summary">Summary · Group totals</option><option value="detailed">Detailed · Ledger classifications</option></SearchableSelect></label>
            <div className="flex gap-2"><button type="button" onClick={setThisMonth} className="h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">This Month</button><button type="button" onClick={setThisYear} className="h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">This Year</button></div>
          </div>
          {lastUpdated && <div className="mt-2 text-right text-[12px] text-slate-400">Posted operational ledger entries only · Updated {lastUpdated.toLocaleTimeString()}</div>}
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-slate-400 shadow-sm">Loading Profit & Loss statement...</div>
        ) : (
          <>
            <details data-print-primary-source data-report-orientation="portrait" className="no-print"><summary>Export / customize Profit and Loss</summary><ConfigurableReport module="accounting" preferenceKey="accounting-profit-loss" report={{title:'Profit and Loss',description:`${fromDate} to ${toDate} · Posted canonical ledger; monthly and year-end closing excluded`,columns:['Section','Account','Amount'],rows:[...revenueExportRows,...printSectionRows('Cost of Sales',data.costOfSales),['Result','Gross Profit / Loss',metrics.grossProfit],...printSectionRows('Operating Expenses',data.operatingExpenses),['Result','Operating Profit / Loss',metrics.operatingProfit],...(isTransport?[]:printSectionRows('Other Income',data.otherIncome)),...printSectionRows('Other Expenses',data.otherExpenses),['Result','Net Profit / Loss',metrics.netProfit]]}}/></details><div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" data-business-data>
              <div className="flex flex-col gap-1 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div><div className="text-sm font-bold text-slate-900">Statement of Profit and Loss</div><div className="mt-0.5 text-xs text-slate-500">For the period {formatReportDate(fromDate)} to {formatReportDate(toDate)}</div></div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse text-sm">
                  <thead><tr className="bg-white text-left text-xs uppercase tracking-wide text-slate-500"><th className="border-b border-slate-200 px-4 py-2 font-semibold">Account / Group</th><th className="border-b border-slate-200 px-4 py-2 text-right font-semibold">Amount</th></tr></thead>
                  <tbody>
                    {isTransport&&transportIncome?<>
                      <StatementSection title="Income — Vehicles" section={{total:transportIncome.vehicleLedgerAccounts.reduce((sum,row)=>sum+row.net,0),items:transportIncome.vehicleLedgerAccounts.map(row=>({name:vehicleLedgerLabel(row.truck_type,row.vehicle_no,row.account_name),amount:row.net,detailType:'Vehicle master → mapped Chart of Accounts ledger · selected period',accountIds:[row.account_id]}))}} tone="income" onDrilldown={openDrilldown} showDetails={presentationView!=="summary"} />
                      <StatementSection title="Other Income" section={{items:[...data.operatingRevenue.items,...data.otherIncome.items].filter(item=>!(item.accountIds??[]).some(id=>vehicleAccountIds.has(id))),total:[...data.operatingRevenue.items,...data.otherIncome.items].filter(item=>!(item.accountIds??[]).some(id=>vehicleAccountIds.has(id))).reduce((sum,item)=>sum+item.amount,0)}} tone="income" onDrilldown={openDrilldown} showDetails={presentationView!=="summary"} />
                      <StatementSection title="Expenses" section={{items:[...data.costOfSales.items,...data.operatingExpenses.items,...data.otherExpenses.items],total:metrics.totalExpenses}} tone="expense" onDrilldown={openDrilldown} showDetails={presentationView!=="summary"} />
                      <ResultRow label="Net Earnings" amount={metrics.netProfit} onClick={()=>openDrilldown(pAndLAccountIds(data.operatingRevenue,data.otherIncome,data.costOfSales,data.operatingExpenses,data.otherExpenses),"Net Earnings")} />
                    </>:<>
                      <StatementSection title="Operating Revenue" section={data.operatingRevenue} tone="income" onDrilldown={openDrilldown} showDetails={presentationView!=="summary"} />
                      <StatementSection title="Less: Cost of Sales" section={data.costOfSales} tone="expense" onDrilldown={openDrilldown} showDetails={presentationView!=="summary"} />
                      <ResultRow label="Gross Profit / (Loss)" amount={metrics.grossProfit} onClick={()=>openDrilldown(pAndLAccountIds(data.operatingRevenue,data.costOfSales),"Gross Profit / (Loss)")} />
                      <StatementSection title="Operating Expenses" section={data.operatingExpenses} tone="expense" onDrilldown={openDrilldown} showDetails={presentationView!=="summary"} />
                      <ResultRow label="Operating Profit / (Loss)" amount={metrics.operatingProfit} onClick={()=>openDrilldown(pAndLAccountIds(data.operatingRevenue,data.costOfSales,data.operatingExpenses),"Operating Profit / (Loss)")} />
                      {(data.otherIncome.items.length > 0 || !hideZeroBalances) && <StatementSection title="Other Income" section={data.otherIncome} tone="income" onDrilldown={openDrilldown} showDetails={presentationView!=="summary"} />}
                      {(data.otherExpenses.items.length > 0 || !hideZeroBalances) && <StatementSection title="Other Expenses" section={data.otherExpenses} tone="expense" onDrilldown={openDrilldown} showDetails={presentationView!=="summary"} />}
                      <ResultRow label="Net Profit / (Loss)" amount={metrics.netProfit} prominent onClick={()=>openDrilldown(pAndLAccountIds(data.operatingRevenue,data.costOfSales,data.operatingExpenses,data.otherIncome,data.otherExpenses),"Net Profit / (Loss)")} />
                    </>}
                    <tr className="border-t border-slate-300 bg-slate-50"><td className="py-1.5 px-4 text-xs font-semibold">Total Income</td><td className="px-4 py-1.5 text-right font-mono text-xs">{formatCurrency(metrics.totalIncome)}</td></tr>
                    <tr className="border-t border-slate-100"><td className="py-1.5 px-4 text-xs font-semibold">Total Expenses</td><td className="px-4 py-1.5 text-right font-mono text-xs">{formatCurrency(metrics.totalExpenses)}</td></tr>
                    <tr className="border-t border-slate-100"><td className="py-1.5 px-4 text-xs font-semibold">Net Margin</td><td className="px-4 py-1.5 text-right font-mono text-xs">{metrics.netMargin.toFixed(2)}%</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
        {reportPrintSettings && (
          <div className="mt-8 hidden border-t border-slate-300 pt-3 text-xs text-slate-500 print:block">
            {reportPrintSettings.visibility.show_footer && reportPrintSettings.company.document_footer && <div className="text-center">{reportPrintSettings.company.document_footer}</div>}
            {reportPrintSettings.visibility.show_signatures && <div className="mt-10 flex justify-between text-slate-700"><span>{reportPrintSettings.company.prepared_by_label || "Prepared By"}</span><span>{reportPrintSettings.company.checked_by_label || "Checked By"}</span><span>{reportPrintSettings.company.approved_by_label || "Approved By"}</span></div>}
            {reportPrintSettings.visibility.show_print_datetime && <div className="mt-4">Printed: {new Date().toLocaleString("en-PK")}</div>}
          </div>
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
                  {visibleDrilldownRows.map((line,index)=>{
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
                  {visibleDrilldownRows.length===0&&
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No posted ledger entries found for this row in the selected period.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

    </div>
  );
}
