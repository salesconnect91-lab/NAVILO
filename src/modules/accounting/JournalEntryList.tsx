Warning: truncated output (original token count: 27928)
Total output lines: 3834

import {TEMPLATE_HEADERS,TEMPLATE_ROWS,downloadCSVTemplate,downloadExcelTemplate} from './journalImportTemplates';
import {expandFundedJournalRows,isFundedJournalTemplate} from './journalFundedImport';
import {downloadSimpleJournalTemplate,isSimpleJournalTemplate,normalizeSimpleJournalRows} from './journalSimpleImport';
import JournalImportFilePicker from './JournalImportFilePicker';
import { createPrintDocument } from "@/lib/printDocument";
import OwnerJournalAuditHistory from "./OwnerJournalAuditHistory";
import JournalEntryOverview from "./JournalEntryOverview";
import NaviloSearchableSelect from "@/components/SearchableSelect";
import NaviloDateInput from '@/components/NaviloDateInput';
import {
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";

import { Link, useNavigate, useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";

import { supabase } from "@/lib/supabase";

import { JournalEntry } from "@/types";

import {
  ErrorBanner,
  StatusBadge,
  formatDate,
} from "@/components/ui";

/* =========================================================
   TYPES
========================================================= */

type ImportRow = {
  rowNumber: number;
  entryNo: string;
  entryDate: string;
  description: string;

  accountCode: string;

  accountHead: string;
  accountName: string;
  lineDescription: string;
  vehicleNo: string;
  partyType: string;
  partyName: string;

  debit: number;
  credit: number;
};

type ImportEntryGroup = {
  entryNo: string;
  entryDate: string;
  description: string;
  rows: ImportRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  valid: boolean;
  errors: string[];

  /* DB entry created by Bulk Load */
  loadedEntryId?: string;
};

type BulkRpcEntry = {
  id: string;
  entry_no: string;
};

/* =========================================================
   HELPERS
========================================================= */

const generateEntryNo = () =>
  `JE-${Date.now().toString().slice(-8)}`;

const normalize = (value: unknown) =>
  String(value ?? "").trim();

const normalizeHeader = (value: unknown) =>
  normalize(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const normalizeKey = (value: unknown) =>
  normalize(value).toLowerCase();

const parseAmount = (value: unknown): number => {
  const cleaned = normalize(value)
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "");

  if (!cleaned) {
    return 0;
  }

  const number = Number(cleaned);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, number);
};

const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeJournalImportDate = (value: unknown): string => {
  const input = normalize(value);
  if (!input) return "";
  const iso = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const slash = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else if (slash) {
    month = Number(slash[1]); day = Number(slash[2]);
    year = Number(slash[3]);
    if (slash[3].length === 2) year += year >= 70 ? 1900 : 2000;
  } else if (/^\d{5}$/.test(input)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Number(input) * 86400000);
    return date.toISOString().slice(0, 10);
  } else {
    return input;
  }
  const valid = new Date(Date.UTC(year, month - 1, day));
  if (valid.getUTCFullYear() !== year || valid.getUTCMonth() + 1 !== month || valid.getUTCDate() !== day) return input;
  return [String(year).padStart(4, "0"), String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
};

const isValidDate = (value: string) => {
  if (!value) {
    return false;
  }

  const date = new Date(`${value}T00:00:00`);

  return (
    !Number.isNaN(date.getTime()) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  );
};

/* =========================================================
   CSV PARSER
========================================================= */

const parseCSV = (text: string): string[][] => {
  const rows: string[][] = [];

  let currentRow: string[] = [];
  let currentValue = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    const nextCharacter = text[i + 1];

    if (character === '"') {
      if (
        insideQuotes &&
        nextCharacter === '"'
      ) {
        currentValue += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }

      continue;
    }

    if (
      character === "," &&
      !insideQuotes
    ) {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if (
      (character === "\n" ||
        character === "\r") &&
      !insideQuotes
    ) {
      if (
        character === "\r" &&
        nextCharacter === "\n"
      ) {
        i++;
      }

      currentRow.push(currentValue);
      currentValue = "";

      if (
        currentRow.some(
          (cell) =>
            normalize(cell) !== ""
        )
      ) {
        rows.push(currentRow);
      }

      currentRow = [];
      continue;
    }

    currentValue += character;
  }

  if (
    currentValue.length > 0 ||
    currentRow.length > 0
  ) {
    currentRow.push(currentValue);

    if (
      currentRow.some(
        (cell) =>
          normalize(cell) !== ""
      )
    ) {
      rows.push(currentRow);
    }
  }

  return rows;
};

/* =========================================================
   EXCEL HTML/XLS PARSER
========================================================= */

const parseExcelCompatibleHTML = (
  text: string
): string[][] => {
  const parser = new DOMParser();

  const document =
    parser.parseFromString(
      text,
      "text/html"
    );

  const table =
    document.querySelector("table");

  if (!table) {
    throw new Error(
      "The Excel file does not contain a readable table."
    );
  }

  const rows: string[][] = [];

  table
    .querySelectorAll("tr")
    .forEach((tr) => {
      const cells = Array.from(
        tr.querySelectorAll("th,td")
      ).map((cell) =>
        normalize(cell.textContent)
      );

      if (
        cells.some(
          (cell) => cell !== ""
        )
      ) {
        rows.push(cells);
      }
    });

  return rows;
};

/* =========================================================
   TEMPLATE
========================================================= */

/* =========================================================
   CSV TEMPLATE
========================================================= */



/* =========================================================
   EXCEL TEMPLATE
========================================================= */

const escapeHTML = (
  value: unknown
) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");



/* =========================================================
   COMPONENT
========================================================= */

export default function JournalEntryList() {
  const navigate = useNavigate();
  const [importParams,setImportParams]=useSearchParams();

  /* =======================================================
     JOURNAL LIST
  ======================================================= */

  const [entries, setEntries] =
    useState<JournalEntry[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const [success, setSuccess] =
    useState<string | null>(null);

  const [postingSelectedEntries, setPostingSelectedEntries] =
    useState(false);
  const [deletingSelectedEntries, setDeletingSelectedEntries] =
    useState(false);

  /* =======================================================
     SINGLE ENTRY
  ======================================================= */

  const [modalOpen, setModalOpen] =
    useState(false);

  const [form, setForm] =
    useState({
      entry_no: generateEntryNo(),
      entry_date:
        new Date()
          .toISOString()
          .split("T")[0],
      description: "",
      currency_code: "",
    });
  const [baseCurrency, setBaseCurrency] = useState("");
  const [activeCompanyId, setActiveCompanyId] = useState("");
  const [availableCurrencies, setAvailableCurrencies] = useState<{ code: string; name: string }[]>([]);

  useEffect(() => {
    const loadCurrency = async () => {
      const { data: companyId, error: contextError } = await supabase.rpc("current_company_id");
      if (contextError || !companyId) return;
      const [company, currencies] = await Promise.all([
        supabase.from("companies").select("base_currency_code").eq("id", String(companyId)).single(),
        supabase.from("currency_master").select("code,name").eq("is_active", true).order("code"),
      ]);
      if (company.error || currencies.error) return;
      setActiveCompanyId(String(companyId));
      setBaseCurrency(company.data.base_currency_code);
      setAvailableCurrencies(currencies.data || []);
    };
    void loadCurrency();
    const reload = () => {
      setAvailableCurrencies([]);
      setBaseCurrency("");
      setForm(current => ({ ...current, currency_code: "" }));
      void loadCurrency();
    };
    window.addEventListener("navilo-workspace-changed", reload);
    return () => window.removeEventListener("navilo-workspace-changed", reload);
  }, []);

  const [creating, setCreating] =
    useState(false);

  /* =======================================================
     BULK IMPORT
  ======================================================= */

  const [bulkModalOpen, setBulkModalOpen] =
    useState(()=>importParams.get("import")==="journal");
  useEffect(()=>{
    if(importParams.get("import")==="journal"){
      setBulkModalOpen(true);
      const next=new URLSearchParams(importParams);next.delete("import");
      setImportParams(next,{replace:true});
    }
  },[importParams,setImportParams]);

  const [importRows, setImportRows] =
    useState<ImportRow[]>([]);

  const [importEntries, setImportEntries] =
    useState<ImportEntryGroup[]>([]);

  const [importFileName, setImportFileName] =
    useState("");

  const [importing, setImporting] =
    useState(false);

  const [postingBulk, setPostingBulk] =
    useState(false);

  /*
    NEW:
    Track whether Bulk Load has already
    created draft records.
  */
  const [draftsLoaded, setDraftsLoaded] =
    useState(false);

  const [importStep, setImportStep] =
    useState<
      "upload" |
      "preview" |
      "validated"
    >("upload");

  /* =======================================================
     FETCH
  ======================================================= */

  const fetchEntries =
    useCallback(async () => {
      setLoading(true);
      setError(null);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 30_000);
      try {
        const {
          data,
          error: fetchError,
        } = await supabase
          .from("journal_entries")
          .select("*")
          .order("entry_date", {
            ascending: false,
          })
          .order("entry_no", {
            ascending: false,
          })
          // Do not download tens of thousands of tenant journals on page open.
          // Keep the newest 250 available for immediate searching/paging.
          .limit(250)
          .abortSignal(controller.signal);

        if (fetchError) throw fetchError;

        const { data: cancelled, error: cancelledError } =
          await supabase.rpc("owner_cancelled_journal_ids").abortSignal(controller.signal);
        if (cancelledError) throw cancelledError;

        const excluded = new Set(
          (cancelled ?? []).map((row: { entry_id: string }) => row.entry_id)
        );
        // Hide only the two explicitly verified acceptance-test journals from
        // the normal register. They remain posted in the database, with all
        // ledger and reversal evidence intact and available by direct link.
        const hiddenAcceptanceTestIds = new Set([
          "e6fe9b05-5056-4441-ac8c-2d50c04f671d",
          "b064dca7-e0a3-4315-8cdc-136e8257c757",
        ]);
        setEntries(((data ?? []) as JournalEntry[]).filter(
          (entry) => !excluded.has(entry.id) && !hiddenAcceptanceTestIds.has(entry.id)
        ));
      } catch (fetchError) {
        setEntries([]);
        setError(controller.signal.aborted
          ? "Journal entries took longer than 30 seconds to load. Check the connection and retry."
          : String((fetchError as { message?: string } | null)?.message || (fetchError instanceof Error ? fetchError.message : "Unable to load journal entries. Please retry.")));
      } finally {
        window.clearTimeout(timeout);
        setLoading(false);
      }
    }, []);

  const postSelectedEntries = useCallback(async (entryIds: string[]) => {
    setError(null);
    setSuccess(null);
    if (!entryIds.length) return false;

    try {
      setPostingSelectedEntries(true);
      const { data: selectedRows, error: selectedError } = await supabase
        .from("journal_entries")
        .select("id,entry_no,status")
        .in("id", entryIds);
      if (selectedError) throw new Error(selectedError.message);
      if ((selectedRows ?? []).length !== entryIds.length) {
        throw new Error("One or more selected journals could not be found. Refresh the list and select them again.");
      }
      const nonDraft = (selectedRows ?? []).find((row: any) => row.status !== "draft");
      if (nonDraft) throw new Error(`${nonDraft.entry_no} is no longer a draft. Refresh the list and retry.`);

      const { data, error: postError } = await supabase.rpc("bulk_post_journal_entries", {
        p_entry_ids: entryIds,
      });
      if (postError) throw new Error(postError.message);
      if (data && typeof data === "object" && "success" in data && (data as any).success === false) {
        throw new Error((data as any).message || "Selected journals could not be posted.");
      }

      const postedCount = Number((data as any)?.entries_posted ?? entryIds.length);
      if (postedCount !== entryIds.length) {
        throw new Error(`The posting service reported ${postedCount} of ${entryIds.length} selected journals as posted. Refresh the list to verify their statuses.`);
      }
      setSuccess(`${postedCount} selected journal ${postedCount === 1 ? "entry was" : "entries were"} posted successfully.`);
      await fetchEntries();
      return true;
    } catch (postError: any) {
      setError(postError?.message || "Failed to post selected journal entries.");
      return false;
    } finally {
      setPostingSelectedEntries(false);
    }
  }, [fetchEntries]);

  const deleteSelectedEntries = useCallback(async (entryIds: string[]) => {
    setError(null);
    setSuccess(null);
    if (!entryIds.length) return false;

    let deletedCount = 0;
    try {
      setDeletingSelectedEntries(true);
      const { data: selectedRows, error: selectedError } = await supabase
        .from("journal_entries")
        .select("id,entry_no,status")
        .in("id", entryIds);
      if (selectedError) throw new Error(selectedError.message);
      if ((selectedRows ?? []).length !== entryIds.length) {
        throw new Error("One or more selected journals could not be found. Refresh the list and select them again.");
      }
      const nonDraft = (selectedRows ?? []).find((row: any) => row.status !== "draft");
      if (nonDraft) throw new Error(`${nonDraft.entry_no} is no longer a draft. Refresh the list and retry.`);

      for (const row of selectedRows ?? []) {
        const { error: lineError } = await supabase
          .from("journal_lines")
          .delete()
          .eq("entry_id", row.id);
        if (lineError) throw new Error(`${row.entry_no}: ${lineError.message}`);

        const { data: deletedRows, error: entryError } = await supabase
          .from("journal_entries")
          .delete()
          .eq("id", row.id)
          .eq("status", "draft")
          .select("id");
        if (entryError) throw new Error(`${row.entry_no}: ${entryError.message}`);
        if ((deletedRows ?? []).length !== 1) {
          throw new Error(`${row.entry_no} was not deleted. It may have changed status or your Accounting delete permission may be missing.`);
        }
        deletedCount += 1;
      }

      setSuccess(`${deletedCount} selected draft journal ${deletedCount === 1 ? "entry was" : "entries were"} deleted.`);
      await fetchEntries();
      return true;
    } catch (deleteError: any) {
      const reason = deleteError?.message || "Failed to delete selected draft journal entries.";
      setError(deletedCount
        ? `${deletedCount} of ${entryIds.length} selected draft entries were deleted before the next deletion failed. ${reason} Refreshing the list now.`
        : reason);
      await fetchEntries();
      return false;
    } finally {
      setDeletingSelectedEntries(false);
    }
  }, [fetchEntries]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  /* =======================================================
     SINGLE ENTRY
  ======================================================= */

  const createAndOpen = async (draft: typeof form) => {

    setError(null);
    setSuccess(null);

    if (!draft.entry_no.trim()) {
      setError(
        "Entry number is required."
      );
      return;
    }

    if (!draft.entry_date) {
      setError(
        "Entry date is required."
      );
      return;
    }

    try {
      setCreating(true);
      const selectedCurrency = draft.currency_code || baseCurrency;
      if (baseCurrency && selectedCurrency !== baseCurrency) {
        const { data: effectiveRate, error: rateError } = await supabase.rpc("company_exchange_rate_on", {
          p_company_id: activeCompanyId, p_currency_code: selectedCurrency, p_on: draft.entry_date,
        });
        if (rateError) throw rateError;
        if (effectiveRate == null) throw new Error(`No ${selectedCurrency} exchange rate exists for ${draft.entry_date}. Record it in Company Settings first.`);
      }

      const {
        data,
        error: insertError,
      } = await supabase
        .from("journal_entries")
        .insert({
          entry_no:
            draft.entry_no.trim(),

          entry_date:
            draft.entry_date,

          description:
            draft.description.trim(),

          status: "draft",
          ...(baseCurrency && selectedCurrency !== baseCurrency ? { currency_code: selectedCurrency } : {}),
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(
          insertError.message
        );
      }

      if (!data) {
        throw new Error(
          "Journal entry was not created."
        );
      }

      setModalOpen(false);

      navigate(
        `/accounting/${data.id}`
      );
    } catch (err: any) {
      setError(
        err?.message ||
          "Failed to create journal entry."
      );
    } finally {
      setCreating(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void createAndOpen(form);
  };

  /* =======================================================
     RESET
  ======================================================= */

  const resetBulkImport = () => {
    setImportRows([]);
    setImportEntries([]);
    setImportFileName("");
    setImportStep("upload");
    setDraftsLoaded(false);
  };

  const closeBulkModal = () => {
    if (
      importing ||
      postingBulk
    ) {
      return;
    }

    setBulkModalOpen(false);
    resetBulkImport();
  };

  /* =======================================================
     PARSE UPLOAD
  ======================================================= */

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    setError(null);
    setSuccess(null);

    // Show file selection immediately, even when Excel validation fails.
    // Never leave a stale previous-file preview available after a failed select.
    setImportFileName(file.name);
    setImportRows([]);
    setImportStep("upload");
    setDraftsLoaded(false);
    setImportEntries([]);

    try {
      setImporting(true);

      const extension =
        file.name
          .split(".")
          .pop()
          ?.toLowerCase();

      if (
        extension !== "csv" &&
        extension !== "xls" &&
        extension !== "xlsx"
      ) {
        throw new Error(
          "Please upload CSV, XLS or XLSX journal template."
        );
      }

      let rawRows: string[][];

      if (extension === "xls" || extension === "xlsx") {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) throw new Error("The Excel workbook has no worksheet.");
        rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
          header: 1, raw: false, defval: "",
        }) as string[][];
      } else {
        rawRows = parseCSV(await file.text());
      }

      if (
        rawRows.length < 2
      ) {
        throw new Error(
          "The uploaded file does not contain enough data."
        );
      }

      // The General Journal-like simple Debit/Credit sheet goes through the
      // SAME existing advanced validation and Draft-only RPC. Previously
      // downloaded funded/advanced files remain import-compatible.
      if (isSimpleJournalTemplate(rawRows[0])) {
        rawRows = normalizeSimpleJournalRows(rawRows);
      } else if (isFundedJournalTemplate(rawRows[0])) {
        rawRows = expandFundedJournalRows(rawRows);
      }
      const headers =
        rawRows[0].map(
          normalizeHeader
        );

      const requiredHeaders = [
        "entryno",
        "entrydate",
        "description",
        "accountname",
        "debit",
        "credit",
      ];

      const missingHeaders =
        requiredHeaders.filter(
          (required) =>
            !headers.includes(
              required
            )
        );

      if (
        missingHeaders.length > 0
      ) {
        throw new Error(
          `Missing required columns: ${missingHeaders.join(
            ", "
          )}. Use one Account Name; Vehicle No can be left blank when a dedicated Income account already identifies the vehicle.`
        );
      }

      const columnIndex =
        (name: string) =>
          headers.indexOf(name);

      const parsedRows: ImportRow[] =
        [];

      for (
        let i = 1;
        i < rawRows.length;
        i++
      ) {
        const row =
          rawRows[i];

        const entryNo =
          normalize(
            row[
              columnIndex(
                "entryno"
              )
            ]
          );

        const entryDate =
          normalizeJournalImportDate(
            row[
              columnIndex(
                "entrydate"
              )
            ]
          );

        const description =
          normalize(
            row[
              columnIndex(
                "description"
              )
            ]
          );

        const accountCodeIndex =
          columnIndex(
            "accountcode"
          );

        const accountCode =
          accountCodeIndex >= 0
            ? normalize(
                row[
                  accountCodeIndex
                ]
              )
            : "";

        const accountHeadIndex=columnIndex('accounthead');
        const accountHead=accountHeadIndex>=0?normalize(row[accountHeadIndex]):'';

        const accountName =
          normalize(
            row[
              columnIndex(
                "accountname"
              )
            ]
          );

        const lineDescriptionIndex=columnIndex('linedescription');
        const lineDescription=lineDescriptionIndex>=0?normalize(row[lineDescriptionIndex]):'';
        const vehicleNoIndex=columnIndex('vehicleno');
        const vehicleNo=vehicleNoIndex>=0?normalize(row[vehicleNoIndex]):'';
        const partyTypeIndex = columnIndex('partytype');
        const partyNameIndex = columnIndex("partyname");
        const partyType = partyTypeIndex >= 0 ? normalize(row[partyTypeIndex]).toLowerCase() : "";
        const partyName = partyNameIndex >= 0 ? normalize(row[partyNameIndex]) : "";

        const debit =
          parseAmount(
            row[
              columnIndex(
                "debit"
              )
            ]
          );

        const credit =
          parseAmount(
            row[
              columnIndex(
                "credit"
              )
            ]
          );

        const isEmpty =
          !entryNo &&
          !entryDate &&
          !description &&
          !accountCode &&
          !accountHead &&
          !accountName &&
          !lineDescription &&
          !vehicleNo &&
          !partyType &&
          !partyName &&
          debit === 0 &&
          credit === 0;

        if (isEmpty) {
          continue;
        }

        parsedRows.push({
          rowNumber: i + 1,
          entryNo,
          entryDate,
          description,
          accountCode,
          accountHead,
          accountName,
          lineDescription,
          vehicleNo,
          partyType,
          partyName,
          debit,
          credit,
        });
      }

      if (
        parsedRows.length === 0
      ) {
        throw new Error(
          "No journal rows were found."
        );
      }

      // A customer name in AccountName is not a Chart of Accounts entry.
      // Do not silently post customer balances to an unlinked GL account.
      const customerLikeRows = parsedRows.filter(
        (item) =>
          !item.partyType &&
          !item.accountCode &&
          /accounts?\s+receivables?/i.test(item.accountHead) &&
          item.accountName &&
          !/accounts?\s+receivables?/i.test(item.accountName)
      );
      if (customerLikeRows.length > 0) {
        throw new Error(
          "This file appears to contain customer-wise receivables in AccountName. " +
          "Bulk Journal Import currently accepts Chart of Accounts names, not Customer Master names. " +
          "Use individual Journal Entry > Import Excel with the mapped Accounts Receivable name and Party Type/Party Name; " +
          "do not post until customer balances have been reconciled. " +
          "Affected Excel rows: " +
          customerLikeRows.map((item) => item.rowNumber).join(", ")
        );
      }

      setImportRows(
        parsedRows
      );

      setImportFileName(
        file.name
      );

      setImportStep(
        "preview"
      );
    } catch (err: any) {
      setError(
        err?.message ||
          "Failed to read import file."
      );
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  };

  /* =======================================================
     GROUP BY ENTRY NUMBER
  ======================================================= */

  const groupedImportEntries =
    useMemo(() => {
      const map =
        new Map<
          string,
          ImportEntryGroup
        >();

      for (
        const row
        of importRows
      ) {
        const key =
          normalizeKey(
            row.entryNo
          );

        if (!map.has(key)) {
          map.set(key, {
            entryNo:
              row.entryNo,

            entryDate:
              row.entryDate,

            description:
              row.description,

            rows: [],

            totalDebit: 0,

            totalCredit: 0,

            balanced: false,

            valid: true,

            errors: [] as string[],
          });
        }

        const group =
          map.get(key)!;

        group.rows.push(row);

        group.totalDebit =
          roundMoney(
            group.totalDebit +
              row.debit
          );

        group.totalCredit =
          roundMoney(
            group.totalCredit +
              row.credit
          );

        if (
          !group.entryDate &&
          row.entryDate
        ) {
          group.entryDate =
            row.entryDate;
        }

        if (
          !group.description &&
          row.description
        ) {
          group.description =
            row.description;
        }
      }

      for (
        const group
        of map.values()
      ) {
        group.balanced =
          group.rows.length > 0 &&
          Math.abs(
            group.totalDebit -
              group.totalCredit
          ) < 0.01;
      }

      return Array.from(
        map.values()
      );
    }, [importRows]);

  /* =======================================================
     VALIDATE
  ======================================================= */

  const handleValidateImport =
    async () => {
      setError(null);
      setSuccess(null);

      if (
        importRows.length === 0
      ) {
        setError(
          "There are no rows to validate."
        );
        return;
      }

      try {
        setImporting(true);

        /*
          Validation starts a new load cycle.
        */
        setDraftsLoaded(false);

        /* ---------------------------------------------------
           GET UNIQUE VALUES
        --------------------------------------------------- */

        const accountCodes =
          Array.from(
            new Set(
              importRows
                .map(
                  (row) =>
                    normalize(
                      row.accountCode
                    )
                )
                .filter(Boolean)
 …12928 tokens truncated…            onClick={() =>
                  setModalOpen(false)
                }
                className="text-slate-400 text-xl"
              >
                ×
              </button>

            </div>

            <form
              onSubmit={handleSubmit}
              className="space-y-4 mt-4"
            >

              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">

                <p className="font-semibold">
                  How to create:
                </p>

                <p>
                  Create the header,
                  then add debit/credit
                  lines on the next screen.
                </p>

              </div>

              <div>

                <label className="text-xs font-semibold">
                  Entry Number
                </label>

                <input
                  className="mt-1 w-full border rounded p-2 font-mono bg-slate-50 cursor-not-allowed"
                  required
                  readOnly
                  tabIndex={-1}
                  title="Entry number is generated automatically"
                  value={form.entry_no}
                />

              </div>

              <div>

                <label className="text-xs font-semibold">Entry Date</label>

                <NaviloDateInput
                  className="mt-1 w-full border rounded p-2"
                  type="date"
                  required
                  value={
                    form.entry_date
                  }
                  onChange={(event) =>
                    setForm({
                      ...form,
                      entry_date:
                        event.target.value,
                    })
                  }
                />

              </div>

              <div>

                {baseCurrency && availableCurrencies.length > 0 && (
                  <label className="block text-xs font-semibold">
                    Journal currency (company base: {baseCurrency})
                    <NaviloSearchableSelect nativeCompatibility preserveLabel className="mt-1 w-full border rounded p-2" value={form.currency_code || baseCurrency}
                      onChange={event => setForm(current => ({ ...current, currency_code: event.target.value }))}>
                      {availableCurrencies.map(currency => <option key={currency.code} value={currency.code}>{currency.code} · {currency.name}</option>)}
                    </NaviloSearchableSelect>
                    <span className="mt-1 block font-normal text-slate-500">Foreign entries use the rate effective on the entry date. Enter line amounts in the selected currency.</span>
                  </label>
                )}

              </div>

              <div>

                <label className="text-xs font-semibold">Description</label>

                <textarea
                  className="mt-1 w-full border rounded p-2"
                  rows={3}
                  value={
                    form.description
                  }
                  onChange={(event) =>
                    setForm({
                      ...form,
                      description:
                        event.target.value,
                    })
                  }
                />

              </div>

              <div className="flex justify-end gap-3 border-t pt-4">

                <button
                  type="button"
                  onClick={() =>
                    setModalOpen(false)
                  }
                  disabled={creating}
                  className="px-4 py-2 border rounded"
                >Cancel</button>

                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 bg-blue-600 text-white rounded"
                >
                  {creating
                    ? "Creating..."
                    : "Create & Open"}
                </button>

              </div>

            </form>

          </div>

        </div>
      )}

      {/* ===================================================
          BULK IMPORT MODAL
      =================================================== */}

      {bulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">

          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl max-h-[94vh] overflow-hidden flex flex-col">

            {/* HEADER */}

            <div className="px-6 py-5 border-b flex justify-between gap-4">

              <div>

                <h2 className="text-xl font-bold">
                  Bulk Journal Import
                </h2>

                <p className="text-sm text-slate-500 mt-1">
                  Import hundreds or
                  thousands of journal
                  lines in one file.
                </p>

              </div>

              <button
                type="button"
                onClick={
                  closeBulkModal
                }
                disabled={
                  importing ||
                  postingBulk
                }
                className="text-slate-400 text-2xl"
              >
                ×
              </button>

            </div>

            {/* BODY */}

            <div className="overflow-y-auto p-6 space-y-6">

              {/* STEPS */}

              <div className="grid grid-cols-3 gap-2">

                <div
                  className={`p-3 rounded-lg border text-center font-semibold ${
                    importStep ===
                    "upload"
                      ? "bg-blue-50 border-blue-300 text-blue-700"
                      : "bg-slate-50 text-slate-500"
                  }`}
                >
                  1. Upload
                </div>

                <div
                  className={`p-3 rounded-lg border text-center font-semibold ${
                    importStep ===
                    "preview"
                      ? "bg-blue-50 border-blue-300 text-blue-700"
                      : "bg-slate-50 text-slate-500"
                  }`}
                >
                  2. Preview
                </div>

                <div
                  className={`p-3 rounded-lg border text-center font-semibold ${
                    importStep ===
                    "validated"
                      ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                      : "bg-slate-50 text-slate-500"
                  }`}
                >
                  3. Validate
                </div>

              </div>

              {/* LOADED STATUS */}

              {draftsLoaded && (
                <div className="p-4 rounded-xl border border-blue-200 bg-blue-50">

                  <div className="flex items-center gap-2">

                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-bold">
                      ✓
                    </span>

                    <div>

                      <p className="font-bold text-blue-900">
                        Drafts Loaded Successfully
                      </p>

                      <p className="text-xs text-blue-700 mt-1">
                        The imported journal
                        entries now exist in
                        the database as Drafts.
                        You can safely Bulk
                        Post them.
                      </p>

                    </div>

                  </div>

                </div>
              )}

              {/* TEMPLATE */}

              <div className="p-5 bg-slate-50 border rounded-xl">

                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">

                  <div>

                    <h3 className="font-bold">
                      Journal Import Template
                    </h3>

                    <p className="text-xs text-slate-600 mt-1">
                      <strong>Simple Journal Excel:</strong> same Account, Line Description, Related To, Debit and Credit columns as a normal Journal Entry.
                      Use one row for Debit and another for Credit with the same Entry No. Example: Expense Dr with Vehicle 7979, Amjad Payable Cr.
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Both Simple and Advanced Excel keep explicit Debit/Credit. Posted ledgers change only after Draft review and Post.
                    </p>

                    <p className="text-xs text-slate-500 mt-1">
                      Customer/Supplier fields are required only for AR/AP. Income GLs with a unique vehicle mapping need no extra Vehicle No.
                    </p>

                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={downloadSimpleJournalTemplate}
                      className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold">
                      Simple Journal Excel (Debit / Credit)
                    </button>
                    <button
                      type="button"
                      onClick={
                        downloadCSVTemplate
                      }
                      className="px-4 py-2 bg-white border rounded-lg text-sm font-semibold"
                    >
                      Advanced CSV
                    </button>

                    <button
                      type="button"
                      onClick={
                        downloadExcelTemplate
                      }
                      className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold"
                    >
                      Advanced Excel
                    </button>

                  </div>

                </div>

                <div className="mt-2 text-[11px] text-amber-800">
                  Every transaction needs balanced Debit and Credit lines with the same Entry No.
                  Vehicle repairs: Expense Debit + Vehicle tag, Amjad Payable Credit.
                  Existing driver payable: Driver Running Debit, Amjad Payable Credit (not wages again).
                  Syarah wallet recharge: Current Asset Debit, Amjad Payable Credit (not fuel expense).
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-600">Advanced Journal Excel columns (optional)</summary>
                  <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">

                    <thead>

                      <tr>

                        {TEMPLATE_HEADERS.map(
                          (header) => (
                            <th
                              key={header}
                              className="border bg-white px-3 py-2 text-left"
                            >
                              {header}
                            </th>
                          )
                        )}

                      </tr>

                    </thead>

                    <tbody>

                      {TEMPLATE_ROWS.map(
                        (
                          row,
                          index
                        ) => (
                          <tr
                            key={index}
                          >

                            {row.map(
                              (
                                cell,
                                cellIndex
                              ) => (
                                <td
                                  key={
                                    cellIndex
                                  }
                                  className="border px-3 py-2 bg-white"
                                >
                                  {cell}
                                </td>
                              )
                            )}

                          </tr>
                        )
                      )}

                    </tbody>

                  </table>

                  </div>
                </details>

              </div>

              {/* UPLOAD */}

              <JournalImportFilePicker
                disabled={importing||postingBulk}
                processing={importing}
                fileName={importFileName}
                error={error}
                onFile={handleFileUpload}
              />

              {/* SUMMARY */}

              {importRows.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">

                  <div className="border rounded-lg p-4">

                    <div className="text-xs text-slate-400 uppercase">
                      Entries
                    </div>

                    <div className="text-xl font-bold">
                      {
                        importSummary.entries
                      }
                    </div>

                  </div>

                  <div className="border rounded-lg p-4">

                    <div className="text-xs text-slate-400 uppercase">
                      Lines
                    </div>

                    <div className="text-xl font-bold">
                      {
                        importSummary.lines
                      }
                    </div>

                  </div>

                  <div className="border rounded-lg p-4">

                    <div className="text-xs text-slate-400 uppercase">
                      Valid
                    </div>

                    <div className="text-xl font-bold text-emerald-600">
                      {
                        importSummary.valid
                      }
                    </div>

                  </div>

                  <div className="border rounded-lg p-4">

                    <div className="text-xs text-slate-400 uppercase">
                      Errors
                    </div>

                    <div className="text-xl font-bold text-rose-600">
                      {
                        importSummary.invalid
                      }
                    </div>

                  </div>

                  <div className="border rounded-lg p-4">

                    <div className="text-xs text-slate-400 uppercase">
                      Difference
                    </div>

                    <div
                      className={`text-xl font-bold ${
                        Math.abs(
                          importSummary.debit -
                            importSummary.credit
                        ) < 0.01
                          ? "text-emerald-600"
                          : "text-rose-600"
                      }`}
                    >
                      {Math.abs(
                        importSummary.debit -
                          importSummary.credit
                      ).toFixed(2)}
                    </div>

                  </div>

                </div>
              )}

              {/* PREVIEW */}

              {importRows.length > 0 && (
                <div className="border rounded-xl overflow-hidden">

                  <div className="px-5 py-4 bg-slate-50 border-b flex justify-between gap-3">

                    <div>

                      <h3 className="font-bold">
                        Import Preview
                      </h3>

                      <p className="text-xs text-slate-500 mt-1">
                        {importRows.length}
                        {" "}
                        lines found.
                      </p>

                    </div>

                    <button
                      type="button"
                      onClick={
                        handleValidateImport
                      }
                      disabled={
                        importing ||
                        postingBulk ||
                        draftsLoaded
                      }
                      className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                    >
                      {importing
                        ? "Validating..."
                        : draftsLoaded
                        ? "✓ Already Loaded"
                        : "✓ Validate Import"}
                    </button>

                  </div>

                  <div className="overflow-x-auto max-h-[420px]">

                    <table className="w-full text-xs">

                      <thead className="sticky top-0 bg-white">

                        <tr className="border-b">

                          <th className="px-3 py-3 text-left">
                            Row
                          </th>

                          <th className="px-3 py-3 text-left">
                            Entry #
                          </th>

                          <th className="px-3 py-3 text-left">Date</th>

                          <th className="px-3 py-3 text-left">
                            Account
                          </th>

                          <th className="px-3 py-3 text-left">Line Description</th>
                          <th className="px-3 py-3 text-left">Related To</th>
                          <th className="px-3 py-3 text-right">Debit</th>

                          <th className="px-3 py-3 text-right">Credit</th>

                        </tr>

                      </thead>

                      <tbody>

                        {importRows.map(
                          (row) => (
                            <tr
                              key={`${row.rowNumber}-${row.entryNo}-${row.accountCode}-${row.accountHead}-${row.accountName}`}
                              className="border-b hover:bg-slate-50"
                            >

                              <td className="px-3 py-2 text-slate-400">
                                {
                                  row.rowNumber
                                }
                              </td>

                              <td className="px-3 py-2 font-semibold">
                                {
                                  row.entryNo
                                }
                              </td>

                              <td className="px-3 py-2">
                                {
                                  row.entryDate
                                }
                              </td>

                              <td className="px-3 py-2">
                                <div className="font-semibold text-slate-900">{row.accountName || "—"}</div>
                                {row.accountHead && <div className="text-xs text-slate-500">Under: {row.accountHead}</div>}
                              </td>

                              <td className="px-3 py-2 text-slate-600">{row.lineDescription || "—"}</td>
                              <td className="px-3 py-2">{row.vehicleNo ? `Vehicle ${row.vehicleNo}` :
                                row.partyType && row.partyName ? `${row.partyType}: ${row.partyName}` : "From account (auto if dedicated)"}</td>
                              <td className="px-3 py-2 text-right font-mono">

                                {row.debit > 0
                                  ? row.debit.toFixed(
                                      2
                                    )
                                  : "—"}

                              </td>

                              <td className="px-3 py-2 text-right font-mono">

                                {row.credit > 0
                                  ? row.credit.toFixed(
                                      2
                                    )
                                  : "—"}

                              </td>

                            </tr>
                          )
                        )}

                      </tbody>

                    </table>

                  </div>

                </div>
              )}

              {/* VALIDATION RESULTS */}

              {importStep ===
                "validated" &&
                importEntries.length >
                  0 && (
                  <div className="border rounded-xl overflow-hidden">

                    <div className="px-5 py-4 bg-slate-50 border-b">

                      <h3 className="font-bold">
                        Validation Results
                      </h3>

                      <p className="text-xs text-slate-500 mt-1">
                        Only valid entries
                        can be loaded or
                        posted.
                      </p>

                    </div>

                    <div className="overflow-x-auto">

                      <table className="w-full text-sm">

                        <thead>

                          <tr className="border-b">

                            <th className="px-4 py-3 text-left">
                              Entry #
                            </th>

                            <th className="px-4 py-3 text-left">Date</th>

                            <th className="px-4 py-3 text-right">
                              Lines
                            </th>

                            <th className="px-4 py-3 text-right">Debit</th>

                            <th className="px-4 py-3 text-right">Credit</th>

                            <th className="px-4 py-3 text-center">Status</th>

                          </tr>

                        </thead>

                        <tbody>

                          {importEntries.map(
                            (group) => (
                              <tr
                                key={
                                  group.entryNo
                                }
                                className={
                                  group.valid
                                    ? "bg-emerald-50/30"
                                    : "bg-rose-50/30"
                                }
                              >

                                <td className="px-4 py-3 font-semibold">
                                  {
                                    group.entryNo
                                  }
                                </td>

                                <td className="px-4 py-3">
                                  {
                                    group.entryDate
                                  }
                                </td>

                                <td className="px-4 py-3 text-right">
                                  {
                                    group.rows.length
                                  }
                                </td>

                                <td className="px-4 py-3 text-right font-mono">
                                  {
                                    group.totalDebit.toFixed(
                                      2
                                    )
                                  }
                                </td>

                                <td className="px-4 py-3 text-right font-mono">
                                  {
                                    group.totalCredit.toFixed(
                                      2
                                    )
                                  }
                                </td>

                                <td className="px-4 py-3 text-center">

                                  {group.valid ? (
                                    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                                      ✓ Valid
                                    </span>
                                  ) : (
                                    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700">
                                      ✕ Error
                                    </span>
                                  )}

                                </td>

                              </tr>
                            )
                          )}

                        </tbody>

                      </table>

                    </div>

                    {/* ERROR DETAILS */}

                    {importEntries.some(
                      (group) =>
                        !group.valid
                    ) && (
                      <div className="p-5 border-t border-rose-200 bg-rose-50">

                        <h4 className="font-bold text-rose-800">
                          Validation Errors
                        </h4>

                        <div className="mt-3 space-y-3">

                          {importEntries
                            .filter(
                              (group) =>
                                !group.valid
                            )
                            .map(
                              (group) => (
                                <div
                                  key={
                                    group.entryNo
                                  }
                                  className="bg-white border border-rose-200 rounded-lg p-4"
                                >

                                  <div className="font-semibold text-rose-800">
                                    {
                                      group.entryNo
                                    }
                                  </div>

                                  <ul className="mt-2 list-disc list-inside text-xs text-rose-700 space-y-1">

                                    {group.errors.map(
                                      (
                                        message,
                                        index
                                      ) => (
                                        <li
                                          key={
                                            index
                                          }
                                        >
                                          {
                                            message
                                          }
                                        </li>
                                      )
                                    )}

                                  </ul>

                                </div>
                              )
                            )}

                        </div>

                      </div>
                    )}

                  </div>
                )}

            </div>

            {/* FOOTER */}

            <div className="px-6 py-4 border-t bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-3">

              <div className="text-xs text-slate-500">

                <span className="font-semibold">
                  Important:
                </span>{" "}

                Use Account Head and Account Name to select the posting account.

                Posting is made to the
                actual child/posting account.

                {draftsLoaded
                  ? " Drafts are loaded and ready for posting."
                  : " Validate before loading."}

              </div>

              <div className="flex flex-wrap gap-2">

                <button
                  type="button"
                  onClick={
                    closeBulkModal
                  }
                  disabled={
                    importing ||
                    postingBulk
                  }
                  className="px-4 py-2 border bg-white rounded-lg text-sm font-semibold"
                >Cancel</button>

                {importStep ===
                  "validated" &&
                  importEntries.some(
                    (group) =>
                      group.valid
                  ) && (
                    <>

                      {/* BULK LOAD */}

                      {!draftsLoaded && (
                        <button
                          type="button"
                          onClick={
                            handleBulkLoad
                          }
                          disabled={
                            importing ||
                            postingBulk
                          }
                          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                        >
                          {importing
                            ? "Loading..."
                            : "↓ Bulk Load Drafts"}
                        </button>
                      )}

                      {/* BULK POST */}

                      <button
                        type="button"
                        onClick={
                          handleBulkPost
                        }
                        disabled={
                          importing ||
                          postingBulk ||
                          !draftsLoaded
                        }
                        className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                      >
                        {postingBulk
                          ? "Posting..."
                          : draftsLoaded
                          ? "✓ Bulk Post"
                          : "✓ Bulk Post (Load Drafts First)"}
                      </button>

                    </>
                  )}

              </div>

            </div>

          </div>

        </div>
      )}

    </div>
  );
}
