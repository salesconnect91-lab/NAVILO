import "./journalEntryDetail.css";
import {GripVertical,ChevronUp,ChevronDown,Copy,Trash2} from "lucide-react";
import JournalDescription from "./JournalDescription";
import {moveJournalRow,compareJournalLineOrder} from "./journalLinePresentation";
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
import {isManualJournalAccountEligible,isManualJournalAccountVisible,manualJournalAccountRestriction} from "./manualJournalAccountPolicy";

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
  const {activeCompany,activeBusinessUnit,isPlatformOwner}=useAuth();
  const isCompanyOwner=["owner","company_owner"].includes(activeCompany?.membership_role || "");

  /* -------------------------------------------------------
     STATE
  ------------------------------------------------------- */

  const [entry, setEntry] =
    useState<JournalEntry | null>(null);
  const [entryNumberDraft, setEntryNumberDraft] = useState("");
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
      partyType:(line.party_type || "") as PartyType | "",
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
          (line.partyId||null)!==(original.party_id||null))
          throw new Error("Account/party remapping is not enabled yet; original entry unchanged.");
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
    if (!activeCompany?.company_id || (!activeBusinessUnit?.business_unit_id && !isPlatformOwner)) return;
    void supabase.rpc("company_admin_posted_journal_edit_access").then(({ data, error }) => {
      if (live && !error) setAdminCanEditPosted(data === true);
    });
    return () => { live = false; };
  }, [activeCompany?.company_id, activeBusinessUnit?.business_unit_id, isPlatformOwner]);

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
      setEntryNumberDraft(data?.entry_no ?? "");
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

      setLines(mappedLines.sort(compareJournalLineOrder));
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

        return {
          ...line,
          [field]: value,
        };
      })
    );
  };

  const updateDraftParty = (
    tempId: string,
    value: string
  ) => {
    setDraftLines((current) =>
      current.map((line) => {
        if (
          line.tempId !== tempId
        ) {
          return line;
        }

        if (!value) {
          return {
            ...line,
            partyType: "",
            partyId: "",
          };
        }

        const [type, partyId] =
          value.split(":") as [
            PartyType,
            string
          ];

        if (
          type === "customer"
        ) {
          const customer =
            customers.find(
              (item) =>
                item.id === partyId
            );

          if (
            !customer ||
            (!customer.account_id && !partyControlAccounts.ar)
          ) {
            return line;
          }

          return {
            ...line,
            accountId:
              (line.accountId===partyControlAccounts.ar?line.accountId:customer.account_id??partyControlAccounts.ar),
            partyType: "customer",
            partyId:
              customer.id,
          };
        }

        const supplier =
          suppliers.find(
            (item) =>
              item.id === partyId
          );

        if (
          !supplier ||
          (!supplier.account_id && !partyControlAccounts.ap)
        ) {
          return line;
        }

        return {
          ...line,
          accountId:
            (line.accountId===partyControlAccounts.ap?line.accountId:supplier.account_id??partyControlAccounts.ap),
          partyType: "supplier",
          partyId:
            supplier.id,
        };
      })
    );
  };

  /* =========================================================
     ADD / DUPLICATE / REMOVE ROW
  ========================================================= */

  const [draggedDraftRow, setDraggedDraftRow] = useState<string | null>(null);
  const moveDraftRow = (sourceId: string, targetIndex: number) => {
    setDraftLines(current => moveJournalRow(current,sourceId,targetIndex));
  };

  const handleAddRow = () => {
    setDraftLines((current) => [
      ...current,
      createDraftLine(),
    ]);
  };

  const handleDuplicateRow = (
    line: DraftLine
  ) => {
    const duplicate: DraftLine = {
      ...line,
      tempId: createTempId(),
    };

    setDraftLines((current) => {
      const index =
        current.findIndex(
          (item) =>
            item.tempId ===
            line.tempId
        );

      const copy = [...current];

      copy.splice(
        index + 1,
        0,
        duplicate
      );

      return copy;
    });
  };

  const handleRemoveDraftRow = (
    tempId: string
  ) => {
    setDraftLines((current) => {
      const filtered =
        current.filter(
          (line) =>
            line.tempId !== tempId
        );

      if (filtered.length === 0) {
        return [
          createDraftLine(),
        ];
      }

      return filtered;
    });
  };

  const getActiveDraftLines =
    () =>
      draftLines.filter(
        (line) =>
          line.accountId ||
          line.partyId ||
          Number(line.debit) > 0 ||
          Number(line.credit) > 0
      );

  /* =========================================================
     DOWNLOAD EXCEL TEMPLATE
  ========================================================= */

  const handleDownloadTemplate =
    () => {
      try {
        // Same columns and mapping rules as the visible Fast Journal grid.
        // No invented account names or customers in examples.
        const worksheet = XLSX.utils.aoa_to_sheet([
          ["Account Name","Description","Party Type","Party Name","Debit","Credit"],
        ]);
        worksheet["!cols"] = [
          { wch: 35 },{ wch: 42 },{ wch: 18 },{ wch: 35 },{ wch: 18 },{ wch: 18 },
        ];

        const workbook =
          XLSX.utils.book_new();

        XLSX.utils.book_append_sheet(
          workbook,
          worksheet,
          "Journal Lines"
        );

        XLSX.writeFile(
          workbook,
          "journal_entry_template.xlsx"
        );

        setSuccess(
          "Excel template downloaded."
        );

        setError(null);
      } catch (err: any) {
        setError(
          err?.message ||
            "Failed to create Excel template."
        );
      }
    };

  /* =========================================================
     BULK EXCEL / CSV IMPORT
  ========================================================= */

  const handleBulkImport = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!entry) {
      return;
    }

    if (entry.status === "posted") {
      setError(
        "Posted journal entries cannot be modified."
      );

      event.target.value = "";
      return;
    }

    try {
      setImporting(true);
      setError(null);
      setSuccess(null);

      const buffer =
        await file.arrayBuffer();

      const workbook =
        XLSX.read(buffer, {
          type: "array",
        });

      const firstSheetName =
        workbook.SheetNames[0];

      if (!firstSheetName) {
        throw new Error(
          "The uploaded file does not contain a worksheet."
        );
      }

      const worksheet =
        workbook.Sheets[
          firstSheetName
        ];

      const rawRows =
        XLSX.utils.sheet_to_json<
          Record<string, unknown>
        >(worksheet, {
          defval: "",
        });

      if (
        !rawRows ||
        rawRows.length === 0
      ) {
        throw new Error(
          "The uploaded file is empty."
        );
      }

      const importedRows: ImportRow[] =
        [];

      const importErrors: string[] =
        [];

      rawRows.forEach(
        (rawRow, index) => {
          const rowNumber =
            index + 2;

          const keys =
            Object.keys(rawRow);

          const findColumn = (
            possibleNames: string[]
          ) => {
            const key =
              keys.find((item) =>
                possibleNames.some(
                  (name) =>
                    item
                      .toLowerCase()
                      .trim() ===
                    name
                      .toLowerCase()
                      .trim()
                )
              );

            return key
              ? rawRow[key]
              : "";
          };

          const lineDescription = normalizeValue(findColumn(["Description","Narration","Line Description"]));

          const accountCode =
            normalizeValue(
              findColumn([
                "Account Code",
                "account code",
                "Code",
                "code",
                "Account",
                "account",
              ])
            );

          const accountName =
            normalizeValue(
              findColumn([
                "Account Name",
                "account name",
              ])
            );

          const partyType =
            normalizePartyType(
              findColumn([
                "Party Type",
                "party type",
                "PartyType",
                "party_type",
              ])
            );

          const partyName =
            normalizeValue(
              findColumn([
                "Party Name",
                "party name",
                "Party",
                "party",
                "Name",
                "name",
              ])
            );

          const vehicleNo=normalizeValue(findColumn(['Vehicle No','Vehicle Number','Vehicle','vehicle_no']));
          const debit =
            parseAmount(
              findColumn([
                "Debit",
                "debit",
                "Dr",
                "dr",
              ])
            );

          const credit =
            parseAmount(
              findColumn([
                "Credit",
                "credit",
                "Cr",
                "cr",
              ])
            );

          const isEmptyRow =
            !accountCode &&
            !accountName &&
            !partyType &&
            !partyName &&
            !vehicleNo &&
            debit === 0 &&
            credit === 0;

          if (isEmptyRow) {
            return;
          }

          if(vehicleNo){
            importErrors.push(`Row ${rowNumber}: Vehicle allocation is not part of General Journal. Use Transport Vehicle Expenses for vehicle-specific costs.`);
            return;
          }

          if (!accountCode && !accountName) {
            importErrors.push(
              `Row ${rowNumber}: Account Name is required.`
            );

            return;
          }

          if (
            debit > 0 &&
            credit > 0
          ) {
            importErrors.push(
              `Row ${rowNumber}: Debit and Credit cannot both have values.`
            );

            return;
          }

          if (
            debit <= 0 &&
            credit <= 0
          ) {
            importErrors.push(
              `Row ${rowNumber}: Enter either Debit or Credit.`
            );

            return;
          }

          const matches = accountCode
            ? accounts.filter(item => String(item.code).trim() === accountCode)
            : accounts.filter(item => item.name.trim().toLowerCase() === accountName.trim().toLowerCase());
          if (matches.length !== 1) {
            importErrors.push(
              `Row ${rowNumber}: Select an existing unique Account Name in Chart of Accounts.`
            );
            return;
          }
          const account = matches[0];

          if (account.is_group) {
            importErrors.push(
              `Row ${rowNumber}: "${account.name}" is a group account.`
            );

            return;
          }

          if (!account.is_active) {
            importErrors.push(
              `Row ${rowNumber}: "${account.name}" is inactive.`
            );

            return;
          }

          if (
            !manualAccountEligible(account)
          ) {
            importErrors.push(
              `Row ${rowNumber}: "${account.name}" does not allow manual journal entries.`
            );

            return;
          }

          if (
            accountRequiresParty(account.id) &&
            (!partyType || !partyName)
          ) {
            importErrors.push(
              `Row ${rowNumber}: "${account.name}" requires Party Type and Party Name.`
            );

            return;
          }

          if (
            (partyType && !partyName) ||
            (!partyType && partyName)
          ) {
            importErrors.push(
              `Row ${rowNumber}: Party Type and Party Name must be entered together.`
            );

            return;
          }

          if (partyType && (partyType === "customer" ? customers : suppliers).filter(item =>
            item.name.trim().toLowerCase() === partyName.trim().toLowerCase()
          ).length > 1) {
            importErrors.push(`Row ${rowNumber}: More than one ${partyType} matches "${partyName}". Use a unique master name or select the correct party manually.`);
            return;
          }

          if (
            partyType === "customer"
          ) {
            const customer =
              customers.find(
                (item) =>
                  item.name
                    .trim()
                    .toLowerCase() ===
                  partyName
                    .trim()
                    .toLowerCase()
              );

            if (!customer) {
              importErrors.push(
                `Row ${rowNumber}: Customer "${partyName}" was not found.`
              );

              return;
            }

            if (
              customer.account_id !==
              account.id && account.id!==partyControlAccounts.ar
            ) {
              importErrors.push(
                `Row ${rowNumber}: Customer "${customer.name}" is not linked to account "${account.name}".`
              );

              return;
            }
          }

          if (
            partyType === "supplier"
          ) {
            const supplier =
              suppliers.find(
                (item) =>
                  item.name
                    .trim()
                    .toLowerCase() ===
                  partyName
                    .trim()
                    .toLowerCase()
              );

            if (!supplier) {
              importErrors.push(
                `Row ${rowNumber}: Supplier "${partyName}" was not found.`
              );

              return;
            }

            if (
              supplier.account_id !==
              account.id && account.id!==partyControlAccounts.ap
            ) {
              importErrors.push(
                `Row ${rowNumber}: Supplier "${supplier.name}" is not linked to account "${account.name}".`
              );

              return;
            }
          }

          importedRows.push({
            description: lineDescription,
            accountCode: account.code,
            accountName:
              account.name,
            partyType,
            partyName,
            debit:
              debit > 0
                ? String(debit)
                : "",
            credit:
              credit > 0
                ? String(credit)
                : "",
            rowNumber,
          });
        }
      );

      if (
        importErrors.length > 0
      ) {
        throw new Error(
          `Import failed:\n\n${importErrors.join(
            "\n"
          )}`
        );
      }

      if (
        importedRows.length === 0
      ) {
        throw new Error(
          "No valid journal rows were found in the file."
        );
      }

      const newDraftLines: DraftLine[] =
        importedRows.map(
          (row) => {
            const account =
              accounts.find(
                (item) =>
                  String(
                    item.code
                  ).trim() ===
                  row.accountCode
              );

            let partyId = "";

            if (
              row.partyType ===
              "customer"
            ) {
              partyId =
                customers.find(
                  (item) =>
                    item.name
                      .trim()
                      .toLowerCase() ===
                    row.partyName
                      .trim()
                      .toLowerCase()
                )?.id || "";
            }

            if (
              row.partyType ===
              "supplier"
            ) {
              partyId =
                suppliers.find(
                  (item) =>
                    item.name
                      .trim()
                      .toLowerCase() ===
                    row.partyName
                      .trim()
                      .toLowerCase()
                )?.id || "";
            }

            return {
              tempId:
                createTempId(),
              accountId:
                account?.id || "",
              partyType:
                row.partyType,
              partyId,
              debit:
                row.debit,
              credit:
                row.credit,
              description: recordDisplayText(row.description),
            };
          }
        );

      setDraftLines(
        newDraftLines
      );

      setSuccess(
        `${newDraftLines.length} journal line${
          newDraftLines.length === 1
            ? ""
            : "s"
        } loaded from ${file.name}. Review the rows and click "Save All Lines".`
      );
    } catch (err: any) {
      setError(
        err?.message ||
          "Failed to import journal file."
      );
    } finally {
      setImporting(false);

      event.target.value = "";
    }
  };

  /* =========================================================
     SAVE ALL NEW LINES
  ========================================================= */

  const handleSaveAllLines =
    async () => {
      if (!id || !entry) return;
      if (
        entry.status === "posted"
      ) {
        setError(
          "Posted journal entries cannot be modified."
        );

        return;
      }

      setError(null);
      setSuccess(null);

      const activeLines =
        getActiveDraftLines();

      const dateChanged = draftEntryDate !== entry.entry_date;
      if (dateChanged) {
        const date = new Date(`${draftEntryDate}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(draftEntryDate) ||
            Number.isNaN(date.getTime()) ||
            date.toISOString().slice(0, 10) !== draftEntryDate) {
          setError("Select a valid journal date.");
          return;
        }
        // Existing base-currency draft lines retain their amounts and can be
        // re-dated. Foreign-currency drafts need a separate FX-safe correction.
        if (lines.length > 0 && (!companyBaseCurrency || !entry.currency_code ||
            entry.currency_code !== companyBaseCurrency)) {
          setError("Saved foreign-currency journal lines require a controlled FX correction before changing the date.");
          return;
        }
      }
      if (activeLines.length === 0 && !dateChanged) {
        setError("No unsaved changes to save.");
        return;
      }

      const rowsToInsert: {
        line_position: number;
        entry_id: string;
        account_id: string;
        account: string;
        party_type: PartyType | null;
        party_id: string | null;
        party_name: string | null;
        debit: number;
        credit: number;
        description?: string;
      }[] = [];

      for (
        let i = 0;
        i < activeLines.length;
        i++
      ) {
        const line =
          activeLines[i];

        const rowNumber =
          i + 1;

        if (!line.accountId) {
          setError(
            `Row ${rowNumber}: Please select an account.`
          );

          return;
        }

        const account =
          accounts.find(
            (item) =>
              item.id ===
              line.accountId
          );

        if (!account) {
          setError(
            `Row ${rowNumber}: Account not found.`
          );

          return;
        }

        if (account.is_group) {
          setError(
            `Row ${rowNumber}: "${account.name}" is a group account. Select a posting account.`
          );

          return;
        }

        if (!account.is_active) {
          setError(
            `Row ${rowNumber}: "${account.name}" is inactive.`
          );

          return;
        }

        if (!manualAccountEligible(account)) {
          setError(
            `Row ${rowNumber}: "${account.name}" does not allow manual journal entries.`
          );

          return;
        }

        if (
          accountRequiresParty(account.id) &&
          (!line.partyType || !line.partyId)
        ) {
          setError(
            `Row ${rowNumber}: "${account.name}" requires a Customer or Supplier Party.`
          );

          return;
        }

        if (
          (line.partyType && !line.partyId) ||
          (!line.partyType && line.partyId)
        ) {
          setError(
            `Row ${rowNumber}: Party Type and Party must be selected together.`
          );

          return;
        }

        let partyName:
          string | null = null;

        if (
          line.partyType ===
          "customer"
        ) {
          const customer =
            customers.find(
              (item) =>
                item.id === line.partyId
            );

          if (!customer) {
            setError(
              `Row ${rowNumber}: Selected customer was not found.`
            );

            return;
          }

          if (
            customer.account_id !==
            account.id && account.id!==partyControlAccounts.ar
          ) {
            setError(
              `Row ${rowNumber}: Customer "${customer.name}" is not linked to "${account.name}".`
            );

            return;
          }

          partyName =
            customer.name;
        }

        if (
          line.partyType ===
          "supplier"
        ) {
          const supplier =
            suppliers.find(
              (item) =>
                item.id === line.partyId
            );

          if (!supplier) {
            setError(
              `Row ${rowNumber}: Selected supplier was not found.`
            );

            return;
          }

          if (
            supplier.account_id !==
            account.id && account.id!==partyControlAccounts.ap
          ) {
            setError(
              `Row ${rowNumber}: Supplier "${supplier.name}" is not linked to "${account.name}".`
            );

            return;
          }

          partyName =
            supplier.name;
        }

        const debit =
          Math.max(
            0,
            parseFloat(
              line.debit
            ) || 0
          );

        const credit =
          Math.max(
            0,
            parseFloat(
              line.credit
            ) || 0
          );

        if (
          debit > 0 &&
          credit > 0
        ) {
          setError(
            `Row ${rowNumber}: Debit and Credit cannot both have values.`
          );

          return;
        }

        if (
          debit <= 0 &&
          credit <= 0
        ) {
          setError(
            `Row ${rowNumber}: Enter either Debit or Credit.`
          );

          return;
        }

        rowsToInsert.push({
          line_position: Math.max(lines.length, ...lines.map(saved => saved.line_position ?? 0)) + i + 1,
          entry_id: id,
          account_id:
            account.id,
          account:
            `${account.name}`,
          party_type:
            line.partyType || null,
          party_id:
            line.partyId || null,
          party_name:
            partyName,
          ...(line.description.trim() ? { description: line.description.trim() } : {}),
          debit,
          credit,
        });
      }

      let dateSaved = false;
      try {
        setSaving(true);
        if (dateChanged) {
          // Save the header first while the journal has no existing lines:
          // the FX/date snapshot is maintained by the database trigger.
          const { data: updated, error: updateError } = await supabase
            .from("journal_entries")
            .update({ entry_date: draftEntryDate })
            .eq("id", entry.id)
            .eq("status", "draft")
            .select("id,entry_date,exchange_rate")
            .single();
          if (updateError) throw new Error(updateError.message);
          if (!updated) throw new Error("Draft journal date could not be updated.");
          dateSaved = true;
          setEntry(previous => previous && previous.id === updated.id
            ? {...previous,entry_date:updated.entry_date,exchange_rate:updated.exchange_rate}
            : previous);
          setDraftEntryDate(updated.entry_date);
        }
        if (rowsToInsert.length === 0) {
          setSuccess("Journal date saved.");
          return;
        }

        const { data, error } = await supabase
          .from("journal_lines")
          .insert(rowsToInsert)
          .select(`
              *,
              coa:chart_of_accounts(*)
            `);
        if (error) throw new Error(error.message);

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

        setLines(
          (current) => [
            ...current,
            ...mappedLines,
          ]
        );

        setDraftLines([
          createDraftLine(),
        ]);

        setSuccess(
          `${dateSaved ? "Journal date and " : ""}${mappedLines.length} journal line${
            mappedLines.length ===
            1
              ? ""
              : "s"
          } saved successfully.`
        );
      } catch (err: any) {
        setError(
          `${dateSaved ? "Journal date was saved, but lines could not be saved. " : ""}${err?.message || "Failed to save journal changes."}`
        );
      } finally {
        setSaving(false);
      }
    };

  /* =========================================================
     DELETE EXISTING LINE
  ========================================================= */

  const handleDeleteLine =
    async () => {
      if (
        !deleteLineId ||
        !entry
      ) {
        return;
      }

      if (
        entry.status === "posted"
      ) {
        setError(
          "Posted journal entries cannot be modified."
        );

        setDeleteLineId(null);

        return;
      }

      try {
        setSaving(true);
        setError(null);
        setSuccess(null);

        const { error } =
          await supabase
            .from("journal_lines")
            .delete()
            .eq(
              "id",
              deleteLineId
            );

        if (error) {
          throw new Error(
            error.message
          );
        }

        setLines(
          (current) =>
            current.filter(
              (line) =>
                line.id !==
                deleteLineId
            )
        );

        setDeleteLineId(null);

        setSuccess(
          "Journal line removed."
        );
      } catch (err: any) {
        setError(
          err?.message ||
            "Failed to delete journal line."
        );
      } finally {
        setSaving(false);
      }
    };

  /* =========================================================
     POST JOURNAL ENTRY - DATABASE RPC
  ========================================================= */

  const handlePostEntry =
    async () => {
      if (!entry) return;
      if (draftEntryDate !== entry.entry_date) {
        setError("Save the journal changes before posting.");
        return;
      }

      const unsavedLines =
        getActiveDraftLines();

      if (
        unsavedLines.length > 0
      ) {
        setError(
          "You have unsaved journal lines. Click 'Save All Lines' before posting."
        );

        return;
      }

      if (
        entry.status === "posted"
      ) {
        setError(
          "This journal entry is already posted."
        );

        return;
      }

      if (lines.length === 0) {
        setError(
          "Cannot post an empty journal entry."
        );

        return;
      }

      if (!balanced) {
        setError(
          `Journal is not balanced. Debit ${formatJournalAmount(
            totalDebit
          )} must equal Credit ${formatJournalAmount(
            totalCredit
          )}.`
        );

        return;
      }

      const invalidAccountLine =
        lines.find((line) => {
          if (!line.account_id) {
            return true;
          }

          const account =
            accounts.find(
              (item) =>
                item.id ===
                line.account_id
            );

          return (
            !account ||
            account.is_group ||
            !account.is_active ||
            !manualAccountEligible(account)
          );
        });

      if (
        invalidAccountLine
      ) {
        setError(
          "One or more journal lines contain an invalid, inactive, group, or non-posting account."
        );

        return;
      }

      const missingPartyLine =
        lines.find(
          (line) =>
            !!line.account_id &&
            accountRequiresParty(
              line.account_id
            ) &&
            (
              !line.party_type ||
              !line.party_id
            )
        );

      if (
        missingPartyLine
      ) {
        const account =
          accounts.find(
            (item) =>
              item.id ===
              missingPartyLine.account_id
          );

        setError(
          `"${account?.name ?? "Party control account"}" requires a customer or supplier before posting.`
        );

        return;
      }

      try {
        setPosting(true);
        setError(null);
        setSuccess(null);

        const {
          data,
          error,
        } =
          await supabase.rpc(
            companyBaseCurrency && entry.currency_code && entry.currency_code !== companyBaseCurrency
              ? "post_foreign_manual_journal" : "post_journal_entry",
            {
              p_entry_id:
                entry.id,
            }
          );

        if (error) {
          throw new Error(
            error.message
          );
        }

        if (
          data &&
          typeof data === "object" &&
          "success" in data &&
          (data as any).success === false
        ) {
          throw new Error(
            (data as any).message ||
              "Journal posting failed."
          );
        }

        await Promise.all([
          fetchEntry(),
          fetchLines(),
        ]);

        setSuccess(
          "Journal entry posted successfully. General Ledger and Party Ledger were created in company base currency."
        );
      } catch (err: any) {
        setError(
          err?.message ||
            "Failed to post journal entry."
        );
      } finally {
        setPosting(false);
      }
    };

  /* =========================================================
     DELETE ENTRY
  ========================================================= */

  const handleDeleteEntry =
    async () => {
      if (!entry) return;

      if (
        entry.status === "posted"
      ) {
        setError(
          "Posted journal entries cannot be deleted."
        );

        setDeleteEntryOpen(
          false
        );

        return;
      }

      try {
        setSaving(true);
        setError(null);
        setSuccess(null);

        const {
          error: lineError,
        } =
          await supabase
            .from("journal_lines")
            .delete()
            .eq(
              "entry_id",
              entry.id
            );

        if (lineError) {
          throw new Error(
            lineError.message
          );
        }

        const {
          error: entryError,
        } =
          await supabase
            .from(
              "journal_entries"
            )
            .delete()
            .eq(
              "id",
              entry.id
            );

        if (entryError) {
          throw new Error(
            entryError.message
          );
        }

        // RLS can silently delete zero rows. Confirm the record is gone before navigating.
        const { data: remainingEntry, error: verificationError } = await supabase
          .from("journal_entries")
          .select("id")
          .eq("id", entry.id)
          .maybeSingle();
        if (verificationError) throw new Error(verificationError.message);
        if (remainingEntry) {
          throw new Error("Journal was not deleted. Check Accounting delete permission, feature entitlement, and active company/branch access.");
        }

        navigate(
          "/accounting"
        );
      } catch (err: any) {
        setError(
          err?.message ||
            "Failed to delete journal entry."
        );

        setDeleteEntryOpen(
          false
        );
      } finally {
        setSaving(false);
      }
    };

  /* =========================================================
     LOADING / NOT FOUND
  ========================================================= */

  const handleOwnerCancel = async () => {
    if (!entry || !ownerCanCancel || ownerCancelReason.trim().length < 10 || !ownerCancelDate) return;
    if (ownerCancelDate < entry.entry_date) {
      setError(`Cancellation date cannot be earlier than the original posting date (${entry.entry_date}).`);
      return;
    }
    try {
      setOwnerCancelling(true);
      setError(null);
      const isOpeningPayment = ["transport_opening_receipt", "transport_opening_payment"]
        .includes((entry as JournalEntry & {source_document_type?:string}).source_document_type || "");
      const isAccountingPayment = ["Customer Receipt", "Supplier Payment"].includes(entry.trans_type || "");
      if (!isOpeningPayment && !isAccountingPayment) {
        throw new Error("Posted manual journals are edited in place by an Admin; reversal or cancellation entries are disabled.");
      }
      const { data, error: rpcError } = await supabase.rpc(
        isOpeningPayment ? "transport_cancel_opening_invoice_settlement" : "owner_cancel_unallocated_payment", {
        p_entry_id: entry.id,
        p_reversal_date: ownerCancelDate,
        p_reason: ownerCancelReason.trim(),
      });
      if (rpcError) throw new Error(rpcError.message);
      if (!data?.success) throw new Error("Owner cancellation was not confirmed by the server.");
      setOwnerCancelOpen(false);
      navigate("/accounting");
    } catch (err: any) {
      setError(err?.message || "Owner cancellation failed; no financial change was confirmed.");
    } finally {
      setOwnerCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="card p-12 text-center text-slate-400">
        Loading journal entry...
      </div>
    );
  }

  if (!entry) {
    return (
      <ErrorBanner message="Journal entry not found." />
    );
  }

  const isPosted =
    entry.status === "posted";
  const isForeignJournal = Boolean(companyBaseCurrency && entry.currency_code && entry.currency_code !== companyBaseCurrency);

  // Older manually created journals use trans_type "General". Treat them as
  // manual journals too, so their Draft Posting Date remains editable.
  const isManualJournal =
    !entry.reversal_of_entry_id &&
    (!entry.trans_type || ["General", "Journal Entry", "Manual Journal"].includes(entry.trans_type));
  const sourceEntry = entry as JournalEntry & {
    source_module?: string | null;
    source_document_type?: string | null;
    source_document_id?: string | null;
    fiscal_year_closure_id?: string | null;
    monthly_profit_closure_id?: string | null;
  };
  const canEditDraftDate = !isPosted && isManualJournal &&
    !sourceEntry.source_module && !sourceEntry.source_document_type &&
    !sourceEntry.source_document_id && !sourceEntry.fiscal_year_closure_id &&
    !sourceEntry.monthly_profit_closure_id;
  const hasUnsavedDraftDate = canEditDraftDate && draftEntryDate !== entry.entry_date;
  const hasUnsavedDraftNumber = canEditDraftDate && entryNumberDraft.trim() !== entry.entry_no;

  const saveDraftEntryNumber = async () => {
    if (!entry || !canEditDraftDate || saving || posting || importing) return;
    const nextEntryNo = entryNumberDraft.trim();
    if (!nextEntryNo) {
      setError("Enter a journal entry number before saving.");
      return;
    }
    if (nextEntryNo === entry.entry_no) {
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { data, error: updateError } = await supabase
        .from("journal_entries")
        .update({ entry_no: nextEntryNo, trans_type: "Manual Journal" })
        .eq("id", entry.id)
        .eq("status", "draft")
        .select("id,entry_no,trans_type")
        .maybeSingle();
      if (updateError) {
        if ((updateError as any).code === "23505") throw new Error(`Entry number “${nextEntryNo}” is already in use.`);
        throw new Error(updateError.message);
      }
      if (!data) throw new Error("This journal is no longer a draft. Refresh the page and try again.");
      setEntry(previous => previous && previous.id === data.id
        ? { ...previous, entry_no: data.entry_no, trans_type: data.trans_type }
        : previous);
      setEntryNumberDraft(data.entry_no);
      setSuccess("Journal entry number saved.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update the journal entry number.");
    } finally {
      setSaving(false);
    }
  };

  const isOwnerCancellableOpeningPayment = isPosted && ownerCanCancel && !reversalEntry && !entry.reversal_of_entry_id && sourceEntry.source_module === "transport" && ["transport_opening_receipt", "transport_opening_payment"].includes(sourceEntry.source_document_type || "");

  const isOwnerCancellablePayment =
    isPosted && ownerCanCancel && !reversalEntry &&
    !entry.reversal_of_entry_id && !sourceEntry.fiscal_year_closure_id &&
    !sourceEntry.monthly_profit_closure_id &&
    (sourceEntry.source_module === "accounting" || (!sourceEntry.source_module && isManualJournal)) &&
    ["customer_receipt", "supplier_payment"].includes(sourceEntry.source_document_type || "") &&
    ["Customer Receipt", "Supplier Payment"].includes(entry.trans_type || "");

  /* =========================================================
     UI
  ========================================================= */

  return (
    <div id="navilo-journal-detail" className="navilo-journal-detail space-y-2 w-full min-w-0 pb-2">
      <div className="navilo-detail-header flex flex-col md:flex-row md:items-center justify-between gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/accounting" className="shrink-0 text-xs font-medium text-primary-600 hover:text-primary-700">
              ← Back to Journal Entries
            </Link>
            {canEditDraftDate ? (
              <div className="inline-flex flex-wrap items-center gap-2">
                <input
                  aria-label="Journal entry number"
                  className="input w-52 font-mono text-lg font-bold"
                  maxLength={80}
                  value={entryNumberDraft}
                  onChange={event => setEntryNumberDraft(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === "Enter") { event.preventDefault(); void saveDraftEntryNumber(); }
                    if (event.key === "Escape") setEntryNumberDraft(entry.entry_no);
                  }}
                  disabled={saving || posting || importing}
                />
                {hasUnsavedDraftNumber && (
                  <>
                    <button type="button" className="btn-primary text-xs" onClick={() => void saveDraftEntryNumber()} disabled={saving || posting || importing || !entryNumberDraft.trim()}>
                      {saving ? "Saving…" : "Save number"}
                    </button>
                    <button type="button" className="btn-secondary text-xs" onClick={() => setEntryNumberDraft(entry.entry_no)} disabled={saving}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
            ) : (
              <h1 className="text-2xl font-bold text-slate-900">{entry.entry_no}</h1>
            )}

            <StatusBadge
              status={entry.status}
            />
          </div>

          {entry.description && <p className="text-sm text-slate-500 mt-1 whitespace-pre-wrap break-words">{recordDisplayText(entry.description)}</p>}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {!isPosted && (
            <button
              onClick={
                handlePostEntry
              }
              disabled={
                posting ||
                saving ||
                importing ||
                hasUnsavedDraftNumber ||
                hasUnsavedDraftDate ||
                !balanced
              }
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                balanced
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-slate-200 text-slate-400 cursor-not-allowed"
              }`}
            >
              {posting
                ? "Posting..."
                : "✓ Post Journal"}
            </button>
          )}

          {isPosted && (
            <span className="px-3 py-2 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg">
              ✓ Posted & Locked
            </span>
          )}
          {isPosted && sourceEntry.source_document_id && sourceEntry.source_module === "sales" && (
            <Link className="btn-secondary text-xs" to={`/sales/${sourceEntry.source_document_id}`}
              title="Open the original sale and its audited correction actions">Open Source Sale / Correct</Link>
          )}
          {isPosted && sourceEntry.source_document_id && sourceEntry.source_module === "purchase" && (
            <Link className="btn-secondary text-xs" to={`/purchase/${sourceEntry.source_document_id}`}
              title="Open the original purchase and its audited correction actions">Open Source Purchase / Correct</Link>
          )}
          {isPosted && sourceEntry.source_module === "transport" && (
            <Link className="btn-secondary text-xs" to="/transport?view=trips"
              title="Transport-originated journals must be corrected from Trip Finance, not edited directly">Open Transport Finance</Link>
          )}
          {isPosted && ["Customer Receipt","Supplier Payment"].includes(entry.trans_type || "") && (
            <Link className="btn-secondary text-xs" to="/accounting/payment-reversals"
              title="Check whether this posted voucher qualifies for an audited payment reversal">Check Payment Reversal</Link>
          )}

          {isPosted && (adminCanEditPosted || isPlatformOwner || isCompanyOwner) && !reversalEntry &&
            sourceEntry.source_module === "accounting" &&
            !sourceEntry.source_document_id && !sourceEntry.source_document_type &&
            !entry.reversal_of_entry_id && !sourceEntry.fiscal_year_closure_id &&
            !sourceEntry.monthly_profit_closure_id && !isForeignJournal && (
              <button type="button" onClick={openPostedEdit}
                className="px-3 py-2 text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200">
                Edit Posted Journal
              </button>
          )}
          {isPosted && ownerCanCancel && !reversalEntry &&
            sourceEntry.source_module === "accounting" &&
            !sourceEntry.source_document_id && !sourceEntry.source_document_type &&
            !entry.reversal_of_entry_id && !sourceEntry.fiscal_year_closure_id &&
            !sourceEntry.monthly_profit_closure_id && (
            <button type="button" onClick={() => { setPermanentDeleteReason(""); setPermanentDeleteOpen(true); }}
              disabled={permanentDeleting}
              className="px-3 py-2 text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200">
              Permanent Delete
            </button>
          )}
          {(isOwnerCancellablePayment || isOwnerCancellableOpeningPayment) && (
            <button
              onClick={() => setOwnerCancelOpen(true)}
              disabled={ownerCancelling}
              className="px-3 py-2 text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200"
            >
              {isOwnerCancellableOpeningPayment ? "Delete Posted Opening Payment" : isOwnerCancellablePayment ? "Delete Posted Payment" : "Delete Posted Journal"}
            </button>
          )}

          {!isPosted && (
            <button
              onClick={() =>
                setDeleteEntryOpen(
                  true
                )
              }
              disabled={
                saving ||
                posting ||
                importing
              }
              className="px-3 py-2 text-sm font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors border border-rose-200"
            >
              Delete Entry
            </button>
          )}
        </div>
      </div>

      {error && (
        <ErrorBanner
          message={error}
        />
      )}

      {isPosted && Boolean((sourceEntry.source_module && sourceEntry.source_module !== "accounting") || sourceEntry.source_document_id || sourceEntry.source_document_type) && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          This journal was generated by {sourceEntry.source_module || "another source"}. Direct Edit/Delete is blocked to preserve ledger evidence.
          Use the linked source document correction action above. Only eligible standalone manual journals can be cancelled by their owner.
        </p>
      )}
      {reversalEntry && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This journal has been reversed by{" "}
          <Link className="font-semibold underline" to={`/accounting/${reversalEntry.id}`}>{reversalEntry.entry_no}</Link>.
        </div>
      )}

      {entry.reversal_of_entry_id && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          This is a reversal journal. Reason: <strong>{entry.reversal_reason || "Not provided"}</strong>.{" "}
          <Link className="font-semibold underline" to={`/accounting/${entry.reversal_of_entry_id}`}>View original journal</Link>.
        </div>
      )}

      {success && (
        <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm whitespace-pre-line">
          {success}
        </div>
      )}

      <div className="navilo-journal-summary grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {entry.currency_code && companyBaseCurrency && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Currency</div>
            <div className="mt-1 font-semibold text-slate-800">{entry.currency_code} · base {companyBaseCurrency}</div>
            {isForeignJournal && <div className="mt-1 text-xs text-slate-600">1 {entry.currency_code} = {entry.exchange_rate} {companyBaseCurrency}. {isPosted ? "Posted amounts below are in base currency; original amounts appear on each line." : "Enter draft line amounts in the journal currency."}</div>}
          </div>
        )}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Posting Date
          </div>

          {canEditDraftDate ? (
            <div className="mt-1 flex items-center gap-2">
              <NaviloDateInput
                aria-label="Edit journal entry date"
                className="h-8 w-full min-w-0 rounded border border-blue-300 bg-white px-2 text-xs font-semibold text-slate-800"
                type="date"
                value={draftEntryDate}
                onChange={event => { setDraftEntryDate(event.target.value); setError(null); }}
                disabled={saving || posting || importing}
              />
            </div>
          ) : (
            <div className="font-semibold text-slate-800 mt-1">{formatDate(entry.entry_date)}</div>
          )}
          {hasUnsavedDraftDate && <p className="mt-1 text-[10px] font-medium text-blue-700">Date will be saved with journal changes.</p>}
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Total Debit
          </div>

          <div className="font-semibold text-slate-800 mt-1">
            {formatJournalAmount(
              totalDebit
            )}
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Total Credit
          </div>

          <div className="font-semibold text-slate-800 mt-1">
            {formatJournalAmount(
              totalCredit
            )}
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Accounting Check
          </div>

          <div
            className={`font-semibold mt-1 ${
              !hasAmounts
                ? "text-amber-700"
                : balanced
                ? "text-emerald-600"
                : "text-rose-600"
            }`}
          >
            {!hasAmounts
              ? "Awaiting amounts"
              : balanced
              ? "✓ Balanced"
              : "✕ Not Balanced"}
          </div>

          {!balanced && hasAmounts && Math.abs(difference) >= 0.01 && (
            <div className="text-xs text-rose-500 mt-1">
              Difference:{" "}
              {formatJournalAmount(
                Math.abs(
                  difference
                )
              )}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-lg">
              Journal Line Items
            </h3>

            <p className="text-xs text-slate-500 mt-0.5">
              {isPosted
                ? "This journal entry has been posted and is locked."
                : "Add lines below or import Excel / CSV. Party is only for genuine customer/supplier control accounts; the selected GL Account receives the debit or credit. Save the draft, then post when balanced."}
            </p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {lines.some(line => Number(line.debit ?? 0) > 0 && lines.some(other => other.account_id === line.account_id && Number(other.credit ?? 0) > 0)) && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Same account appears on both Debit and Credit sides. Review the original account selection; the journal may have no net effect on that account.
            </div>
          )}
          {lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="text-left py-3 px-4 font-semibold">Account</th>
                    <th className="text-left py-3 px-4 font-semibold">Description</th>

                    <th className="text-left py-3 px-4 font-semibold">Party</th>

                    <th className="text-right py-3 px-4 font-semibold">Debit</th>

                    <th className="text-right py-3 px-4 font-semibold">Credit</th>

                    {!isPosted && (
                      <th className="w-24 text-right py-3 px-4 font-semibold">
                        Action
                      </th>
                    )}
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {lines.map(
                    (line) => {
                      const coa =
                        accounts.find(
                          (account) =>
                            account.id ===
                            line.account_id
                        );

                      const partyName =
                        getExistingLinePartyName(
                          line
                        );

                      return (
                        <tr
                          key={line.id}
                          className="hover:bg-slate-50/50"
                        >
                          <td className="py-3.5 px-4">
                            <div className="font-medium text-slate-900">
                              {coa
                                ? `${coa.name}`
                                : line.account}
                            </div>



                            {coa && (
                              <div className="text-xs text-slate-400 mt-0.5">
                                {coa.type}
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-4 align-top min-w-[260px] max-w-[520px]">
                            <JournalDescription text={line.description || entry.description} />
                          </td>
                          <td className="py-3.5 px-4">
                            {partyName&&<div className="font-medium text-slate-800">
                              {partyName} <span className="text-xs text-slate-500">({line.party_type})</span>
                            </div>}
                            {!partyName&&<span className="text-slate-400">—</span>}
                          </td>

                          <td className="py-3.5 px-4 text-right text-slate-700 font-mono">
                            {Number(
                              line.debit
                            ) > 0
                              ? formatJournalAmount(
                                  Number(
                                    line.debit
                                  )
                                )
                              : "—"}
                            {isForeignJournal && isPosted && Number(line.source_debit) > 0 && <div className="text-[11px] text-slate-500">Original: {Number(line.source_debit).toFixed(2)} {entry.currency_code}</div>}
                          </td>

                          <td className="py-3.5 px-4 text-right text-slate-700 font-mono">
                            {Number(
                              line.credit
                            ) > 0
                              ? formatJournalAmount(
                                  Number(
                                    line.credit
                                  )
                                )
                              : "—"}
                            {isForeignJournal && isPosted && Number(line.source_credit) > 0 && <div className="text-[11px] text-slate-500">Original: {Number(line.source_credit).toFixed(2)} {entry.currency_code}</div>}
                          </td>

                          {!isPosted && (
                            <td className="py-3.5 px-4 text-right">
                              <button
                                onClick={() =>
                                  setDeleteLineId(
                                    line.id
                                  )
                                }
                                disabled={
                                  saving ||
                                  posting ||
                                  importing
                                }
                                className="text-rose-600 hover:text-rose-800 text-xs font-semibold px-2 py-1 bg-rose-50 hover:bg-rose-100 rounded"
                              >
                                Remove
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!isPosted && (
            <details className="navilo-je-import">
              <summary>Import lines <span>Excel / CSV · templates and column guide</span></summary>
              <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div>
                    <h4 className="font-bold text-slate-900">
                      Import Excel / CSV
                    </h4>

                    <p className="text-xs text-slate-600 mt-1">
                      Import into this draft. Review before posting.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        fileInputRef.current?.click()
                      }
                      disabled={
                        importing ||
                        saving ||
                        posting
                      }
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg"
                    >
                      {importing
                        ? "Loading..."
                        : "↑ Load Excel / CSV"}
                    </button>

                    <button type="button" onClick={handleDownloadTemplate}
                      disabled={importing || saving || posting}
                      className="px-4 py-2 bg-white border border-emerald-300 text-emerald-900 text-sm font-semibold rounded-lg">
                      ↓ Excel Template
                    </button>
                    <input
                      ref={
                        fileInputRef
                      }
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={
                        handleBulkImport
                      }
                      className="hidden"
                    />
                  </div>
                </div>

                <div className="mt-3 text-xs text-slate-600 bg-white/70 border border-emerald-100 rounded-lg p-3">
                  <strong>
                    File columns:
                  </strong>{" "}
                  Account Name, Line Description, Party Type, Party Name, Debit, Credit
                  <span className="ml-2">
                    • Party Type + Party Name required for customer/supplier control accounts
                  </span>
                </div>
              </div>
            </details>
          )}

          {(!isPosted || postedEditOpen) && (
            <div id="navilo-posted-journal-editor" className="navilo-je-editor min-w-0 max-w-full border border-slate-200 rounded-lg overflow-hidden">
              {postedEditOpen && <div className="bg-white border-b p-3 flex flex-wrap items-end gap-2">
                <label className="text-xs">Posting Date<NaviloDateInput className="input block" type="date" value={postedEditDate} onChange={e=>setPostedEditDate(e.target.value)}/></label>
                <label className="text-xs">Journal Description<textarea className="input block" value={postedEditDescription} onChange={e=>setPostedEditDescription(e.target.value)} rows={2} style={{minHeight:32,height:40,resize:"vertical",whiteSpace:"pre-wrap",tabSize:4}} /></label>
                <label className="text-xs">Reason (minimum 10 characters) — required to save<input className="input block" value={postedEditReason} onChange={e=>setPostedEditReason(e.target.value)} placeholder="Explain what was corrected"/></label>
                {postedEditReason.trim().length < 10 && <span className="text-xs text-amber-700">Enter at least 10 characters to enable Save Original Journal.</span>}

                <button className="btn-secondary" disabled={postedEditSaving} onClick={()=>setPostedEditOpen(false)}>Cancel Edit</button>
              </div>}
              <div className="bg-blue-50 border-b border-blue-200 px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="font-bold text-slate-900">
                    {postedEditOpen ? "Edit Original Journal Entry" : "Fast Journal Entry"}
                  </h4>

                  <span className="navilo-je-subtitle">Account · description · party · debit / credit</span>
                  <p className="text-xs text-slate-600 mt-0.5">General Journal does not select a vehicle or update vehicle reports; enter vehicle costs and income through their Transport source workflows.</p>
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
                <span title="Inactive, group and manual-disabled accounts remain visible but cannot be selected.">{postingAccounts.length} posting accounts · {journalExcludedAccounts} unavailable</span>
                <div className="flex items-center gap-2"><QuickMasterAdd kind="account" compact disabled={saving||posting||importing} onRefresh={fetchAccounts}/><button type="button" className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50" data-navilo-keep-local-action="true" onClick={() => { void fetchAccounts().catch((e:unknown) => setError(e instanceof Error ? e.message : "Unable to refresh Chart of Accounts.")); }}>
                  Refresh Accounts
                </button></div>
              </div>
              <div className="w-full max-w-full min-w-0 overflow-x-auto" aria-label="Journal line editor">
                <table className="navilo-je-grid w-full table-fixed min-w-[850px] text-[12px]">
                  <colgroup>
                    <col style={{width:'25%'}} />
                    <col style={{width:'31%'}} />
                    <col style={{width:'15%'}} />
                    <col style={{width:'9%'}} />
                    <col style={{width:'9%'}} />
                    <col style={{width:'136px'}} />
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-2 py-2 font-semibold text-slate-600">Account</th>
                       <th className="text-left px-2 py-2 font-semibold text-slate-600">Line Description</th>

                      <th className="text-left px-2 py-2 font-semibold text-slate-600">Party</th>

                      <th className="text-right px-2 py-2 font-semibold text-slate-600">Debit</th>

                      <th className="text-right px-2 py-2 font-semibold text-slate-600">Credit</th>

                      <th className="text-center px-1 py-2 font-semibold text-slate-600">
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {draftLines.map(
                      (line, rowIndex) => {
                        const partyOptions =
                          getPartyOptionsForAccount(
                            line.accountId
                          );

                        const partyRequired =
                          !!line.accountId &&
                          accountRequiresParty(
                            line.accountId
                          );

                        return (
                          <tr
                            key={
                              line.tempId
                            }
                            className="border-b border-slate-100 align-top"
                            onDragOver={event => { if (draggedDraftRow) event.preventDefault(); }}
                            onDrop={event => { event.preventDefault(); if (draggedDraftRow && !saving && !posting && !importing) moveDraftRow(draggedDraftRow, rowIndex); setDraggedDraftRow(null); }}
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

                            <td className="min-w-0 px-2 py-1.5"><textarea className="input w-full text-xs" aria-label={`Description row ${draftLines.indexOf(line)+1}`} placeholder="Line description..." value={line.description} onChange={e=>updateDraftLine(line.tempId,"description",e.target.value)} maxLength={1000} rows={2} style={{minHeight:32,height:40,resize:"vertical",whiteSpace:"pre-wrap",tabSize:4}} /></td>
                            <td className="min-w-0 px-2 py-1.5">
                              {!line.accountId ? (
                                <span className="text-xs text-slate-500">Select account first</span>
                              ) : partyRequired ? (
                                <SearchableSelect
                                  preserveLabel
                                  aria-label={`Party row ${draftLines.indexOf(line)+1}`}
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
                              ) : <span className="text-xs text-slate-400">—</span>}
                              {partyRequired&&partyOptions.length===0&&(
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
                              <div className="navilo-je-row-actions">
                                <button type="button" draggable={!saving && !posting && !importing}
                                  onDragStart={() => setDraggedDraftRow(line.tempId)} onDragEnd={() => setDraggedDraftRow(null)}
                                  aria-label={`Drag row ${rowIndex + 1}`} title="Drag to move row" className="navilo-je-row-icon cursor-grab"><GripVertical size={13}/></button>
                                <button type="button" aria-label={`Move row ${rowIndex + 1} up`} title="Move up"
                                  disabled={rowIndex === 0 || saving || posting || importing} onClick={() => moveDraftRow(line.tempId, rowIndex - 1)} className="navilo-je-row-icon disabled:opacity-30"><ChevronUp size={13}/></button>
                                <button type="button" aria-label={`Move row ${rowIndex + 1} down`} title="Move down"
                                  disabled={rowIndex === draftLines.length - 1 || saving || posting || importing} onClick={() => moveDraftRow(line.tempId, rowIndex + 1)} className="navilo-je-row-icon disabled:opacity-30"><ChevronDown size={13}/></button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDuplicateRow(line)
                                  }
                                  disabled={
                                    saving ||
                                    posting ||
                                    importing
                                  }
                                  className="shrink-0 rounded bg-blue-50 px-1.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                                  aria-label="Duplicate journal row"
                                  title="Duplicate row"
                                >
                                  <Copy size={13}/>
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
                                  <Trash2 size={13}/>
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
