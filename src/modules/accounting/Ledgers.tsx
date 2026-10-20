import {recordDisplayText} from '@/lib/recordDisplayText';
import {withOpeningBalances,statementClosing} from './ledgerStatementMath';
import {detailedTransportLedger,partySearchKey,type DetailedPartyLedger} from './transportLedgerRows';
import {registerPrintSource,showPrintDocument} from '@/lib/printDocument';
import {ledgerStatementPrintMarkup,type LedgerPrintRow} from '@/lib/ledgerStatementPrint';
import {useAuth} from '@/auth/AuthContext';
import type {PartyMovement} from '@/modules/transport/transportPartyReporting';
import {linkedPartyRows} from '@/modules/transport/transportOpeningInvoices';
import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchAllPages, fetchByIdChunks } from "@/lib/fetchAllPages";
import { supabase } from "@/lib/supabase";
import {
  Ledger,
  ChartOfAccount,
  Customer,
  Supplier,
  PartyType,
} from "@/types";
import {

  PageHeader,
  ErrorBanner,
  formatCurrency,
  formatDate,
} from "@/components/ui";

type ViewMode = "general" | "party";
type PartyFilterType = "all" | PartyType;

type LedgerRow = Ledger & {
  account?: ChartOfAccount | null;
};

type PartyLedgerRow = DetailedPartyLedger;

type TransportDetail = {
  order_id?: string | null;
  party_id?: string | null;
  kind?: string | null;
  side: PartyType;
  order_no?: string | null;
  trip_no?: string | null;
  trip_date?: string | null;
  from_location?: string | null;
  to_location?: string | null;
  vehicle_no?: string | null;
  driver_name?: string | null;
  owner_name?: string | null;
  po_do_job_no?: string | null;
  base_amount?: number | null;
  charge_amount?: number | null;
  tax_amount?: number | null;
  total_amount?: number | null;
  charge_breakdown?: string | null;
};

type TransportMovementLink = Partial<PartyMovement> & {
  order_id?: string | null;
  party_id?: string | null;
  event_type?: string | null;
  side: PartyType;
  journal_entry_id?: string | null;
  order_no?: string | null;
  trip_no?: string | null;
};

// Display the posted transaction date consistently in the GL table and exports.
const displayLedgerDate = (value: string | null | undefined): string => {
  if (!value) return "Date unavailable";
  const formatted = formatDate(value);
  return formatted && formatted !== "Invalid Date" ? formatted : value.slice(0, 10);
};

const PARTY_COLUMNS = [
  ["date", "Date"], ["party", "Party"], ["reference", "Reference"], ["documentRefs", "Linked invoices"],
  ["trip", "Trip"], ["from", "From"], ["to", "To"], ["vehicle", "Vehicle"],
  ["driver", "Driver"], ["owner", "Owner"], ["job", "Job / PO / DO"],
  ["sourceNet", "Source Net"], ["sourceTax", "Source Tax Difference"], ["sourceGross", "Source Gross"], ["sourceSettled", "Previously Settled"], ["sourceRemaining", "Opening Remaining"],
  ["description", "Description"], ["base", "Base Amount"], ["charges", "Charges"], ["tax", "VAT / Tax"], ["postedTotal", "Posted Total"], ["debit", "Debit"], ["credit", "Credit"], ["balance", "Balance"],
] as const;
type PartyColumnKey = (typeof PARTY_COLUMNS)[number][0];
// Party statements show posted accounting first, like the General Ledger.
const DEFAULT_PARTY_COLUMNS: PartyColumnKey[] = ["date","party","reference","description","debit","credit","balance"];
const DEFAULT_PARTY_COLUMN_ORDER: PartyColumnKey[] = [...DEFAULT_PARTY_COLUMNS,...PARTY_COLUMNS.map(([key])=>key).filter(key=>!DEFAULT_PARTY_COLUMNS.includes(key))];

const escapeCsv = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const signedBalanceLabel = (balance: number) => {
  if (Math.abs(balance) < 0.005) return formatCurrency(0);
  return balance > 0
    ? `${formatCurrency(Math.abs(balance))} Dr`
    : `${formatCurrency(Math.abs(balance))} Cr`;
};

export function buildTransportLedgerContext(transportDetails: TransportDetail[], transportMovements: TransportMovementLink[]) {
    const detailsByOrder = new Map<string, TransportDetail[]>();
    for (const detail of transportDetails) {
      if (!detail.order_no) continue;
      const key = detail.order_id?`${detail.side}:id:${detail.order_id}`:`${detail.side}:ref:${detail.party_id??''}:${detail.order_no}`;
      const list = detailsByOrder.get(key) || [];
      list.push(detail);
      detailsByOrder.set(key, list);
    }
    const ordersByJournal = new Map<string, Set<string>>();
    for (const movement of transportMovements) {
      if (!movement.journal_entry_id || !movement.order_no) continue;
      const set = ordersByJournal.get(movement.journal_entry_id) || new Set<string>();
      set.add(movement.order_id?`${movement.side}:id:${movement.order_id}`:`${movement.side}:ref:${movement.party_id??''}:${movement.order_no}`);
      ordersByJournal.set(movement.journal_entry_id, set);
    }
    const unique = (values: Array<string | null | undefined>) =>
      [...new Set(values.filter((value): value is string => !!value))].join(" / ");
    return (row: PartyLedgerRow | LedgerRow) => {
      const reference = "reference" in row ? row.reference : null;
      const orderNos = new Set<string>();
      const explicitOrder = "transport_order_id" in row ? row.transport_order_id : null;
      if(explicitOrder && "party_type" in row)orderNos.add(`${row.party_type}:id:${explicitOrder}`);
      if(!explicitOrder && reference && "party_type" in row){
        for(const [key,details] of detailsByOrder){const first=details[0];
          if(first.side===row.party_type && first.order_no===reference && (!first.party_id||first.party_id===row.party_id))orderNos.add(key);
        }
      }
      if (!explicitOrder && row.journal_entry_id) {
        for (const orderNo of ordersByJournal.get(row.journal_entry_id) || []) {
          const detail=detailsByOrder.get(orderNo)?.[0];
          if(!detail)continue;
          if("party_type" in row){if(detail.side!==row.party_type || (detail.party_id&&detail.party_id!==row.party_id))continue;}
          else if(detail.kind==='opening_balance')continue;
          orderNos.add(orderNo);
        }
      }
      const details = [...orderNos].flatMap((orderNo) => detailsByOrder.get(orderNo) || []).filter(d=>!("transport_trip_no" in row)||!row.transport_trip_no||d.trip_no===row.transport_trip_no);
      // Financial fields returned by transport_document_trip_detail_query are document-level
      // snapshots repeated on each Trip row. Sum each order once; Trip context remains multi-row.
      const financialDetails = [...orderNos].map((orderNo) => (detailsByOrder.get(orderNo) || [])[0]).filter((d): d is TransportDetail => Boolean(d)&&d?.kind!=='opening_balance');
      return {
        documentRefs: unique(details.map(d=>d.order_no)),
        trip: unique(details.map((d) => d.trip_no)),
        from: unique(details.map((d) => d.from_location)),
        to: unique(details.map((d) => d.to_location)),
        vehicle: unique(details.map((d) => d.vehicle_no)),
        driver: unique(details.map((d) => d.driver_name)),
        owner: unique(details.map((d) => d.owner_name)),
        job: unique(details.map((d) => d.po_do_job_no)),
        base: financialDetails.reduce((sum,d)=>sum+(Number(d.base_amount)||0),0),
        charges: financialDetails.reduce((sum,d)=>sum+(Number(d.charge_amount)||0),0),
        tax: financialDetails.reduce((sum,d)=>sum+(Number(d.tax_amount)||0),0),
        postedTotal: financialDetails.reduce((sum,d)=>sum+(Number(d.total_amount)||0),0),
        chargeBreakdown: unique(details.map((d)=>d.charge_breakdown)),
      };
    };
}

/** Normal statements exclude both sides of an owner-cancelled posting.
 * The posted evidence remains intact in the database and Owner Audit History.
 */
export function excludeOwnerCancelledLedgerRows<T extends { journal_entry_id?: string | null }>(
  rows: T[],
  cancelledJournalIds: ReadonlySet<string>,
): T[] {
  if (!cancelledJournalIds.size) return rows;
  return rows.filter((row) => !row.journal_entry_id || !cancelledJournalIds.has(row.journal_entry_id));
}

export default function Ledgers() {
  const {activeCompany,activeBusinessUnit,accessContext}=useAuth();
  const scope=accessContext as unknown as {current_operating_location?:{id?:string;operating_location_id?:string};operating_location_id?:string}|null;
  const branch=scope?.current_operating_location?.id??scope?.current_operating_location?.operating_location_id??scope?.operating_location_id;
  const [viewMode, setViewMode] = useState<ViewMode>("general");

  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [partyRows, setPartyRows] = useState<PartyLedgerRow[]>([]);
  const [openingBalances,setOpeningBalances]=useState<Record<string,number>>({});

  const [selectedAccount, setSelectedAccount] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [defaultSaved, setDefaultSaved] = useState(false);
  const [partyFilterType, setPartyFilterType] =
    useState<PartyFilterType>("all");
  const [selectedPartyKey, setSelectedPartyKey] = useState("");
  const [partySearch, setPartySearch] = useState("");
  const [loadAllParties,setLoadAllParties]=useState(false);
  const [showTripEvidence,setShowTripEvidence]=useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transportWarning, setTransportWarning] = useState<string | null>(null);
  const [transportDetails, setTransportDetails] = useState<TransportDetail[]>([]);
  const [transportMovements, setTransportMovements] = useState<PartyMovement[]>([]);
  const [partyPage,setPartyPage]=useState(0);
  const partyTableRef=useRef<HTMLTableElement|null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const partyColumnDragKey = useRef<PartyColumnKey | null>(null);
  // Resize is presentation-only. Ledger order, journal amounts and running balances
  // remain derived from the full canonical transaction sequence.
  const partyWidthScope=`navilo-ledger-party-widths:${activeCompany?.company_id??"none"}:${activeBusinessUnit?.business_unit_id??"none"}`;
  const [partyColumnWidths,setPartyColumnWidths]=useState<Partial<Record<PartyColumnKey,number>>>({});
  useEffect(()=>{
    try {
      const parsed=JSON.parse(localStorage.getItem(partyWidthScope)||"{}") as Record<string,number>;
      const valid=Object.fromEntries(Object.entries(parsed).filter(([k,v])=>PARTY_COLUMNS.some(([key])=>key===k)&&Number.isFinite(v)&&v>=72&&v<=700));
      setPartyColumnWidths(valid);
    } catch {setPartyColumnWidths({})}
  },[partyWidthScope]);
  const persistPartyColumnWidth=(key:PartyColumnKey,width:number)=>{
    setPartyColumnWidths(current=>{
      const next={...current,[key]:Math.max(72,Math.min(700,Math.round(width)))};
      try {localStorage.setItem(partyWidthScope,JSON.stringify(next))} catch {}
      return next;
    });
  };
  const beginPartyColumnResize=(event:React.PointerEvent<HTMLSpanElement>,key:PartyColumnKey)=>{
    event.stopPropagation();event.preventDefault();
    const target=event.currentTarget.parentElement;
    const base=partyColumnWidths[key]??target?.getBoundingClientRect().width??140;
    const startX=event.clientX;
    const move=(e:PointerEvent)=>persistPartyColumnWidth(key,base+e.clientX-startX);
    const stop=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",stop);window.removeEventListener("pointercancel",stop)};
    window.addEventListener("pointermove",move);
    window.addEventListener("pointerup",stop);
    window.addEventListener("pointercancel",stop);
  };
  const [partyColumnOrder, setPartyColumnOrder] = useState<PartyColumnKey[]>(() => {
    try {
      const saved = localStorage.getItem("navilo-ledger-party-column-order-v2");
      if (saved) {
        const parsed = JSON.parse(saved) as PartyColumnKey[];
        const allowed = new Set(PARTY_COLUMNS.map(([key]) => key));
        const valid = parsed.filter((key) => allowed.has(key));
        const missing = PARTY_COLUMNS.map(([key]) => key).filter((key) => !valid.includes(key));
        if (valid.length) return [...valid, ...missing];
      }
    } catch {}
    return DEFAULT_PARTY_COLUMN_ORDER;
  });
  const [visiblePartyColumns, setVisiblePartyColumns] = useState<PartyColumnKey[]>(() => {
    try {
      const saved = localStorage.getItem("navilo-ledger-party-columns-v2");
      if (saved) {
        const parsed = JSON.parse(saved) as PartyColumnKey[];
        const allowed = new Set(PARTY_COLUMNS.map(([key]) => key));
        const valid = parsed.filter((key) => allowed.has(key));
        if (valid.length) return [...new Set<PartyColumnKey>(valid)];
      }
    } catch {}
    return DEFAULT_PARTY_COLUMNS;
  });

  const fetchMasterData = useCallback(async () => {
    const [accountsResult, customersResult, suppliersResult] =
      await Promise.all([
        fetchAllPages<ChartOfAccount>((fromRow, toRow) =>
          supabase
            .from("chart_of_accounts")
            .select("*")
            .order("code", { ascending: true })
            .order("id", { ascending: true })
            .range(fromRow, toRow)
        ),
        fetchAllPages<Customer>((fromRow, toRow) =>
          supabase
            .from("customers")
            .select("*")
            .order("name", { ascending: true })
            .order("id", { ascending: true })
            .range(fromRow, toRow)
        ),
        fetchAllPages<Supplier>((fromRow, toRow) =>
          supabase
            .from("suppliers")
            .select("*")
            .order("name", { ascending: true })
            .order("id", { ascending: true })
            .range(fromRow, toRow)
        ),
      ]);

    setAccounts(accountsResult);
    setCustomers(customersResult);
    setSuppliers(suppliersResult);
  }, []);

  const fetchOwnerCancelledJournalIds = useCallback(async (): Promise<Set<string>> => {
    // Fail closed: showing cancelled financial rows as active records would be misleading.
    const { data, error: cancelledError } = await supabase.rpc("owner_cancelled_journal_ids");
    if (cancelledError) throw cancelledError;
    return new Set((data ?? []).map((row: { entry_id: string }) => row.entry_id));
  }, []);

  const fetchGeneralLedger = useCallback(async () => {
    const [data, excluded] = await Promise.all([
      fetchAllPages<LedgerRow>((fromRow, toRow) => {
        let query = supabase
          .from("ledgers")
          .select("*, account:chart_of_accounts(*)")
          .order("entry_date", { ascending: true })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true });

        if (selectedAccount) {
          query = query.eq("account_id", selectedAccount);
        }
        if (fromDate) query = query.gte("entry_date", fromDate);
        if (toDate) query = query.lte("entry_date", toDate);

        return query.range(fromRow, toRow);
      }),
      fetchOwnerCancelledJournalIds(),
    ]);

    setLedgerRows(excludeOwnerCancelledLedgerRows(data, excluded));
  }, [selectedAccount, fromDate, toDate, fetchOwnerCancelledJournalIds]);

  const fetchOpeningBalances=useCallback(async()=>{
    if(!fromDate||(viewMode==='party'&&!selectedPartyKey&&!loadAllParties)){setOpeningBalances({});return;}
    const {data,error}=await supabase.rpc('accounting_ledger_opening_balances_scoped',{
      p_before:fromDate,p_kind:viewMode,
    });
    if(error)throw error;
    const balances:Record<string,number>={};
    for(const record of data??[]){
      const key=viewMode==='general'
        ? 'account:'+record.account_id
        : 'party:'+record.party_type+':'+record.party_id;
      balances[key]=Number(record.opening_balance)||0;
    }
    setOpeningBalances(balances);
  },[fromDate,viewMode,selectedPartyKey,loadAllParties]);

  const fetchPartyLedger = useCallback(async () => {
    if(!selectedPartyKey&&!loadAllParties){setPartyRows([]);return;}
    const [data, excluded] = await Promise.all([
      fetchAllPages<PartyLedgerRow>((fromRow, toRow) => {
        let query = supabase
          .from("party_ledgers")
          .select("*")
          .order("entry_date", { ascending: true })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true });

        if (fromDate) query = query.gte("entry_date", fromDate);
        if (toDate) query = query.lte("entry_date", toDate);
        if (selectedPartyKey) {
          const [partyType, partyId] = selectedPartyKey.split(":") as [
            PartyType,
            string,
          ];

          query = query
            .eq("party_type", partyType)
            .eq("party_id", partyId);
        } else if (partyFilterType !== "all") {
          query = query.eq("party_type", partyFilterType);
        }

        return query.range(fromRow, toRow);
      }),
      fetchOwnerCancelledJournalIds(),
    ]);

    setPartyRows(excludeOwnerCancelledLedgerRows(data, excluded));
  }, [partyFilterType, selectedPartyKey, loadAllParties, fromDate, toDate, fetchOwnerCancelledJournalIds]);

  const transportRequest=useRef(0);
  const fetchTransportContext = useCallback(async () => {
    const request=++transportRequest.current;
    setTransportDetails([]);setTransportMovements([]);
    // Optional enrichment: never scan every party's Trips on page open.
    if(!showTripEvidence||!selectedPartyKey)return;
    const selected = selectedPartyKey ? selectedPartyKey.split(":") as [PartyType, string] : null;
    const sides: PartyType[] = selected ? [selected[0]] : partyFilterType === "all" ? ["customer", "supplier"] : [partyFilterType];
    setTransportWarning(null);
    const details: TransportDetail[] = [];
    const movements: PartyMovement[] = [];

    await Promise.all(sides.map(async (side) => {
      try {
        const allowed = await supabase.rpc("transport_financial_read_allowed", { p_side: side });
        if (allowed.error) throw allowed.error;
        if (allowed.data !== true) return;
        const party = selected?.[0] === side ? selected[1] : "";
        const [detailRows, movementRows,openingDetails] = await Promise.all([
          fetchAllPages<TransportDetail>((fromRow, toRow) =>
            supabase.rpc("transport_document_trip_detail_query", {
              p_side: side,
              p_filters: { party, to: "", search: "" },
              p_limit: toRow - fromRow + 1,
              p_offset: fromRow,
            })
          ),
          linkedPartyRows<PartyMovement>('movements',side,{party,to:'',search:''}),
          fetchAllPages<TransportDetail>((start,end)=>supabase.rpc('transport_opening_invoice_query',{p_kind:'details',p_side:side,p_filters:{party,to:'',search:''},p_limit:end-start+1,p_offset:start})),
        ]);
        details.push(...detailRows.map(row => ({ ...row, side })),...openingDetails.map(row=>({...row,side,kind:'opening_balance'})));
        movements.push(...movementRows.map(row => ({ ...row, side })));
      } catch {
        if(request===transportRequest.current)setTransportWarning("Transport trip and charge details could not be loaded. Ledger balances are available; refresh before relying on the trip details.");
      }
    }));

    if(request===transportRequest.current){setTransportDetails(details);setTransportMovements(movements);}
  }, [partyFilterType, selectedPartyKey,showTripEvidence,activeCompany?.company_id,activeBusinessUnit?.business_unit_id,branch]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("navilo-ledger-report-default");
      if (!saved) return;
      const data = JSON.parse(saved) as { fromDate?: string; toDate?: string; visiblePartyColumns?: PartyColumnKey[]; partyColumnOrder?: PartyColumnKey[];partyColumnVersion?:number };
      if (data.fromDate) setFromDate(data.fromDate);
      if (data.toDate) setToDate(data.toDate);
      const allowed = new Set(PARTY_COLUMNS.map(([key]) => key));
      if (data.partyColumnVersion===2&&Array.isArray(data.visiblePartyColumns)) {
        const valid = data.visiblePartyColumns.filter(key => allowed.has(key));
        if (valid.length) setVisiblePartyColumns(valid);
      }
      if (data.partyColumnVersion===2&&Array.isArray(data.partyColumnOrder)) {
        const valid = data.partyColumnOrder.filter(key => allowed.has(key));
        setPartyColumnOrder([...valid, ...PARTY_COLUMNS.map(([key]) => key).filter(key => !valid.includes(key))]);
      }
    } catch {}
  }, []);
  const setReportAsDefault = () => {
    try {
      localStorage.setItem("navilo-ledger-report-default", JSON.stringify({
        fromDate, toDate, visiblePartyColumns, partyColumnOrder, partyColumnVersion:2,
      }));
      setDefaultSaved(true);
    } catch {
      setError("Browser storage unavailable. Could not save report defaults.");
    }
  };
  useEffect(() => {
    try {
      localStorage.setItem("navilo-ledger-party-columns-v2", JSON.stringify(visiblePartyColumns));
      localStorage.setItem("navilo-ledger-party-column-order-v2", JSON.stringify(partyColumnOrder));
    } catch {}
  }, [visiblePartyColumns, partyColumnOrder]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setError(null);
        await fetchMasterData();
      } catch (err: any) {
        if (mounted) {
          setError(err?.message || "Failed to load ledger master data.");
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [fetchMasterData]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        // Clear previous selections before any async read: failed cancellation
        // filtering must never leave stale cancelled rows on screen.
        setLedgerRows([]);
        setPartyRows([]);
        setOpeningBalances({});

        if (viewMode === "general") {
          setTransportDetails([]);setTransportMovements([]);setTransportWarning(null);
          await Promise.all([fetchGeneralLedger(),fetchOpeningBalances()]);
        } else {
          await Promise.all([fetchPartyLedger(),fetchOpeningBalances()]);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err?.message || "Failed to load ledger entries.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
      transportRequest.current++;
    };
  }, [viewMode, fetchGeneralLedger, fetchPartyLedger, fetchOpeningBalances]);
  useEffect(()=>{
    if(viewMode!=='party'||!selectedPartyKey||!showTripEvidence){
      transportRequest.current++;
      setTransportDetails([]);setTransportMovements([]);setTransportWarning(null);
      return;
    }
    void fetchTransportContext();
    return ()=>{transportRequest.current++};
  },[viewMode,selectedPartyKey,showTripEvidence,fetchTransportContext]);

  const selectedAccountObj = useMemo(
    () => accounts.find((account) => account.id === selectedAccount) ?? null,
    [accounts, selectedAccount]
  );

  const partyOptions = useMemo(() => {
    const options: {
      key: string;
      type: PartyType;
      id: string;
      name: string;
      account_id?: string | null;
    }[] = [];

    if (partyFilterType === "all" || partyFilterType === "customer") {
      customers.forEach((customer) => {
        options.push({
          key: `customer:${customer.id}`,
          type: "customer",
          id: customer.id,
          name: customer.name,
          account_id: customer.account_id,
        });
      });
    }

    if (partyFilterType === "all" || partyFilterType === "supplier") {
      suppliers.forEach((supplier) => {
        options.push({
          key: `supplier:${supplier.id}`,
          type: "supplier",
          id: supplier.id,
          name: supplier.name,
          account_id: supplier.account_id,
        });
      });
    }

    return options.sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, suppliers, partyFilterType]);

  const filteredPartyOptions = useMemo(() => {
    const search = partySearchKey(partySearch);

    if (!search) {
      return partyOptions.slice(0, 50);
    }

    return partyOptions
      .filter((party) => {
        const typeLabel =
          party.type === "customer" ? "customer" : "supplier";

        return (
          partySearchKey(party.name).includes(search) ||
          typeLabel.includes(search)
        );
      })
      .slice(0, 50);
  }, [partyOptions, partySearch]);

  const selectedParty = useMemo(
    () => partyOptions.find((party) => party.key === selectedPartyKey) ?? null,
    [partyOptions, selectedPartyKey]
  );

  const getPartyName = useCallback(
    (partyType: PartyType | string, partyId: string) => {
      if (partyType === "customer") {
        return (
          customers.find((customer) => customer.id === partyId)?.name ??
          "Unknown Customer"
        );
      }

      if (partyType === "supplier") {
        return (
          suppliers.find((supplier) => supplier.id === partyId)?.name ??
          "Unknown Supplier"
        );
      }

      return "Unknown Party";
    },
    [customers, suppliers]
  );

  const generalRowsWithBalance = useMemo(() =>
    withOpeningBalances(ledgerRows,openingBalances,row=>'account:'+(row.account_id||'unassigned')),
    [ledgerRows,openingBalances]);

  const detailedRows=useMemo(()=>detailedTransportLedger(partyRows,transportMovements,transportDetails),[partyRows,transportMovements,transportDetails]);
  const filteredLedgerRows=useMemo(()=>detailedRows.rows.filter(row=>selectedPartyKey||!partySearchKey(partySearch)||partySearchKey(`${row.party_name||getPartyName(row.party_type,row.party_id)} ${row.party_type}`).includes(partySearchKey(partySearch))),[detailedRows,selectedPartyKey,partySearch,getPartyName]);
  useEffect(()=>setPartyPage(0),[partySearch,selectedPartyKey,partyFilterType,partyRows,transportMovements]);
  const partyRowsWithBalance=useMemo(()=>
    withOpeningBalances(filteredLedgerRows,openingBalances,row=>'party:'+row.party_type+':'+row.party_id)
      .map(row=>({...row,party_name:row.party_name||getPartyName(row.party_type,row.party_id)})),
    [filteredLedgerRows,openingBalances,getPartyName]);

  const transportInfoByJournal = useMemo(() => buildTransportLedgerContext(transportDetails, transportMovements), [transportDetails, transportMovements]);

  const orderedPartyColumns = partyColumnOrder
    .map((key) => PARTY_COLUMNS.find(([candidate]) => candidate === key))
    .filter((column): column is (typeof PARTY_COLUMNS)[number] => Boolean(column));
  const displayedPartyColumns = orderedPartyColumns.filter(([key]) => visiblePartyColumns.includes(key));
  const partyColumnVisible = (key: PartyColumnKey) => visiblePartyColumns.includes(key);
  const movePartyColumn = (source: PartyColumnKey, target: PartyColumnKey) => {
    if (source === target) return;
    setPartyColumnOrder((current) => {
      const next = current.filter((key) => key !== source);
      const index = next.indexOf(target);
      next.splice(index < 0 ? next.length : index, 0, source);
      return next;
    });
  };
  const togglePartyColumn = (key: PartyColumnKey) => {
    setVisiblePartyColumns((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : PARTY_COLUMNS.map(([item]) => item).filter((item) => item === key || current.includes(item))
    );
  };

  const totalDebit = useMemo(() => {
    const source = viewMode === "general" ? ledgerRows : filteredLedgerRows;
    return source.reduce((sum, row) => sum + (Number(row.debit) || 0), 0);
  }, [viewMode, ledgerRows, filteredLedgerRows]);

  const totalCredit = useMemo(() => {
    const source = viewMode === "general" ? ledgerRows : filteredLedgerRows;
    return source.reduce((sum, row) => sum + (Number(row.credit) || 0), 0);
  }, [viewMode, ledgerRows, filteredLedgerRows]);

  const openingBalance = viewMode==='general'
    ? (selectedAccount ? openingBalances['account:'+selectedAccount]??0 : 0)
    : (selectedPartyKey ? openingBalances['party:'+selectedPartyKey]??0 : 0);
  const statementBalance = openingBalance+totalDebit-totalCredit;

  const exportToExcel = () => {
    if (viewMode === "general") {
      const header =
        "Transaction Date,Account Name,Description,Debit,Credit,Balance\n";

      const body = generalRowsWithBalance
        .map((row) =>
          [
            escapeCsv(displayLedgerDate(row.entry_date)),
            escapeCsv(row.account?.name || ""),
            escapeCsv(recordDisplayText(row.description)),
            Number(row.debit) || 0,
            Number(row.credit) || 0,
            escapeCsv(signedBalanceLabel(Number(row.displayBalance) || 0)),
          ].join(",")
        )
        .join("\n");
      const openingLine=selectedAccount&&fromDate
        ? [escapeCsv(fromDate),escapeCsv(selectedAccountObj?.name||''),escapeCsv('Opening Balance'),'', '',escapeCsv(signedBalanceLabel(openingBalance))].join(',')+'\n'
        : '';
      const closingLine=selectedAccount
        ? '\n'+[escapeCsv(toDate||''),escapeCsv(selectedAccountObj?.name||''),escapeCsv('Closing Balance'),totalDebit,totalCredit,escapeCsv(signedBalanceLabel(statementBalance))].join(',')
        : '';

      const blob = new Blob([header + openingLine + body + closingLine], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `General_Ledger_${
        (selectedAccountObj?.name || "All_Accounts").replace(/[^a-zA-Z0-9 _-]/g,"").replace(/\s+/g,"_")
      }.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return;
    }

    const exportColumns = displayedPartyColumns;
    const header = exportColumns.map(([, label]) => escapeCsv(label)).join(",") + "\n";
    const body = partyRowsWithBalance.map((row) => {
      const transport = transportInfoByJournal(row);
      const values: Record<PartyColumnKey, unknown> = {
        date: row.entry_date, party: row.party_name || "", reference: row.reference || "",
        documentRefs: transport.documentRefs, trip: transport.trip, from: transport.from, to: transport.to, vehicle: transport.vehicle,
        driver: transport.driver, owner: transport.owner, job: transport.job,
        sourceNet:row.source_net??"",sourceTax:row.source_gross==null?"":Number(row.source_gross)-Number(row.source_net||0),sourceGross:row.source_gross??"",sourceSettled:row.source_settled??"",sourceRemaining:row.source_remaining??"",
        description: recordDisplayText(row.description), base: transport.base || "", charges: transport.charges || "", tax: transport.tax || "", postedTotal: transport.postedTotal || "", debit: Number(row.debit) || "", credit: Number(row.credit) || "",
        balance: signedBalanceLabel(Number(row.displayBalance) || 0),
      };
      return exportColumns.map(([key]) => escapeCsv(values[key])).join(",");
    }).join("\n");

    const openingCsv=selectedPartyKey&&fromDate
      ? exportColumns.map(([key])=>escapeCsv(key==='date'?fromDate:key==='party'?(selectedParty?.name||''):key==='description'?'Opening Balance':key==='balance'?signedBalanceLabel(openingBalance):'')).join(',')
      : '';
    const totalsCsv=exportColumns.map(([key])=>escapeCsv(
      key==='description'?'Period Total':
      key==='debit'?totalDebit:
      key==='credit'?totalCredit:
      key==='balance'?(selectedPartyKey?signedBalanceLabel(statementBalance):'Per Party'):''
    )).join(',');
    const finalCsv=[openingCsv,body,totalsCsv].filter(Boolean).join('\n');

    const blob = new Blob([header + finalCsv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Party_Statement_${
      selectedParty?.name.replace(/\s+/g, "_") || "All_Parties"
    }.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const compactBalance=(value:number)=>Math.abs(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+
    (value < -0.005?' Cr':value>0.005?' Dr':'');
  const buildLedgerPrint=useCallback(()=>{
    if(loading)throw new Error('Ledger details are loading. Wait before printing.');
    const single=viewMode==='general'?Boolean(selectedAccount):Boolean(selectedPartyKey);
    let rows:LedgerPrintRow[]=[];
    if(viewMode==='general'){
      rows=generalRowsWithBalance.map(row=>({
        date:displayLedgerDate(row.entry_date),party:row.account?.name||'',
        reference:'',description:recordDisplayText(row.description),
        debit:Number(row.debit)||0,credit:Number(row.credit)||0,
        balance:compactBalance(row.displayBalance)
      }));
    }else{
      rows=partyRowsWithBalance.map(row=>{
        const t=transportInfoByJournal(row);
        return {date:displayLedgerDate(row.entry_date),party:row.party_name||getPartyName(row.party_type,row.party_id),
          reference:row.reference||'',description:recordDisplayText(row.description),
          debit:Number(row.debit)||0,credit:Number(row.credit)||0,
          balance:compactBalance(row.displayBalance),
          trip:t.trip,from:t.from,to:t.to,vehicle:t.vehicle,invoice:t.documentRefs};
      });
    }
    return ledgerStatementPrintMarkup(rows,{
      title:viewMode==='general'?'General Ledger':selectedParty?.name?selectedParty.name+' — Party Statement':'Party Statement',
      companyName:activeCompany?.company_name,
      period:(fromDate||'All dates')+' to '+(toDate||'latest'),
      partySelected:single,
      groupLabel:viewMode==='general'?'Account':'Party',
      openingBalance:single&&fromDate?compactBalance(openingBalance):undefined,
      closingBalance:single?compactBalance(statementBalance):undefined,
      totalDebit,totalCredit,
    });
  },[loading,viewMode,selectedAccount,selectedPartyKey,generalRowsWithBalance,partyRowsWithBalance,
    transportInfoByJournal,getPartyName,activeCompany?.company_name,fromDate,toDate,openingBalance,
    statementBalance,totalDebit,totalCredit,selectedParty?.name]);
  useEffect(()=>{
    const table=partyTableRef.current;if(!table||viewMode!=='party')return;
    return registerPrintSource(table,()=>{
      const wrapper=document.createElement('div');
      wrapper.innerHTML=buildLedgerPrint();
      const statement=wrapper.querySelector('.navilo-ledger-financial-table');
      if(!statement)throw new Error('Financial statement table unavailable.');
      return statement.outerHTML;
    });
  },[viewMode,buildLedgerPrint]);

  const exportToPDF=()=>{
    try{showPrintDocument({html:buildLedgerPrint(),title:viewMode==='general'?'General Ledger':'Party Statement',orientation:'landscape'});}
    catch(e){setError(e instanceof Error?e.message:'Unable to prepare print report');}
  };

  const handlePartyTypeChange = (value: PartyFilterType) => {
    setPartyFilterType(value);
    setSelectedPartyKey("");
    setPartySearch("");
    setLoadAllParties(false);
    setShowTripEvidence(false);
  };

  const handleSelectParty = (partyKey: string, partyName: string) => {
    setSelectedPartyKey(partyKey);
    setPartySearch(partyName);
    setLoadAllParties(false);
    setShowTripEvidence(false);
  };

  const handleClearParty = () => {
    setSelectedPartyKey("");
    setPartySearch("");
    setLoadAllParties(false);
    setShowTripEvidence(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ledgers & Party Statements"
        subtitle="View posted General Ledger entries and customer / supplier statements"
        action={
          <div className="flex items-center gap-3 print:hidden">
            <button
              onClick={exportToExcel}
              disabled={loading||(viewMode==='party'&&!selectedPartyKey&&!loadAllParties)}
              className="px-3 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors flex items-center gap-1.5"
            >
              Export
            </button>

            <button
              onClick={exportToPDF}
              disabled={loading||(viewMode==='party'&&!selectedPartyKey&&!loadAllParties)}
              className="px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1.5"
            >
              Print / PDF
            </button>
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}
      {detailedRows.unmatched.length>0 && <p role="alert">Some imported invoice details do not reconcile with their posted voucher. Original posted rows are shown for those vouchers.</p>}
      {transportWarning && <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">{transportWarning}</p>}

      <div className="card p-4 print:hidden">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4">
          <div className="min-w-[220px]">
            <label className="label text-xs font-semibold text-slate-700 mb-1">
              Statement Type
            </label>

            <SearchableSelect
              className="input text-sm"
              value={viewMode}
              onChange={(e) => {setViewMode(e.target.value as ViewMode);setShowTripEvidence(false)}}
            >
              <option value="general">General Ledger</option>
              <option value="party">Party Statement</option>
            </SearchableSelect>
          </div>

          {!loading && (viewMode==='general'?(Boolean(fromDate)&&Boolean(selectedAccount)):Boolean(selectedPartyKey)) && (
          <p className="rounded border bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800" role="status">
            Opening Balance: {signedBalanceLabel(openingBalance)} · Period Debit: {formatCurrency(totalDebit)} · Period Credit: {formatCurrency(totalCredit)} · Closing Balance: {signedBalanceLabel(statementBalance)}
          </p>
        )}

        {viewMode === "general" ? (
            <div className="min-w-[340px] max-w-xl flex-1">
              <label className="label text-xs font-semibold text-slate-700 mb-1">
                Filter by Account
              </label>

              <SearchableSelect
                className="input text-sm"
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
              >
                <option value=""> All Accounts </option>

                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.type})
                  </option>
                ))}
              </SearchableSelect>
            </div>
          ) : (
            <>
              <div className="min-w-[220px]">
                <label className="label text-xs font-semibold text-slate-700 mb-1">
                  Party Type
                </label>

                <SearchableSelect
                  className="input text-sm"
                  value={partyFilterType}
                  onChange={(e) =>
                    handlePartyTypeChange(e.target.value as PartyFilterType)
                  }
                >
                  <option value="all">All Customers & Suppliers</option>
                  <option value="customer">Customers</option>
                  <option value="supplier">Suppliers</option>
                </SearchableSelect>
              </div>

              <div className="min-w-[340px] max-w-xl flex-1 relative">
                <label className="label text-xs font-semibold text-slate-700 mb-1">
                  Search Party
                </label>

                <div className="relative">
                  <input
                    className="input text-sm pr-20"
                    type="text"
                    placeholder="Type customer or supplier name..."
                    value={partySearch}
                    onChange={(e) => {
                      setPartySearch(e.target.value);
                      setSelectedPartyKey("");
                    }}
                  />

                  {(partySearch || selectedPartyKey) && (
                    <button
                      type="button"
                      onClick={handleClearParty}
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs font-medium text-slate-500 hover:text-slate-800"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {!selectedPartyKey && (
                  <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                    {filteredPartyOptions.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-slate-400">
                        No matching party found.
                      </div>
                    ) : (
                      filteredPartyOptions.map((party) => (
                        <button
                          key={party.key}
                          type="button"
                          onClick={() =>
                            handleSelectParty(party.key, party.name)
                          }
                          className="w-full px-3 py-2 text-left hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                        >
                          <div className="text-sm font-medium text-slate-900">
                            {party.name}
                          </div>
                          <div className="text-[12px] text-slate-400">
                            {party.type === "customer"
                              ? "Customer"
                              : "Supplier"}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-700">From Date
            <input type="date" value={fromDate} max={toDate || undefined} onChange={e => {setFromDate(e.target.value);setDefaultSaved(false);}} className="input mt-1 block text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-700">To Date
            <input type="date" value={toDate} min={fromDate || undefined} onChange={e => {setToDate(e.target.value);setDefaultSaved(false);}} className="input mt-1 block text-sm" />
          </label>
          <button type="button" onClick={() => {setFromDate("");setToDate("");setDefaultSaved(false);}} className="btn btn-secondary text-sm">All Dates</button>
          <button type="button" onClick={setReportAsDefault} className="btn btn-secondary text-sm">Set as Default</button>
          {defaultSaved && <span className="text-xs text-emerald-700">Saved on this browser</span>}
        </div>

        <div className="mt-3 text-xs text-slate-500">
          Ledger entries are read-only here. New accounting transactions must be
          created and posted through Journal Entries so posted history stays
          protected.
        </div>
      </div>

      <div className="card p-6 bg-white shadow-sm">
        <div className="border-b pb-4 mb-4 flex justify-between items-start gap-4">
          <div>
            <h3 className="font-bold text-slate-900 text-base">
              {viewMode === "general"
                ? selectedAccountObj
                  ? selectedAccountObj.name
                  : "General Ledger Statement"
                : selectedParty
                  ? `${selectedParty.name}  ${
                      selectedParty.type === "customer"
                        ? "Customer Statement"
                        : "Supplier Statement"
                    }`
                  : partyFilterType === "customer"
                    ? "All Customer Statements"
                    : partyFilterType === "supplier"
                      ? "All Supplier Statements"
                      : "All Party Statements"}
            </h3>

            <p className="text-xs text-slate-500 mt-1">
              {viewMode === "general"
                ? selectedAccountObj
                  ? `Account Type: ${selectedAccountObj.type}`
                  : "Posted journal activity across all General Ledger accounts"
                : selectedParty
                  ? `Party Type: ${
                      selectedParty.type === "customer" ? "Customer" : "Supplier"
                    }`
                  : "Customer and supplier subledger activity"}
            </p>
          </div>

          <div className="flex items-start gap-3">
            {viewMode === "party" && (
              <div className="relative print:hidden">
                <button type="button" className="btn btn-secondary" onClick={() => setShowColumns((value) => !value)}>
                  Columns
                </button>
                {showColumns && (
                  <div className="absolute right-0 z-40 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-xl">
                    <div className="mb-2 flex items-center justify-between">
                      <strong className="text-xs">Statement columns</strong>
                      <button type="button" className="text-xs text-blue-700" onClick={() => { setVisiblePartyColumns(DEFAULT_PARTY_COLUMNS); setPartyColumnOrder(DEFAULT_PARTY_COLUMN_ORDER); }}>Reset</button>
                    </div>
                    <div className="max-h-64 space-y-1 overflow-auto">
                      {PARTY_COLUMNS.map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 py-1 text-xs">
                          <input type="checkbox" checked={partyColumnVisible(key)} onChange={() => togglePartyColumn(key)} />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="text-right">
              <div className="text-xs text-slate-400">NAVILO</div>
              <div className="text-xs text-slate-500 mt-1">Read-only posted accounting records</div>
            </div>
          </div>
        </div>

        {viewMode === "general" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="text-left py-2.5 px-3 font-semibold whitespace-nowrap min-w-[110px]">Transaction Date</th>
                  <th className="text-left py-2.5 px-3 font-medium">Account</th>
                  <th className="text-left py-2.5 px-3 font-medium">Description</th>
                  <th className="text-right py-2.5 px-3 font-medium">Debit</th>
                  <th className="text-right py-2.5 px-3 font-medium">Credit</th>
                  <th className="text-right py-2.5 px-3 font-medium">Balance</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="text-center py-8 text-slate-400"
                    >
                      Loading General Ledger...
                    </td>
                  </tr>
                ) : generalRowsWithBalance.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="text-center py-8 text-slate-400"
                    >
                      No posted ledger entries found for this selection.
                    </td>
                  </tr>
                ) : (
                  generalRowsWithBalance.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-slate-100 hover:bg-slate-50/50"
                    >
                      <td className="py-2.5 px-3 text-slate-800 font-medium whitespace-nowrap tabular-nums">
                        <time dateTime={row.entry_date || undefined}>{displayLedgerDate(row.entry_date)}</time>
                      </td>

                      <td className="py-2.5 px-3 font-medium text-slate-900">
                        {row.account?.name || ""}
                      </td>

                      <td className="py-2.5 px-3 text-slate-700">
                        {recordDisplayText(row.description)}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {Number(row.debit) > 0
                          ? formatCurrency(Number(row.debit))
                          : ""}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {Number(row.credit) > 0
                          ? formatCurrency(Number(row.credit))
                          : ""}
                      </td>

                      <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                        {signedBalanceLabel(Number(row.displayBalance) || 0)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>

              {generalRowsWithBalance.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-200">
                    <td colSpan={3} className="py-3 px-3 text-right">
                      Total:
                    </td>
                    <td className="py-3 px-3 text-right">
                      {formatCurrency(totalDebit)}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {formatCurrency(totalCredit)}
                    </td>
                    <td className="py-3 px-3 text-right text-primary-700">
                      {selectedAccount
                        ? signedBalanceLabel(statementBalance)
                        : "Per Account"}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <p className="mb-2 text-sm text-slate-600">Posted Party Ledger · Debit, Credit and Running Balance follow original accounting entries. Imported invoice dates may be opening balance dates; original issue dates were not supplied.</p>
            {!selectedPartyKey&&!loadAllParties&&<div className="mb-3 flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"><span>Select a customer or supplier above for a fast statement.</span><button type="button" className="btn" disabled={loading} onClick={()=>setLoadAllParties(true)}>Load all parties (large report)</button></div>}
            {selectedPartyKey&&<div className="mb-3 flex flex-wrap items-center gap-3 text-xs"><button type="button" className="btn" onClick={()=>setShowTripEvidence(v=>!v)}>{showTripEvidence?'Hide Trip / Invoice Details':'Show Trip / Invoice Details'}</button><span className="text-slate-500">Optional source evidence; posted accounting balances remain unchanged.</span></div>}
            <div className="flex gap-3 p-2 print:hidden"><button disabled={!partyPage} onClick={()=>setPartyPage(p=>p-1)}>Previous</button><span>{partyPage*200+Math.min(partyRowsWithBalance.length,1)}–{Math.min((partyPage+1)*200,partyRowsWithBalance.length)} / {partyRowsWithBalance.length} rows</span><button disabled={(partyPage+1)*200>=partyRowsWithBalance.length} onClick={()=>setPartyPage(p=>p+1)}>Next</button><span>Print and export include all matching rows.</span></div>
            <table ref={partyTableRef} className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  {displayedPartyColumns.map(([key, label]) => (
                    <th key={key} draggable onDragStart={(e) => { partyColumnDragKey.current = key; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key); }} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={(e) => { e.preventDefault(); const source = partyColumnDragKey.current || e.dataTransfer.getData("text/plain") as PartyColumnKey; partyColumnDragKey.current = null; if (source) movePartyColumn(source, key); }} onDragEnd={() => { partyColumnDragKey.current = null; }} title="Drag left or right to reorder; resize from the right edge" style={partyColumnWidths[key] ? {width:partyColumnWidths[key],minWidth:partyColumnWidths[key]} : undefined} className={`relative cursor-grab select-none py-2.5 px-3 pr-5 font-semibold whitespace-nowrap active:cursor-grabbing ${["base","charges","tax","postedTotal","debit","credit","balance"].includes(key) ? "text-right" : "text-left"}`}>{label}<span role="separator" tabIndex={0} aria-orientation="vertical" aria-label={`Resize ${label} column`} title={`Resize ${label}`} className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-emerald-100 focus:bg-emerald-100" style={{touchAction:"none"}} onPointerDown={e=>beginPartyColumnResize(e,key)} onKeyDown={e=>{if(e.key==="ArrowRight"||e.key==="ArrowLeft"){e.stopPropagation();e.preventDefault();persistPartyColumnWidth(key,(partyColumnWidths[key]||140)+(e.key==="ArrowRight"?16:-16))}}}/></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={visiblePartyColumns.length} className="text-center py-8 text-slate-400">Loading Party Statement...</td></tr>
                ) : !selectedPartyKey&&!loadAllParties ? (
                  <tr><td colSpan={visiblePartyColumns.length} className="text-center py-8 text-slate-500">Select a party to view its ledger, or choose Load all parties.</td></tr>
                ) : partyRowsWithBalance.length === 0 ? (
                  <tr><td colSpan={visiblePartyColumns.length} className="text-center py-8 text-slate-400">No posted party ledger entries found for this selection.</td></tr>
                ) : partyRowsWithBalance.slice(partyPage*200,(partyPage+1)*200).map((row) => {
                  const transport = transportInfoByJournal(row);
                  const cells: Record<PartyColumnKey, ReactNode> = {
                    date: formatDate(row.entry_date),
                    party: <><div className="font-medium text-slate-900">{row.party_name || ""}</div><div className="text-[11px] text-slate-400 capitalize">{row.party_type}</div></>,
                    reference: row.reference || "",
                    documentRefs: transport.documentRefs, trip: transport.trip, from: transport.from, to: transport.to, vehicle: transport.vehicle,
                    driver: transport.driver, owner: transport.owner, job: transport.job,
                    sourceNet:row.source_net==null?"":formatCurrency(row.source_net),sourceTax:row.source_gross==null?"":formatCurrency(Number(row.source_gross)-Number(row.source_net||0)),sourceGross:row.source_gross==null?"":formatCurrency(row.source_gross),sourceSettled:row.source_settled==null?"":formatCurrency(row.source_settled),sourceRemaining:row.source_remaining==null?"":formatCurrency(row.source_remaining),
                    description: recordDisplayText(row.description),
                    base: transport.base ? formatCurrency(transport.base) : "",
                    charges: transport.charges ? <span title={transport.chargeBreakdown || undefined}>{formatCurrency(transport.charges)}</span> : "",
                    tax: transport.tax ? formatCurrency(transport.tax) : "",
                    postedTotal: transport.postedTotal ? formatCurrency(transport.postedTotal) : "",
                    debit: Number(row.debit) > 0 ? formatCurrency(Number(row.debit)) : "",
                    credit: Number(row.credit) > 0 ? formatCurrency(Number(row.credit)) : "",
                    balance: signedBalanceLabel(Number(row.displayBalance) || 0),
                  };
                  return (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                      {displayedPartyColumns.map(([key]) => (
                        <td key={key} style={partyColumnWidths[key] ? {width:partyColumnWidths[key],minWidth:partyColumnWidths[key]} : undefined} className={`py-2.5 px-3 ${key==="description"&&!partyColumnWidths[key]?"min-w-[180px]":"whitespace-nowrap"} ${["base","charges","tax","postedTotal","debit","credit","balance"].includes(key) ? "text-right" : "text-left"} ${key === "balance" ? "font-semibold text-slate-900" : "text-slate-700"}`}>
                          {cells[key]}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              {partyRowsWithBalance.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-200">
                    {displayedPartyColumns.map(([key], index) => (
                      <td key={key} style={partyColumnWidths[key] ? {width:partyColumnWidths[key],minWidth:partyColumnWidths[key]} : undefined} className={`py-2 px-2 ${["base","charges","tax","postedTotal","debit","credit","balance"].includes(key) ? "text-right" : ""}`}>
                        {key === "debit" ? formatCurrency(totalDebit) : key === "credit" ? formatCurrency(totalCredit) : key === "balance" ? (selectedPartyKey ? signedBalanceLabel(statementBalance) : "Per Party") : index === 0 ? "Total:" : ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
