Warning: truncated output (original token count: 26847)
Total output lines: 3183

import {recordDisplayText} from '@/lib/recordDisplayText';
import {useAuth} from '@/auth/AuthContext';
import NaviloDateInput from '@/components/NaviloDateInput';
import SearchableSelect from "@/components/SearchableSelect";
import QuickMasterAdd from "@/components/QuickMasterAdd";
import {
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";

import {
  useParams,
  useNavigate,
  Link,
} from "react-router-dom";

import * as XLSX from "xlsx";

import { supabase } from "@/lib/supabase";
import { fetchAllPages } from "@/lib/fetchAllPages";
import {vehicleDisplayLabel} from "@/lib/transportVehicleLabel";
import {journalRelatedToMode,vehicleOwnedOnDate,normalizedJournalVehicleNo,type OwnedPeriod} from "./journalRelatedTo";
import {isManualJournalAccountEligible,isManualJournalAccountVisible,manualJournalAccountRestriction} from "./manualJournalAccountPolicy";
import {accountForSelectedVehicle,journalVehicleAccountError,vehicleForIncomeAccount,isDedicatedVehicleIncomeAccount} from './journalVehicleIncomePolicy';

import {
  JournalEntry,
  JournalLine,
  ChartOfAccount,
  Customer,
  Supplier,
  PartyType,
} from "@/types";

import {
  ErrorBanner,
  StatusBadge,
  formatCurrency,
  formatDate,
  ConfirmModal,
  Modal,
} from "@/components/ui";

/* =========================================================
   TYPES
========================================================= */

type DraftLine = {
  tempId: string;
  accountId: string;
  vehicleId?: string;
  partyType: PartyType | "";
  partyId: string;
  debit: string;
  credit: string;
  description: string;
};

type ImportRow = {
  description: string;
  accountCode: string;
  accountName: string;
  partyType: PartyType | "";
  partyName: string;
  vehicleNo: string;
  debit: string;
  credit: string;
  rowNumber: number;
};

/* =========================================================
   HELPERS
========================================================= */

const createTempId = () =>
  `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

const createDraftLine = (): DraftLine => ({
  tempId: createTempId(),
  accountId: "",
  vehicleId: "",
  partyType: "",
  partyId: "",
  debit: "",
  credit: "",
  description: "",
});

const normalizeValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
};

const parseAmount = (value: unknown): number => {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  const cleaned = String(value)
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "");

  const number = Number(cleaned);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, number);
};

const normalizePartyType = (
  value: unknown
): PartyType | "" => {
  const normalized = normalizeValue(value).toLowerCase();

  if (
    normalized === "customer" ||
    normalized === "customers" ||
    normalized === "client"
  ) {
    return "customer";
  }

  if (
    normalized === "supplier" ||
    normalized === "suppliers" ||
    normalized === "vendor"
  ) {
    return "supplier";
  }

  return "";
};

/* =========================================================
   COMPONENT
========================================================= */

export default function JournalEntryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {activeCompany,activeBusinessUnit}=useAuth();
  const isTransport=activeBusinessUnit?.business_unit_type==='transport';
  const [companyVehicles,setCompanyVehicles]=useState<{id:string;vehicle_no:string;label:string;revenue_account_id:string|null}[]>([]);
  const [vehicleOwnership,setVehicleOwnership]=useState<OwnedPeriod[]>([]);
  const [vehicleLoadError,setVehicleLoadError]=useState('');
  useEffect(()=>{
    let live=true;setCompanyVehicles([]);setVehicleOwnership([]);setVehicleLoadError('');
    if(!isTransport||!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id)return;
    const cid=activeCompany.company_id,bid=activeBusinessUnit.business_unit_id;
    async function loadVehicles(){
      try{
        const [vehicles,ownership,types]=await Promise.all([
          fetchAllPages<{id:string;vehicle_no:string;revenue_account_id:string|null;truck_type_id:string|null;truck_type:string|null}>((start,end)=>
            supabase.from('transport_vehicles').select('id,vehicle_no,revenue_account_id,truck_type_id,truck_type')
              .eq('company_id',cid).eq('business_unit_id',bid).eq('is_active',true).order('id').range(start,end)),
          fetchAllPages<OwnedPeriod>((start,end)=>
            supabase.from('transport_vehicle_ownership').select('vehicle_id,owner_type,effective_from,effective_to')
              .eq('company_id',cid).eq('business_unit_id',bid).order('id').range(start,end)),
          fetchAllPages<{id:string;name:string}>((start,end)=>
            supabase.from('transport_truck_types').select('id,name')
              .eq('company_id',cid).eq('business_unit_id',bid).order('id').range(start,end)),
        ]);
        const names=new Map(types.map(t=>[t.id,t.name]));
        if(live){setVehicleOwnership(ownership);setCompanyVehicles(vehicles.map(v=>({
          id:v.id,vehicle_no:v.vehicle_no,revenue_account_id:v.revenue_account_id,label:vehicleDisplayLabel(v.vehicle_no,names.get(v.truck_type_id??'')??v.truck_type),
        })));}
      }catch(e:unknown){if(live)setVehicleLoadError(e instanceof Error?e.message:'Unable to load vehicle ownership history');}
    }
    void loadVehicles();
    return()=>{live=false};
  },[isTransport,activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);

  /* -------------------------------------------------------
     STATE
  ------------------------------------------------------- */

  const [entry, setEntry] =
    useState<JournalEntry | null>(null);
  const [draftEntryDate, setDraftEntryDate] = useState("");
  const [companyBaseCurrency, setCompanyBaseCurrency] = useState("");

  const [lines, setLines] =
    useState<JournalLine[]>([]);

  const [accounts, setAccounts] =
    useState<ChartOfAccount[]>([]);

  const [customers, setCustomers] =
    useState<Customer[]>([]);

  const [suppliers, setSuppliers] =
    useState<Supplier[]>([]);
  const [partyControlAccounts,setPartyControlAccounts]=useState<{ar:string;ap:string}>({ar:"",ap:""});

  const [draftLines, setDraftLines] =
    useState<DraftLine[]>([
      createDraftLine(),
    ]);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [posting, setPosting] =
    useState(false);

  const [importing, setImporting] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [success, setSuccess] =
    useState<string | null>(null);

  const [deleteLineId, setDeleteLineId] =
    useState<string | null>(null);

  const [deleteEntryOpen, setDeleteEntryOpen] =
    useState(false);

  const [permanentDeleteOpen, setPermanentDeleteOpen] = useState(false);
  const [permanentDeleteReason, setPermanentDeleteReason] = useState("");
  const [permanentDeleting, setPermanentDeleting] = useState(false);
  const handlePermanentDelete = async () => {
    if (!entry || permanentDeleteReason.trim().length < 10 || permanentDeleting) return;
    setPermanentDeleting(true);
    setError(null);
    try {
      const { data, error: deleteError } = await supabase.rpc("platform_admin_permanent_delete_manual_journal", {
        p_entry_id: entry.id,
        p_reason: permanentDeleteReason.trim(),
      });
      if (deleteError) throw new Error(deleteError.message);
      if (!data?.success) throw new Error("Permanent deletion was not confirmed.");
      setPermanentDeleteOpen(false);
      navigate("/accounting");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Permanent deletion failed. No deletion confirmed.");
    } finally {
      setPermanentDeleting(false);
    }
  };
  const [postedEditOpen,setPostedEditOpen] = useState(false);
  const [postedEditSaving,setPostedEditSaving] = useState(false);
  const [postedEditReason,setPostedEditReason] = useState("");
  const [postedEditDate,setPostedEditDate] = useState("");
  const [postedEditDescription,setPostedEditDescription] = useState("");
  const [postedEditLines,setPostedEditLines] = useState<{id:string;debit:string;credit:string;description:string}[]>([]);
  const [adminCanEditPosted,setAdminCanEditPosted] = useState(false);
  const openPostedEdit = () => {
    if (!entry) return;
    setPostedEditDate(entry.entry_date);setPostedEditDescription(entry.description || "");setPostedEditReason("");
    setDraftLines(lines.map(line=>({tempId:line.id,accountId:line.account_id || "",
      vehicleId:line.transport_vehicle_id || "",partyType:(line.party_type || "") as PartyType | "",
      partyId:line.party_id || "",debit:String(line.debit || 0),credit:String(line.credit || 0),
      description:("description" in line ? String(line.description || "") : "")})));
    setPostedEditOpen(true);
  };
  const savePostedEdit = async () => {
    if (!entry || postedEditSaving) return;
    setPostedEditSaving(true);setError(null);
    try {
      if(draftLines.length!==lines.length)throw new Error("Posted correction must retain original line count.");
      for(const line of draftLines){
        const original=lines.find(v=>v.id===line.tempId);
        if(!original || line.accountId!==original.account_id ||
          (line.vehicleId||null)!==(original.transport_vehicle_id||null) ||
          (line.partyId||null)!==(original.party_id||null))
          throw new Error("Account/vehicle/party remapping is not enabled yet; original entry unchanged.");
      }
      const {data,error:rpcError}=await supabase.rpc("owner_edit_posted_manual_journal",{
        p_entry_id:entry.id,p_reason:postedEditReason.trim(),p_entry_date:postedEditDate,
        p_description:postedEditDescription,p_lines:draftLines.map(line=>({
          id:line.tempId,description:line.description,debit:Number(line.debit),credit:Number(line.credit)
        }))
      });
      if(rpcError)throw new Error(rpcError.message);
      if(!data?.success)throw new Error("Save not confirmed");
      setPostedEditOpen(false);await Promise.all([fetchEntry(),fetchLines()]);
      setSuccess("Original posted journal updated without reversal.");
    }catch(err:unknown){setError(err instanceof Error?err.message:"Posted edit failed");}
    finally{setPostedEditSaving(false);}
  };
  const [ownerCanCancel, setOwnerCanCancel] = useState(false);
  const [ownerCancelOpen, setOwnerCancelOpen] = useState(false);
  const [ownerCancelling, setOwnerCancelling] = useState(false);
  const [ownerCancelDate, setOwnerCancelDate] = useState(new Date().toISOString().slice(0, 10));
  const [ownerCancelReason, setOwnerCancelReason] = useState("");
  useEffect(() => {
    let live = true;
    setOwnerCanCancel(false);
    if (!activeCompany?.company_id || !activeBusinessUnit?.business_unit_id) return;
    void supabase.rpc("company_can_permanently_delete").then(({ data, error }) => {
      if (live && !error) setOwnerCanCancel(data === true);
    });
    return () => { live = false; };
  }, [activeCompany?.company_id, activeBusinessUnit?.business_unit_id]);

  useEffect(() => {
    let live = true;
    setAdminCanEditPosted(false);
    if (!activeCompany?.company_id || !activeBusinessUnit?.business_unit_id) return;
    void supabase.rpc("company_admin_posted_journal_edit_access").then(({ data, error }) => {
      if (live && !error) setAdminCanEditPosted(data === true);
    });
    return () => { live = false; };
  }, [activeCompany?.company_id, activeBusinessUnit?.business_unit_id]);

  const [reversalEntry, setReversalEntry] = useState<{ id: string; entry_no: string } | null>(null);

  const fileInputRef =
    useRef<HTMLInputElement | null>(null);

  /* =========================================================
     FETCH JOURNAL ENTRY
  ========================================================= */

  const fetchEntry = useCallback(
    async () => {
      if (!id) return;

      const { data, error } =
        await supabase
          .from("journal_entries")
          .select("*")
          .eq("id", id)
          .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      setEntry(
        data as JournalEntry | null
      );
      setDraftEntryDate(data?.entry_date ?? "");
      if (data?.company_id) {
        const { data: company } = await supabase.from("companies")
          .select("base_currency_code").eq("id", data.company_id).maybeSingle();
        setCompanyBaseCurrency(company?.base_currency_code || "");
      }

      const { data: linkedReversal, error: reversalError } = await supabase
        .from("journal_entries")
        .select("id,entry_no")
        .eq("reversal_of_entry_id", id)
        .maybeSingle();

      if (reversalError) throw new Error(reversalError.message);
      setReversalEntry(linkedReversal as { id: string; entry_no: string } | null);
    },
    [id]
  );

  /* =========================================================
     FETCH JOURNAL LINES
  ========================================================= */

  const fetchLines = useCallback(
    async () => {
      if (!id) return;

      const { data, error } =
        await supabase
          .from("journal_lines")
          .select(`
            *,
            coa:chart_of_accounts(*)
          `)
          .eq("entry_id", id)
          .order("id", {
            ascending: true,
          });

      if (error) {
        throw new Error(error.message);
      }

      const mappedLines =
        (data ?? []).map(
          (line: any) => ({
            ...line,
            account_id:
              line.account_id,
            account:
              line.account ||
              (
                line.coa
                  ? `${line.coa.name}`
                  : ""
              ),
            party_type:
              line.party_type ?? null,
            party_id:
              line.party_id ?? null,
            party_name:
              line.party_name ?? null,
          })
        ) as JournalLine[];

      setLines(mappedLines.sort((a,b)=>Number(Number(b.debit)>0)-Number(Number(a.debit)>0)||a.id.localeCompare(b.id)));
    },
    [id]
  );

  /* =========================================================
     FETCH MASTER DATA
  ========================================================= */

  const fetchAccounts = useCallback(
    async () => {
      // A single PostgREST request is capped; fetch all COA rows with stable
      // ordering, including group/inactive rows for an accurate exclusion count.
      const data = await fetchAllPages<ChartOfAccount>((start, end) =>
        supabase
          .from("chart_of_accounts")
          .select("*")
          .order("code", { ascending: true })
          .order("id", { ascending: true })
          .range(start, end)
      );
      setAccounts(data);
    },
    []
  );

  const fetchCustomers = useCallback(async () => {
    setCustomers(await fetchAllPages<Customer>((start,end)=>supabase.from('customers')
      .select('*').eq('is_active',true).order('name').order('id').range(start,end)));
  },[]);

  const fetchSuppliers = useCallback(async () => {
    setSuppliers(await fetchAllPages<Supplier>((start,end)=>supabase.from('suppliers')
      .select('*').eq('is_active',true).order('name').order('id').range(start,end)));
  },[]);

  const fetchControlAccounts = useCallback(async () => {
    if(!activeCompany?.company_id){setPartyControlAccounts({ar:'',ap:''});return;}
    const {data,error}=await supabase.from('account_mappings')
      .select('mapping_key,account_id').eq('company_id',activeCompany.company_id)
      .in('mapping_key',['accounts_receivable','accounts_payable']);
    if(error)throw new Error(error.message);
    setPartyControlAccounts({
      ar:data?.find(r=>r.mapping_key==='accounts_receivable')?.account_id??'',
      ap:data?.find(r=>r.mapping_key==='accounts_payable')?.account_id??'',
    });
  },[activeCompany?.company_id]);

  /* =========================================================
     INITIAL LOAD
  ========================================================= */

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        await Promise.all([
          fetchEntry(),
          fetchLines(),
          fetchAccounts(),
          fetchCustomers(),
          fetchSuppliers(),
          fetchControlAccounts(),
        ]);
      } catch (err: any) {
        if (mounted) {
          setError(
            err?.message ||
              "Failed to load journal entry."
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [
    fetchEntry,
    fetchLines,
    fetchAccounts,
    fetchCustomers,
    fetchSuppliers,
    fetchControlAccounts,
  ]);

  /* =========================================================
     ACCOUNT / PARTY HELPERS
  ========================================================= */

  const manualAccountEligible = isManualJournalAccountEligible;

  const postingAccounts = accounts.filter(manualAccountEligible);
  const journalExcludedAccounts = accounts.length - postingAccounts.length;
  const visibleManualAccounts = accounts.filter(isManualJournalAccountVisible);
  const eligibleVehicles=companyVehicles.filter(v=>vehicleOwnedOnDate(v.id,entry?.status==='draft' ? draftEntryDate : entry?.entry_date,vehicleOwnership));

  const customerAccountIds =
    new Set(
      customers
        .map((customer) =>
          customer.account_id
        )
        .filter(
          (accountId): accountId is string =>
            !!accountId
        )
    );

  const supplierAccountIds =
    new Set(
      suppliers
        .map((supplier) =>
          supplier.account_id
        )
        .filter(
          (accountId): accountId is string =>
            !!accountId
        )
    );

  const accountRequiresParty = (
    accountId: string
  ) =>
    customerAccountIds.has(accountId) ||
    supplierAccountIds.has(accountId) ||
    (!!partyControlAccounts.ar && accountId===partyControlAccounts.ar) ||
    (!!partyControlAccounts.ap && accountId===partyControlAccounts.ap);

  const getPartyName = (
    partyType: PartyType | null | "",
    partyId: string | null | ""
  ) => {
    if (!partyType || !partyId) {
      return "";
    }

    if (partyType === "customer") {
      return (
        customers.find(
          (customer) =>
            customer.id === partyId
        )?.name ?? ""
      );
    }

    return (
      suppliers.find(
        (supplier) =>
          supplier.id === partyId
      )?.name ?? ""
    );
  };

  const getExistingLinePartyName = (
    line: JournalLine
  ) =>
    line.party_name ||
    getPartyName(
      line.party_type,
      line.party_id
    );

  const getPartyOptionsForAccount = (
    accountId: string
  ) => {
    const options: {
      key: string;
      type: PartyType;
      id: string;
      name: string;
    }[] = [];

    customers
      .filter(
        (customer) =>
          (customer.account_id === accountId || (!!partyControlAccounts.ar && accountId===partyControlAccounts.ar))
      )
      .forEach((customer) => {
        options.push({
          key: `customer:${customer.id}`,
          type: "customer",
          id: customer.id,
          name: customer.name,
        });
      });

    suppliers
      .filter(
        (supplier) =>
          (supplier.account_id === accountId || (!!partyControlAccounts.ap && accountId===partyControlAccounts.ap))
      )
      .forEach((supplier) => {
        options.push({
          key: `supplier:${supplier.id}`,
          type: "supplier",
          id: supplier.id,
          name: supplier.name,
        });
      });

    return options;
  };

  /* =========================================================
     TOTALS
  ========================================================= */

  const existingDebit =
    lines.reduce(
      (sum, line) =>
        sum +
        (Number(line.debit) || 0),
      0
    );

  const existingCredit =
    lines.reduce(
      (sum, line) =>
        sum +
        (Number(line.credit) || 0),
      0
    );

  const draftDebit =
    draftLines.reduce(
      (sum, line) =>
        sum +
        (Number(line.debit) || 0),
      0
    );

  const draftCredit =
    draftLines.reduce(
      (sum, line) =>
        sum +
        (Number(line.credit) || 0),
      0
    );

  const totalDebit =
    existingDebit + draftDebit;

  const totalCredit =
    existingCredit + draftCredit;

  const journalDisplayCurrency = entry?.currency_code && companyBaseCurrency
    ? (entry.status === "posted" ? companyBaseCurrency : entry.currency_code) : "";
  const formatJournalAmount = (amount: number) => journalDisplayCurrency && journalDisplayCurrency !== "PKR"
    ? `${journalDisplayCurrency} ${Number(amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : formatCurrency(amount);

  const difference =
    totalDebit - totalCredit;

  const activeDraftCount =
    draftLines.filter(
      (line) =>
        line.accountId ||
        line.partyId ||
        Number(line.debit) > 0 ||
        Number(line.credit) > 0
    ).length;

  // A zero/zero draft is not a balanced, postable journal.
  const hasAmounts = totalDebit > 0 || totalCredit > 0;
  const balanced =
    lines.length + activeDraftCount > 0 &&
    totalDebit > 0 && totalCredit > 0 &&
    Math.abs(difference) < 0.01;

  /* =========================================================
     UPDATE DRAFT LINE
  ========================================================= */

  const updateDraftLine = (
    tempId: string,
    field: keyof DraftLine,
    value: string
  ) => {
    setDraftLines((current) =>
      current.map((line) => {
        if (
          line.tempId !== tempId
        ) {
          return line;
        }

        if (field === "debit") {
          return {
            ...line,
            debit: value,
            credit:
              Number(value) > 0
                ? ""
                : line.credit,
          };
        }

        if (field === "credit") {
          return {
            ...line,
            credit: value,
            debit:
              Number(value) > 0
                ? ""
                : line.debit,
          };
        }

        if (field === "accountId") {
          const accountId = value;

          if (!accountId) {
            return {
              ...line,
              accountId: "",
              vehicleId: "",
              partyType: "",
              partyId: "",
            };
          }

          const partyStillMatches =
            (
              line.partyType === "customer" &&
              customers.some(
                (customer) =>
                  customer.id === line.partyId &&
                  (customer.account_id === accountId || (!!partyControlAccounts.ar && accountId===partyControlAccounts.ar))
              )
            ) ||
            (
              line.partyType === "supplier" &&
              suppliers.some(
                (supplier) =>
                  supplier.id === line.partyId &&
                  (supplier.account_id === accountId || (!!partyControlAccounts.ap && accountId===partyControlAccounts.ap))
              )
            );

          return {
            ...line,
            accountId,
            vehicleId: vehicleForIncomeAccount(accountId,companyVehicles,eligibleVehicles.map(v=>v.id)),
            partyType:
              partyStillMatches
                ? line.partyType
                : "",
            partyId:
              partyStillMatches
                ? line.partyId
                : "",
          };
        }

        if…14847 tokens truncated…sabled={postedEditSaving} onClick={()=>setPostedEditOpen(false)}>Cancel Edit</button>
              </div>}
              <div className="bg-blue-50 border-b border-blue-200 px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="font-bold text-slate-900">
                    {postedEditOpen ? "Edit Original Journal Entry" : "Fast Journal Entry"}
                  </h4>

                  <p className="text-xs text-slate-600 mt-0.5">
                    One Journal, one posting: select the GL Account. Related To is for genuine customer/supplier controls; vehicle selection is used only for eligible income lines. Expenses post directly to their expense account without a vehicle allocation.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={
                    handleAddRow
                  }
                  disabled={
                    saving ||
                    posting ||
                    importing
                  }
                  className="shrink-0 whitespace-nowrap px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg"
                >
                  + Add Row
                </button>
              </div>

              <div className="min-w-0 px-2 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                <span>{postingAccounts.length} accounts available for manual posting{journalExcludedAccounts > 0 ? ` · ${journalExcludedAccounts} accounts cannot be posted here (including group, inactive, invoice-only and VAT accounts)` : ""}. Restricted accounts appear disabled so you can still find them.</span>
                <div className="flex items-center gap-2"><QuickMasterAdd kind="account" compact disabled={saving||posting||importing} onRefresh={fetchAccounts}/><button type="button" className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50" data-navilo-keep-local-action="true" onClick={() => { void fetchAccounts().catch((e:unknown) => setError(e instanceof Error ? e.message : "Unable to refresh Chart of Accounts.")); }}>
                  Refresh Accounts
                </button></div>
              </div>
              <div className="w-full max-w-full min-w-0 overflow-x-auto" aria-label="Journal line editor">
                <table className="w-full table-fixed min-w-[690px] text-[12px]">
                  <colgroup>
                    <col style={{width:'26%'}} />
                     <col style={{width:'23%'}} />
                    <col style={{width:'23%'}} />
                    <col style={{width:'11%'}} />
                    <col style={{width:'11%'}} />
                    <col style={{width:'6%'}} />
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-2 py-2 font-semibold text-slate-600">Account</th>
                       <th className="text-left px-2 py-2 font-semibold text-slate-600">Line Description</th>

                      <th className="text-left px-2 py-2 font-semibold text-slate-600">
                        Related To (Party / Vehicle)
                      </th>

                      <th className="text-right px-2 py-2 font-semibold text-slate-600">Debit</th>

                      <th className="text-right px-2 py-2 font-semibold text-slate-600">Credit</th>

                      <th className="text-center px-1 py-2 font-semibold text-slate-600">
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {draftLines.map(
                      (line) => {
                        const partyOptions =
                          getPartyOptionsForAccount(
                            line.accountId
                          );

                        const partyRequired =
                          !!line.accountId &&
                          accountRequiresParty(
                            line.accountId
                          );
                        const selectedGL=accounts.find(a=>a.id===line.accountId);
                        const relatedMode=journalRelatedToMode(selectedGL?.type,partyRequired,isTransport);

                        return (
                          <tr
                            key={
                              line.tempId
                            }
                            className="border-b border-slate-100"
                          >
                            <td className="min-w-0 px-2 py-1.5">
                              <SearchableSelect
                                preserveLabel
                                className="input min-w-0 max-w-full bg-white w-full text-xs"
                                searchPlaceholder="Search account by name..."
                                emptyText="No posting account found"
                                value={
                                  line.accountId
                                }
                                onChange={(
                                  e
                                ) =>
                                  updateDraftLine(
                                    line.tempId,
                                    "accountId",
                                    e.target.value
                                  )
                                }
                              >
                                <option value="">
                                  Choose Posting Account...
                                </option>

                                {visibleManualAccounts.map(
                                  (
                                    account
                                  ) => (
                                    <option
                                      key={
                                        account.id
                                      }
                                      value={
                                        account.id
                                      }
                                      data-search={account.code}
                                      disabled={!manualAccountEligible(account)}
                                    >
                                      {account.name} ({account.type}){manualJournalAccountRestriction(account) ? ` · ${manualJournalAccountRestriction(account)}` : ""}
                                    </option>
                                  )
                                )}
                              </SearchableSelect>
                            </td>

                            <td className="min-w-0 px-2 py-1.5"><input className="input w-full text-xs" aria-label={`Description row ${draftLines.indexOf(line)+1}`} placeholder="Line description..." value={line.description} onChange={e=>updateDraftLine(line.tempId,"description",e.target.value)} maxLength={1000} /></td>
                            <td className="min-w-0 px-2 py-1.5">
                              {!line.accountId ? (
                                <span className="text-xs text-slate-500">Select account first</span>
                              ) : relatedMode==='party' ? (
                                <SearchableSelect
                                  preserveLabel
                                  aria-label={`Related To row ${draftLines.indexOf(line)+1}`}
                                  className="input min-w-0 max-w-full bg-white w-full text-xs"
                                  searchPlaceholder="Search customer or supplier..."
                                  emptyText="No linked customer / supplier found"
                                  value={line.partyType&&line.partyId?`${line.partyType}:${line.partyId}`:""}
                                  onChange={e=>updateDraftParty(line.tempId,e.target.value)}
                                >
                                  <option value="">Select Customer / Supplier...</option>
                                  {partyOptions.map(p=><option key={p.key} value={p.key}>
                                    {p.type==='customer'?'Customer':'Supplier'} · {p.name}
                                  </option>)}
                                </SearchableSelect>
                              ) : relatedMode==='vehicle' && isDedicatedVehicleIncomeAccount(
                                line.accountId,companyVehicles
                              ) ? (
                                <span className="block rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-600"
                                  title="This Account already identifies and links to the vehicle. No Related To selection is needed.">
                                  Vehicle is included in Account
                                </span>
                              ) : relatedMode==='vehicle' ? (
                                <div>
                                  <SearchableSelect
                                    preserveLabel
                                    aria-label={`Related To row ${draftLines.indexOf(line)+1}`}
                                    className="input min-w-0 max-w-full bg-white w-full text-xs"
                                    searchPlaceholder="Search company vehicle number or type..."
                                    value={line.vehicleId??""}
                                    onChange={e=>updateDraftLine(line.tempId,'vehicleId',e.target.value)}
                                  >
                                    <option value="">General / Shared (no vehicle)</option>
                                    {eligibleVehicles.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}
                                  </SearchableSelect>
                                  {vehicleLoadError&&<span role="alert" className="mt-1 block text-xs text-red-700">{vehicleLoadError}</span>}
                                  {!vehicleLoadError&&eligibleVehicles.length===0&&<span className="mt-1 block text-xs text-amber-700">No company-owned vehicle valid on this journal date</span>}
                                </div>
                              ) : (
                                <span
                                  className="block truncate text-xs text-slate-600"
                                  title={`Posts directly to ${selectedGL?.name ?? 'the selected account'}. No customer, supplier or vehicle allocation is required for this account.`}
                                >
                                  Direct to selected account
                                </span>
                              )}
                              {relatedMode==='party'&&partyRequired&&partyOptions.length===0&&(
                                <span className="mt-1 block text-xs text-amber-700">Set up a linked customer/supplier before posting.</span>
                              )}
                            </td>

                            <td className="min-w-0 px-2 py-1.5">
                              <input
                                className="input min-w-0 max-w-full bg-white font-mono text-right w-full text-xs px-2"
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                                value={
                                  line.debit
                                }
                                onChange={(
                                  e
                                ) =>
                                  updateDraftLine(
                                    line.tempId,
                                    "debit",
                                    e.target.value
                                  )
                                }
                              />
                            </td>

                            <td className="min-w-0 px-2 py-1.5">
                              <input
                                className="input min-w-0 max-w-full bg-white font-mono text-right w-full text-xs px-2"
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                                value={
                                  line.credit
                                }
                                onChange={(
                                  e
                                ) =>
                                  updateDraftLine(
                                    line.tempId,
                                    "credit",
                                    e.target.value
                                  )
                                }
                              />
                            </td>

                            <td className="min-w-0 px-1 py-1.5">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    relatedMode==='vehicle'
                                      ? handleSplitVehicleRow(line)
                                      : handleDuplicateRow(line)
                                  }
                                  disabled={
                                    saving ||
                                    posting ||
                                    importing
                                  }
                                  className="shrink-0 rounded bg-blue-50 px-1.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                                  aria-label={relatedMode==='vehicle'?'Split vehicle journal row':'Duplicate journal row'}
                                  title={relatedMode==='vehicle'?'Split amount across vehicles using another journal line':'Duplicate row'}
                                >
                                  {relatedMode==='vehicle'?'Split':'Copy'}
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    handleRemoveDraftRow(
                                      line.tempId
                                    )
                                  }
                                  disabled={
                                    saving ||
                                    posting ||
                                    importing
                                  }
                                  className="shrink-0 rounded bg-rose-50 px-1.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                                  aria-label="Remove journal row"
                                  title="Remove row"
                                >
                                  ✕
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }
                    )}
                  </tbody>

                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200">
                      <td
                        className="px-2 py-2 font-bold text-slate-900"
                        colSpan={3}
                      >
                        New Lines Total
                      </td>

                      <td className="px-2 py-2 text-right font-mono text-[11px] font-bold">
                        {formatJournalAmount(
                          draftDebit
                        )}
                      </td>

                      <td className="px-2 py-2 text-right font-mono text-[11px] font-bold">
                        {formatJournalAmount(
                          draftCredit
                        )}
                      </td>

                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="text-sm text-slate-600">
                  <span className="font-semibold">
                    {activeDraftCount}
                  </span>{" "}
                  {postedEditOpen ? "existing" : "new"} line
                  {activeDraftCount ===
                  1
                    ? ""
                    : "s"}
                </div>

                <button
                  type="button"
                  onClick={postedEditOpen ? () => void savePostedEdit() : handleSaveAllLines}
                  disabled={
                    saving ||
                    posting ||
                    importing ||
                    (postedEditOpen ? (postedEditSaving || postedEditReason.trim().length < 10) : (activeDraftCount === 0 && !hasUnsavedDraftDate))
                  }
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving
                    ? "Saving..."
                    : postedEditOpen ? "Save Original Journal" : "✓ Save Changes"}
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full">
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td className="py-4 px-4 font-bold text-slate-900">
                    Grand Total
                  </td>

                  <td className="py-4 px-4 text-right font-mono font-bold text-slate-900">
                    {formatJournalAmount(
                      totalDebit
                    )}
                  </td>

                  <td className="py-4 px-4 text-right font-mono font-bold text-slate-900">
                    {formatJournalAmount(
                      totalCredit
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {!isPosted && (
            <div
              className={`p-4 rounded-lg border text-sm ${
                balanced
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : "bg-amber-50 border-amber-200 text-amber-700"
              }`}
            >
              {!hasAmounts ? (
                <>No amounts entered yet. Add matching Debit and Credit lines before posting.</>
              ) : balanced ? (
                <>
                  <strong>
                    ✓ Journal is balanced.
                  </strong>{" "}
                  Total Debit and Total Credit are equal. Save all rows before posting.
                </>
              ) : (
                <>
                  <strong>
                    Journal is not balanced.
                  </strong>{" "}
                  Total Debit must equal Total Credit before posting.

                  {Math.abs(
                    difference
                  ) > 0.001 && (
                    <span className="ml-2 font-semibold">
                      Difference:{" "}
                      {formatJournalAmount(
                        Math.abs(
                          difference
                        )
                      )}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={
          !!deleteLineId
        }
        title="Remove Line"
        message="Are you sure you want to remove this journal line?"
        onConfirm={
          handleDeleteLine
        }
        onCancel={() =>
          setDeleteLineId(null)
        }
      />

      <Modal open={permanentDeleteOpen} title={`Permanent Delete · ${entry.entry_no}`}
        onClose={() => !permanentDeleting && setPermanentDeleteOpen(false)}>
        <div className="space-y-4">
          <p className="text-sm text-rose-700">
            This permanently removes the posted journal and its ledger effects. No reversal journal is created.
            An immutable audit snapshot is retained. Linked documents are blocked by the server.
          </p>
          <label className="block text-sm font-semibold">Reason (minimum 10 characters)</label>
          <textarea className="input w-full" rows={3} value={permanentDeleteReason}
            onChange={(event) => setPermanentDeleteReason(event.target.value)} />
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-secondary" disabled={permanentDeleting}
              onClick={() => setPermanentDeleteOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-danger" disabled={permanentDeleting || permanentDeleteReason.trim().length < 10}
              onClick={() => void handlePermanentDelete()}>
              {permanentDeleting ? "Deleting..." : "Confirm Permanent Delete"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={ownerCancelOpen} title={`Delete Posted Entry · ${entry.entry_no}`} onClose={() => !ownerCancelling && setOwnerCancelOpen(false)}>
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {isOwnerCancellableOpeningPayment ? "This posts an opposite journal and restores imported invoice and Trip balances. The original payment and allocation evidence remain in the audit trail." : "This action creates a permanent audit trail. The original posted journal remains locked, and an opposite posted journal offsets the financial effect. Allocated, transport-linked or FX payment vouchers are blocked until their specialized correction workflow is available."}
          </div>
          <div>
            <label className="label">Deletion / reversal date</label>
            <NaviloDateInput className="input" type="date" min={entry.entry_date} value={ownerCancelDate} onChange={(event) => setOwnerCancelDate(event.target.value)} />
          </div>
          <div>
            <label className="label">Mandatory Reason (minimum 10 characters)</label>
            <textarea className="input" rows={3} value={ownerCancelReason} onChange={(event) => setOwnerCancelReason(event.target.value)} placeholder="Why is this posted entry being deleted?" />
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" disabled={ownerCancelling} onClick={() => setOwnerCancelOpen(false)}>Keep Posted</button>
            <button className="px-3 py-2 rounded-lg bg-rose-700 text-white disabled:opacity-50" disabled={ownerCancelling || ownerCancelReason.trim().length < 10 || !ownerCancelDate || ownerCancelDate < entry.entry_date} onClick={() => void handleOwnerCancel()}>{ownerCancelling ? "Deleting…" : "Confirm Delete with Reversal"}</button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={
          deleteEntryOpen
        }
        title="Delete Journal Entry"
        message="Are you sure you want to delete this draft journal entry and all of its lines?"
        onConfirm={
          handleDeleteEntry
        }
        onCancel={() =>
          setDeleteEntryOpen(false)
        }
      />
    </div>
  );
}
