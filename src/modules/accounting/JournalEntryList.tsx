import {
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";

import { useNavigate } from "react-router-dom";
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

const TEMPLATE_HEADERS = [
  "entry_no",
  "entry_date",
  "description",
  "account_code",
  "account_head",
  "account_name",
  "debit",
  "credit",
];

const TEMPLATE_ROWS = [
  [
    "JE-1001",
    "2026-08-26",
    "Payment to Amjad Khan",
    "",
    "Accounts Payable",
    "Amjad Khan",
    "0",
    "5000",
  ],
  [
    "JE-1001",
    "2026-08-26",
    "Payment to Amjad Khan",
    "1000",
    "Cash",
    "Cash",
    "5000",
    "0",
  ],
  [
    "JE-1002",
    "2026-08-26",
    "Office expense",
    "",
    "Office Expenses",
    "Office Rent",
    "2000",
    "0",
  ],
  [
    "JE-1002",
    "2026-08-26",
    "Office expense",
    "",
    "Office Expenses",
    "Stationery",
    "1000",
    "0",
  ],
  [
    "JE-1002",
    "2026-08-26",
    "Office expense",
    "",
    "Cash",
    "Cash",
    "0",
    "3000",
  ],
];

/* =========================================================
   CSV TEMPLATE
========================================================= */

const downloadCSVTemplate = () => {
  const rows = [
    TEMPLATE_HEADERS,
    ...TEMPLATE_ROWS,
  ];

  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell);

          if (
            value.includes(",") ||
            value.includes('"') ||
            value.includes("\n")
          ) {
            return `"${value.replace(
              /"/g,
              '""'
            )}"`;
          }

          return value;
        })
        .join(",")
    )
    .join("\r\n");

  const blob = new Blob(
    [csv],
    {
      type: "text/csv;charset=utf-8;",
    }
  );

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href = url;
  link.download =
    "journal-import-template.csv";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
};

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

const downloadExcelTemplate = () => {
  const worksheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_ROWS]);
  worksheet["!cols"] = [
    { wch: 18 }, { wch: 14 }, { wch: 34 }, { wch: 18 },
    { wch: 30 }, { wch: 34 }, { wch: 16 }, { wch: 16 },
  ];
  worksheet["!autofilter"] = { ref: `A1:H${TEMPLATE_ROWS.length + 1}` };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Journal Import");
  XLSX.writeFile(workbook, "journal-import-template.xlsx");
};

/* =========================================================
   COMPONENT
========================================================= */

export default function JournalEntryList() {
  const navigate = useNavigate();

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
    useState(false);

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
        });

      if (fetchError) {
        setError(
          fetchError.message
        );
      } else {
        setEntries(
          (data ?? []) as JournalEntry[]
        );
      }

      setLoading(false);
    }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  /* =======================================================
     SINGLE ENTRY
  ======================================================= */

  const handleSubmit = async (
    event: React.FormEvent
  ) => {
    event.preventDefault();

    setError(null);
    setSuccess(null);

    if (!form.entry_no.trim()) {
      setError(
        "Entry number is required."
      );
      return;
    }

    if (!form.entry_date) {
      setError(
        "Entry date is required."
      );
      return;
    }

    try {
      setCreating(true);
      const selectedCurrency = form.currency_code || baseCurrency;
      if (baseCurrency && selectedCurrency !== baseCurrency) {
        const { data: effectiveRate, error: rateError } = await supabase.rpc("company_exchange_rate_on", {
          p_company_id: activeCompanyId, p_currency_code: selectedCurrency, p_on: form.entry_date,
        });
        if (rateError) throw rateError;
        if (effectiveRate == null) throw new Error(`No ${selectedCurrency} exchange rate exists for ${form.entry_date}. Record it in Company Settings first.`);
      }

      const {
        data,
        error: insertError,
      } = await supabase
        .from("journal_entries")
        .insert({
          entry_no:
            form.entry_no.trim(),

          entry_date:
            form.entry_date,

          description:
            form.description.trim(),

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

    /*
      A new upload means we are starting
      a completely new import session.
    */
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

      const headers =
        rawRows[0].map(
          normalizeHeader
        );

      const requiredHeaders = [
        "entryno",
        "entrydate",
        "description",
        "accounthead",
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
          )}. AccountCode is optional.`
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
          normalize(
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

        const accountHead =
          normalize(
            row[
              columnIndex(
                "accounthead"
              )
            ]
          );

        const accountName =
          normalize(
            row[
              columnIndex(
                "accountname"
              )
            ]
          );

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
            )
          );

        const accountHeads =
          Array.from(
            new Set(
              importRows
                .map(
                  (row) =>
                    normalize(
                      row.accountHead
                    )
                )
                .filter(Boolean)
            )
          );

        const accountNames =
          Array.from(
            new Set(
              importRows
                .map(
                  (row) =>
                    normalize(
                      row.accountName
                    )
                )
                .filter(Boolean)
            )
          );

        /* ---------------------------------------------------
           FETCH ACCOUNTS
        --------------------------------------------------- */

        let accountRows: any[] = [];

        if (
          accountCodes.length > 0
        ) {
          const {
            data,
            error:
              codeError,
          } = await supabase
            .from(
              "chart_of_accounts"
            )
            .select("*")
            .in(
              "code",
              accountCodes
            );

          if (codeError) {
            throw new Error(
              codeError.message
            );
          }

          accountRows.push(
            ...(data ?? [])
          );
        }

        if (
          accountNames.length > 0
        ) {
          const {
            data,
            error:
              nameError,
          } = await supabase
            .from(
              "chart_of_accounts"
            )
            .select("*")
            .in(
              "name",
              accountNames
            );

          if (nameError) {
            throw new Error(
              nameError.message
            );
          }

          accountRows.push(
            ...(data ?? [])
          );
        }

        if (
          accountHeads.length > 0
        ) {
          const {
            data,
            error:
              headError,
          } = await supabase
            .from(
              "chart_of_accounts"
            )
            .select("*")
            .in(
              "name",
              accountHeads
            );

          if (headError) {
            throw new Error(
              headError.message
            );
          }

          accountRows.push(
            ...(data ?? [])
          );
        }

        /* ---------------------------------------------------
           REMOVE DUPLICATES
        --------------------------------------------------- */

        const uniqueAccounts =
          Array.from(
            new Map(
              accountRows.map(
                (account) => [
                  account.id,
                  account,
                ]
              )
            ).values()
          );

        /* ---------------------------------------------------
           ACCOUNT MAPS
        --------------------------------------------------- */

        const accountByCode =
          new Map<
            string,
            any
          >();

        const accountByName =
          new Map<
            string,
            any[]
          >();

        const accountById =
          new Map<
            string,
            any
          >();

        for (
          const account
          of uniqueAccounts
        ) {
          accountById.set(
            account.id,
            account
          );

          if (
            account.code
          ) {
            accountByCode.set(
              normalizeKey(
                account.code
              ),
              account
            );
          }

          if (
            account.name
          ) {
            const nameKey =
              normalizeKey(
                account.name
              );

            const existing =
              accountByName.get(
                nameKey
              ) ?? [];

            existing.push(
              account
            );

            accountByName.set(
              nameKey,
              existing
            );
          }
        }

        /*
          IMPORTANT FIX:

          Fetch parent accounts for children
          that were found by name/code.

          This makes parent/head checking
          reliable even when the parent itself
          was not part of the initial search.
        */

        const parentIds =
          Array.from(
            new Set(
              uniqueAccounts
                .map(
                  (account) =>
                    account.parent_id
                )
                .filter(Boolean)
            )
          );

        if (
          parentIds.length > 0
        ) {
          const {
            data:
              parentRows,
            error:
              parentError,
          } = await supabase
            .from(
              "chart_of_accounts"
            )
            .select("*")
            .in(
              "id",
              parentIds
            );

          if (parentError) {
            throw new Error(
              parentError.message
            );
          }

          for (
            const parent
            of parentRows ?? []
          ) {
            accountById.set(
              parent.id,
              parent
            );

            if (
              parent.name
            ) {
              const nameKey =
                normalizeKey(
                  parent.name
                );

              const existing =
                accountByName.get(
                  nameKey
                ) ?? [];

              if (
                !existing.some(
                  (item) =>
                    item.id ===
                    parent.id
                )
              ) {
                existing.push(
                  parent
                );
              }

              accountByName.set(
                nameKey,
                existing
              );
            }

            if (
              parent.code
            ) {
              accountByCode.set(
                normalizeKey(
                  parent.code
                ),
                parent
              );
            }
          }
        }

        /* ---------------------------------------------------
           EXISTING ENTRY NUMBERS
        --------------------------------------------------- */

        const existingEntryNumbers =
          new Set(
            entries.map(
              (entry) =>
                normalizeKey(
                  entry.entry_no
                )
            )
          );

        /*
          Also detect duplicates INSIDE
          the uploaded file itself.
        */

        const uploadedEntryNumbers =
          new Set<string>();

        const duplicateUploadedNumbers =
          new Set<string>();

        for (
          const row
          of importRows
        ) {
          const key =
            normalizeKey(
              row.entryNo
            );

          if (
            !key
          ) {
            continue;
          }

          if (
            uploadedEntryNumbers.has(
              key
            )
          ) {
            duplicateUploadedNumbers.add(
              key
            );
          }

          uploadedEntryNumbers.add(
            key
          );
        }

        /*
          Duplicate entry numbers are expected
          across lines, so the above is NOT an
          error by itself.

          We therefore only use this set to
          identify the same group, not reject it.
        */

        void duplicateUploadedNumbers;

        /* ---------------------------------------------------
           VALIDATE GROUPS
        --------------------------------------------------- */

        const newGroups: ImportEntryGroup[] =
          groupedImportEntries.map(
            (group): ImportEntryGroup => ({
              ...group,
              errors: [] as string[],
              valid: true,
              loadedEntryId:
                undefined,
            })
          );

        for (
          const group
          of newGroups
        ) {
          const errors: string[] = [];

          /* ENTRY NUMBER */

          if (
            !group.entryNo
          ) {
            errors.push(
              "Entry number is missing."
            );
          }

          if (
            group.entryNo &&
            existingEntryNumbers.has(
              normalizeKey(
                group.entryNo
              )
            )
          ) {
            errors.push(
              `Entry number "${group.entryNo}" already exists.`
            );
          }

          /* DATE */

          if (
            !isValidDate(
              group.entryDate
            )
          ) {
            errors.push(
              `Invalid date "${group.entryDate}". Use YYYY-MM-DD.`
            );
          }

          /* LINES */

          if (
            group.rows.length === 0
          ) {
            errors.push(
              "Journal entry has no lines."
            );
          }

          /* BALANCE */

          if (
            !group.balanced
          ) {
            errors.push(
              `Not balanced. Debit${group.totalDebit.toFixed(
                2
              )} must equal Credit${group.totalCredit.toFixed(
                2
              )}.`
            );
          }

          /* ROW VALIDATION */

          for (
            const row
            of group.rows
          ) {
            let account: any =
              null;

            /* ACCOUNT CODE */

            if (
              row.accountCode
            ) {
              account =
                accountByCode.get(
                  normalizeKey(
                    row.accountCode
                  )
                ) ?? null;

              if (
                !account
              ) {
                errors.push(
                  `Row ${row.rowNumber}: Accountcode "${row.accountCode}" was not found.`
                );

                continue;
              }
            }

            /* ACCOUNT NAME + HEAD */

            if (
              !account &&
              row.accountName
            ) {
              const candidates =
                accountByName.get(
                  normalizeKey(
                    row.accountName
                  )
                ) ?? [];

              if (
                candidates.length === 1
              ) {
                account =
                  candidates[0];
              } else if (
                candidates.length > 1
              ) {
                if (
                  row.accountHead
                ) {
                  const matching =
                    candidates.filter(
                      (
                        candidate
                      ) => {
                        const parentId =
                          candidate.parent_id;

                        const parent =
                          parentId
                            ? accountById.get(
                                parentId
                              )
                            : null;

                        const candidateParentName =
                          normalizeKey(
                            parent?.name ??
                              candidate.parent_head ??
                              ""
                          );

                        return (
                          candidateParentName ===
                          normalizeKey(
                            row.accountHead
                          )
                        );
                      }
                    );

                  if (
                    matching.length ===
                    1
                  ) {
                    account =
                      matching[0];
                  } else if (
                    matching.length ===
                    0
                  ) {
                    errors.push(
                      `Row ${row.rowNumber}: Account"${row.accountName}" was found, but it could not be matched to AccountHead "${row.accountHead}".`
                    );

                    continue;
                  } else {
                    errors.push(
                      `Row ${row.rowNumber}: Multiple "${row.accountName}" accounts exist under "${row.accountHead}". Please provide AccountCode.`
                    );

                    continue;
                  }
                } else {
                  errors.push(
                    `Row ${row.rowNumber}: Multiple accounts named "${row.accountName}" exist. AccountHead or AccountCode is required.`
                  );

                  continue;
                }
              } else {
                errors.push(
                  `Row ${row.rowNumber}: Account"${row.accountName}" was not found in Chart of Accounts.`
                );

                continue;
              }
            }

            /* ACCOUNT REQUIRED */

            if (
              !account
            ) {
              errors.push(
                `Row ${row.rowNumber}: AccountName is required.`
              );

              continue;
            }

            /* HEAD CHECK */

            if (
              row.accountHead
            ) {
              const parentId =
                account.parent_id;

              const parent =
                parentId
                  ? accountById.get(
                      parentId
                    )
                  : null;

              const storedParentName =
                normalizeKey(
                  parent?.name ??
                    account.parent_head ??
                    ""
                );

              const enteredHead =
                normalizeKey(
                  row.accountHead
                );

              if (
                storedParentName &&
                storedParentName !==
                  enteredHead
              ) {
                errors.push(
                  `Row ${row.rowNumber}: Account"${account.name}" does not belong to AccountHead "${row.accountHead}".`
                );
              }
            }

            /* GROUP ACCOUNT */

            if (
              account.is_group
            ) {
              errors.push(
                `Row ${row.rowNumber}: "${account.name}" is a group account. Select the actual child/posting account.`
              );
            }

            /* ACTIVE */

            if (
              account.is_active === false
            ) {
              errors.push(
                `Row ${row.rowNumber}: "${account.name}" is inactive.`
              );
            }

            /* MANUAL POSTING */

            if (
              account.allow_manual_entries ===
              false
            ) {
              errors.push(
                `Row ${row.rowNumber}: "${account.name}" does not allow manual journal entries.`
              );
            }

            /* DEBIT / CREDIT */

            if (
              row.debit > 0 &&
              row.credit > 0
            ) {
              errors.push(
                `Row ${row.rowNumber}: Debitand Creditcannot both contain values.`
              );
            }

            if (
              row.debit <= 0 &&
              row.credit <= 0
            ) {
              errors.push(
                `Row ${row.rowNumber}: Enter either Debitor Credit.`
              );
            }
          }

          group.errors = errors;
          group.valid =
            errors.length === 0;
        }

        setImportEntries(
          newGroups
        );

        setImportStep(
          "validated"
        );

        const invalidCount =
          newGroups.filter(
            (group) =>
              !group.valid
          ).length;

        if (
          invalidCount === 0
        ) {
          setSuccess(
            `${newGroups.length} journal ${
              newGroups.length === 1
                ? "entry"
                : "entries"
            } passed validation and is ready.`
          );
        } else {
          setError(
            `${invalidCount} journal ${
              invalidCount === 1
                ? "entry has"
                : "entries have"
            } validation errors.`
          );
        }
      } catch (err: any) {
        setError(
          err?.message ||
            "Validation failed."
        );
      } finally {
        setImporting(false);
      }
    };

  /* =======================================================
     BUILD RPC PAYLOAD
  ======================================================= */

  const buildBulkPayload = (
    groups: ImportEntryGroup[]
  ) =>
    groups.map(
      (group) => ({
        entry_no:
          group.entryNo,

        entry_date:
          group.entryDate,

        description:
          group.description,

        lines:
          group.rows.map(
            (row) => ({
              account_code:
                row.accountCode ||
                null,

              account_head:
                row.accountHead ||
                null,

              account_name:
                row.accountName ||
                null,

              debit:
                roundMoney(
                  row.debit
                ),

              credit:
                roundMoney(
                  row.credit
                ),
            })
          ),
      })
    );

  /* =======================================================
     BULK LOAD DRAFTS
  ======================================================= */

  const handleBulkLoad =
    async () => {
      setError(null);
      setSuccess(null);

      const validGroups =
        importEntries.filter(
          (group) =>
            group.valid
        );

      if (
        validGroups.length === 0
      ) {
        setError(
          "There are no valid journal entries to load."
        );

        return;
      }

      /*
        Prevent accidentally loading the
        same import twice.
      */
      if (draftsLoaded) {
        setError(
          "These entries have already been loaded as Drafts. You can Bulk Post them now."
        );

        return;
      }

      try {
        setImporting(true);

        const payload =
          buildBulkPayload(
            validGroups
          );

        /* FINAL DUPLICATE CHECK */

        const entryNumbers =
          validGroups.map(
            (group) =>
              group.entryNo
          );

        const {
          data:
            existingRows,
          error:
            existingError,
        } = await supabase
          .from(
            "journal_entries"
          )
          .select(
            "id,entry_no"
          )
          .in(
            "entry_no",
            entryNumbers
          );

        if (existingError) {
          throw new Error(
            existingError.message
          );
        }

        if (
          existingRows &&
          existingRows.length > 0
        ) {
          throw new Error(
            `These journal entries already exist: ${existingRows
              .map(
                (row: any) =>
                  row.entry_no
              )
              .join(", ")}`
          );
        }

        /* RPC */

        const {
          data,
          error:
            rpcError,
        } = await supabase.rpc(
          "bulk_load_journal_entries",
          {
            p_entries:
              payload,
          }
        );

        if (rpcError) {
          throw new Error(
            rpcError.message
          );
        }

        /*
          RPC may return:
          {
            count: number,
            entries: [
              { id, entry_no }
            ]
          }

          Or only:
          {
            count: number
          }

          Therefore we handle both safely.
        */

        const createdCount =
          Number(
            data?.count ??
              data?.entries?.length ??
              validGroups.length
          );

        const returnedEntries =
          Array.isArray(
            data?.entries
          )
            ? (data.entries as BulkRpcEntry[])
            : [];

        /*
          Map returned DB IDs back to
          imported groups.
        */

        const loadedGroups =
          validGroups.map(
            (group) => {
              const returned =
                returnedEntries.find(
                  (item) =>
                    normalizeKey(
                      item.entry_no
                    ) ===
                    normalizeKey(
                      group.entryNo
                    )
                );

              return {
                ...group,
                loadedEntryId:
                  returned?.id,
              };
            }
          );

        /*
          If RPC did not return IDs,
          fetch them from DB using entry_no.
        */

        const groupsMissingIds =
          loadedGroups.filter(
            (group) =>
              !group.loadedEntryId
          );

        if (
          groupsMissingIds.length > 0
        ) {
          const {
            data:
              fetchedLoadedRows,
            error:
              fetchedLoadedError,
          } = await supabase
            .from(
              "journal_entries"
            )
            .select(
              "id,entry_no,status"
            )
            .in(
              "entry_no",
              validGroups.map(
                (group) =>
                  group.entryNo
              )
            );

          if (fetchedLoadedError) {
            throw new Error(
              fetchedLoadedError.message
            );
          }

          for (
            const group
            of loadedGroups
          ) {
            if (
              group.loadedEntryId
            ) {
              continue;
            }

            const dbRow =
              fetchedLoadedRows?.find(
                (row: any) =>
                  normalizeKey(
                    row.entry_no
                  ) ===
                  normalizeKey(
                    group.entryNo
                  )
              );

            if (dbRow) {
              group.loadedEntryId =
                dbRow.id;
            }
          }
        }

        /*
          IMPORTANT FIX:

          Keep modal open.
          Keep importEntries.
          Mark drafts as loaded.
        */

        setImportEntries(
          loadedGroups
        );

        setDraftsLoaded(true);

        setSuccess(
          `${createdCount} journal ${
            createdCount === 1
              ? "entry was"
              : "entries were"
          } loaded successfully as Draft. You can now Bulk Post.`
        );

        await fetchEntries();
      } catch (err: any) {
        setError(
          err?.message ||
            "Bulk Load failed."
        );
      } finally {
        setImporting(false);
      }
    };

  /* =======================================================
     BULK POST
  ======================================================= */

  const handleBulkPost =
    async () => {
      setError(null);
      setSuccess(null);

      const validGroups =
        importEntries.filter(
          (group) =>
            group.valid
        );

      if (
        validGroups.length === 0
      ) {
        setError(
          "There are no valid entries to post."
        );

        return;
      }

      /*
        Post must happen after Draft Load.
      */
      if (!draftsLoaded) {
        setError(
          "Please Bulk Load Drafts first, then Bulk Post."
        );

        return;
      }

      try {
        setPostingBulk(true);

        /* ---------------------------------------------------
           FIND LOADED ENTRIES
        --------------------------------------------------- */

        const loadedEntryIds =
          validGroups
            .map(
              (group) =>
                group.loadedEntryId
            )
            .filter(
              (
                id
              ): id is string =>
                Boolean(id)
            );

        let dbEntries: any[] =
          [];

        /*
          Prefer IDs returned/fetched
          during Bulk Load.
        */

        if (
          loadedEntryIds.length ===
          validGroups.length
        ) {
          const {
            data,
            error:
              dbEntryError,
          } = await supabase
            .from(
              "journal_entries"
            )
            .select(
              "id,entry_no,status"
            )
            .in(
              "id",
              loadedEntryIds
            );

          if (dbEntryError) {
            throw new Error(
              dbEntryError.message
            );
          }

          dbEntries =
            data ?? [];
        } else {
          /*
            Fallback: locate by entry_no.
          */

          const entryNumbers =
            validGroups.map(
              (group) =>
                group.entryNo
            );

          const {
            data,
            error:
              dbEntryError,
          } = await supabase
            .from(
              "journal_entries"
            )
            .select(
              "id,entry_no,status"
            )
            .in(
              "entry_no",
              entryNumbers
            );

          if (dbEntryError) {
            throw new Error(
              dbEntryError.message
            );
          }

          dbEntries =
            data ?? [];
        }

        /* COUNT CHECK */

        if (
          dbEntries.length !==
          validGroups.length
        ) {
          throw new Error(
            "Some imported entries were not found. Please Bulk Load Drafts first."
          );
        }

        /* DRAFT CHECK */

        const nonDraft =
          dbEntries.find(
            (entry: any) =>
              entry.status !==
              "draft"
          );

        if (nonDraft) {
          throw new Error(
            `${nonDraft.entry_no} is not in Draft status.`
          );
        }

        const entryIds =
          dbEntries.map(
            (entry: any) =>
              entry.id
          );

        /* ---------------------------------------------------
           CHECK LINES
        --------------------------------------------------- */

        const {
          data:
            lines,
          error:
            lineError,
        } = await supabase
          .from(
            "journal_lines"
          )
          .select(
            "id,entry_id,debit,credit"
          )
          .in(
            "entry_id",
            entryIds
          );

        if (lineError) {
          throw new Error(
            lineError.message
          );
        }

        if (
          !lines ||
          lines.length === 0
        ) {
          throw new Error(
            "No journal lines found. Please Bulk Load Drafts first."
          );
        }

        /* ---------------------------------------------------
           BALANCE CHECK
        --------------------------------------------------- */

        for (
          const entry
          of dbEntries
        ) {
          const entryLines =
            lines.filter(
              (line: any) =>
                line.entry_id ===
                entry.id
            );

          if (
            entryLines.length ===
            0
          ) {
            throw new Error(
              `${entry.entry_no}: No journal lines found.`
            );
          }

          const debit =
            roundMoney(
              entryLines.reduce(
                (
                  total: number,
                  line: any
                ) =>
                  total +
                  Number(
                    line.debit || 0
                  ),
                0
              )
            );

          const credit =
            roundMoney(
              entryLines.reduce(
                (
                  total: number,
                  line: any
                ) =>
                  total +
                  Number(
                    line.credit || 0
                  ),
                0
              )
            );

          if (
            Math.abs(
              debit - credit
            ) >= 0.01
          ) {
            throw new Error(
              `${entry.entry_no}: Not balanced. Debit${debit.toFixed(
                2
              )} != Credit${credit.toFixed(
                2
              )}.`
            );
          }
        }

        /* ---------------------------------------------------
           EXISTING LEDGER
        --------------------------------------------------- */

        const {
          data:
            existingLedger,
          error:
            ledgerError,
        } = await supabase
          .from(
            "ledgers"
          )
          .select(
            "id,journal_entry_id"
          )
          .in(
            "journal_entry_id",
            entryIds
          );

        if (ledgerError) {
          throw new Error(
            ledgerError.message
          );
        }

        if (
          existingLedger &&
          existingLedger.length > 0
        ) {
          const duplicateIds =
            new Set(
              existingLedger.map(
                (row: any) =>
                  row.journal_entry_id
              )
            );

          const duplicateEntries =
            dbEntries.filter(
              (entry: any) =>
                duplicateIds.has(
                  entry.id
                )
            );

          throw new Error(
            `Ledger already exists for: ${duplicateEntries
              .map(
                (entry: any) =>
                  entry.entry_no
              )
              .join(", ")}`
          );
        }

        /* ---------------------------------------------------
           POST RPC
        --------------------------------------------------- */

        const {
          data:
            postResult,
          error:
            postError,
        } = await supabase.rpc(
          "bulk_post_journal_entries",
          {
            p_entry_ids:
              entryIds,
          }
        );

        if (postError) {
          throw new Error(
            postError.message
          );
        }

        const postedCount =
          Number(
            postResult?.entries_posted ??
              dbEntries.length
          );

        const ledgerCount =
          Number(
            postResult?.ledger_rows_created ??
              lines.length
          );

        setSuccess(
          `${postedCount} journal ${
            postedCount === 1
              ? "entry was"
              : "entries were"
          } posted successfully and ${ledgerCount} ledger rows were created.`
        );

        /*
          Posting complete.

          Now it is safe to close and reset.
        */

        setBulkModalOpen(
          false
        );

        resetBulkImport();

        await fetchEntries();
      } catch (err: any) {
        setError(
          err?.message ||
            "Bulk posting failed."
        );
      } finally {
        setPostingBulk(false);
      }
    };

  /* =======================================================
     SUMMARY
  ======================================================= */

  const importSummary =
    useMemo(() => {
      const groups =
        importStep ===
        "validated"
          ? importEntries
          : groupedImportEntries;

      return {
        entries:
          groups.length,

        lines:
          importRows.length,

        valid:
          groups.filter(
            (group) =>
              group.valid
          ).length,

        invalid:
          groups.filter(
            (group) =>
              !group.valid
          ).length,

        debit:
          roundMoney(
            groups.reduce(
              (
                sum,
                group
              ) =>
                sum +
                group.totalDebit,
              0
            )
          ),

        credit:
          roundMoney(
            groups.reduce(
              (
                sum,
                group
              ) =>
                sum +
                group.totalCredit,
              0
            )
          ),
      };
    }, [
      importEntries,
      groupedImportEntries,
      importRows,
      importStep,
    ]);

  /* =======================================================
     PRINT JOURNAL VOUCHER
  ======================================================= */

  const printJournalVoucher = useCallback(async (entry: JournalEntry) => {
    try {
      setError(null);

      const { data: lines, error: linesError } = await supabase
        .from("journal_lines")
        .select(`id, account, debit, credit, account_id, coa:chart_of_accounts(code,name)`)
        .eq("entry_id", entry.id)
        .order("id", { ascending: true });

      if (linesError) throw new Error(linesError.message);
      const foreign = Boolean(baseCurrency && entry.currency_code && entry.currency_code !== baseCurrency);
      const { data: sourceLines } = foreign && entry.status === "posted"
        ? await supabase.from("journal_lines").select("id,source_debit,source_credit").eq("entry_id", entry.id)
        : { data: null };
      const sourceById = new Map((sourceLines || []).map(line => [line.id, line]));

      const safe = (value: unknown) => String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
      const money = (value: unknown) => Number(value ?? 0).toLocaleString("en-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const postedCurrency = entry.status === "posted" ? baseCurrency : entry.currency_code;
      const totalDebit = (lines ?? []).reduce((sum: number, line: any) => sum + Number(line.debit ?? 0), 0);
      const totalCredit = (lines ?? []).reduce((sum: number, line: any) => sum + Number(line.credit ?? 0), 0);
      const lineRows = (lines ?? []).map((line: any, index: number) => {
        const coa = Array.isArray(line.coa) ? line.coa[0] : line.coa;
        const accountName = coa?.code && coa?.name ? `${coa.name}` : line.account || line.account_id || "—";
        const original = sourceById.get(line.id);
        const source = foreign && entry.status === "posted" && original && (Number(original.source_debit) > 0 || Number(original.source_credit) > 0)
          ? `<div class="sub">Original ${safe(entry.currency_code)}: ${money(original.source_debit)} / ${money(original.source_credit)}</div>` : "";
        return `<tr><td class="center">${index + 1}</td><td>${safe(accountName)}${source}</td><td class="right">${money(line.debit)}</td><td class="right">${money(line.credit)}</td></tr>`;
      }).join("");

      const printWindow = window.open("", "_blank", "width=950,height=1000");
      if (!printWindow) throw new Error("Please allow pop-ups in your browser to print the voucher.");
      printWindow.document.open();
      printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${safe(entry.entry_no)} - Journal Voucher</title><style>
      *{box-sizing:border-box}body{margin:0;padding:28px;background:#f3f4f6;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:13px}.sheet{max-width:820px;margin:0 auto;background:#fff;padding:38px 42px;border:1px solid #e5e7eb}.toolbar{max-width:820px;margin:0 auto 14px;text-align:right}.toolbar button{border:0;border-radius:7px;padding:10px 16px;background:#111827;color:#fff;font-weight:700;cursor:pointer}.header{display:flex;justify-content:space-between;gap:30px;border-bottom:2px solid #111827;padding-bottom:20px}.brand{font-size:25px;font-weight:800}.sub{margin-top:5px;color:#6b7280;font-size:12px}.title{text-align:right;font-size:21px;font-weight:800;text-transform:uppercase;letter-spacing:1px}.voucher-no{margin-top:6px;color:#4b5563;font-size:12px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:18px 34px;margin:28px 0}.label{color:#6b7280;font-size: 12px;text-transform:uppercase;letter-spacing:.7px;font-weight:700}.value{margin-top:5px;font-size:14px;font-weight:700}.status{display:inline-block;margin-top:6px;padding:4px 9px;border-radius:999px;font-size: 12px;font-weight:800;text-transform:uppercase;border:1px solid #d1d5db}table{width:100%;border-collapse:collapse;margin-top:18px}th{padding:10px 9px;background:#f3f4f6;border-bottom:1px solid #d1d5db;text-align:left;font-size: 12px;text-transform:uppercase;letter-spacing:.5px}td{padding:11px 9px;border-bottom:1px solid #e5e7eb}.center{text-align:center;width:48px}.right{text-align:right}.total td{background:#f9fafb;font-weight:800}.description{margin-top:25px;padding:15px;border:1px solid #e5e7eb;background:#fafafa}.footer{margin-top:58px;display:flex;justify-content:space-between;gap:40px;color:#6b7280;font-size:11px}.signature{width:190px;text-align:center;border-top:1px solid #9ca3af;padding-top:8px}@media print{body{background:#fff;padding:0}.sheet{max-width:none;border:0;padding:18px}.toolbar{display:none}@page{size:A4;margin:10mm}}
      </style></head><body><div class="toolbar"><button onclick="window.print()">🖨 Print Voucher</button></div><div class="sheet">
      <div class="header"><div><div class="brand">NAVILO</div><div class="sub">Accounting Journal Voucher</div></div><div><div class="title">Journal Voucher</div><div class="voucher-no">Voucher No:::<strong>${safe(entry.entry_no)}</strong></div></div></div>
      <div class="meta"><div><div class="label">Entry Date</div><div class="value">${safe(formatDate(entry.entry_date))}</div></div><div><div class="label">Status</div><div class="status">${safe(entry.status)}</div></div><div><div class="label">Payment Mode</div><div class="value">${safe((entry as any).payment_mode || "General")}</div></div><div><div class="label">Party</div><div class="value">${safe((entry as any).party_name || "—")}</div></div></div>
      <div class="label">Journal Lines · ${safe(postedCurrency || "")} ${foreign ? `· 1 ${safe(entry.currency_code)} = ${safe(entry.exchange_rate)} ${safe(baseCurrency)}` : ""}</div><table><thead><tr><th class="center">#</th><th>Account</th><th class="right">Debit</th><th class="right">Credit</th></tr></thead><tbody>${lineRows}</tbody><tfoot><tr class="total"><td colspan="2">TOTAL</td><td class="right">${money(totalDebit)}</td><td class="right">${money(totalCredit)}</td></tr></tfoot></table>
      <div class="description"><div class="label">Description</div><div style="margin-top:7px">${safe(entry.description || "—")}</div></div><div class="footer"><div><strong>NAVILO</strong><br/>Official accounting record. Keep this voucher for your records.</div><div class="signature">Authorized Signature</div></div></div></body></html>`);
      printWindow.document.close(); printWindow.focus(); setTimeout(() => printWindow.print(), 250);
    } catch (err: any) { setError(err?.message || "Failed to print journal voucher."); }
  }, [baseCurrency]);

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">

      {/* HEADER */}

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">

        <div>
          <h1 className="text-2xl font-bold text-slate-900">Journal Entries</h1>

          <p className="text-sm text-slate-500 mt-1">
            Manage journal entries,
            bulk import and accounting
            posting.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">

          <button
            type="button"
            onClick={() => {
              setError(null);
              setSuccess(null);

              resetBulkImport();

              setBulkModalOpen(true);
            }}
            className="px-4 py-2.5 text-sm font-semibold flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
          >
            ↓ Bulk Import
          </button>

          <button
            type="button"
            onClick={() => {
              setForm({
                entry_no:
                  generateEntryNo(),

                entry_date:
                  new Date()
                    .toISOString()
                    .split("T")[0],

                description: "",
                currency_code: "",
              });

              setError(null);
              setSuccess(null);

              setModalOpen(true);
            }}
            className="px-4 py-2.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
          >
            + New Journal Entry
          </button>

        </div>
      </div>

      {/* MESSAGES */}

      {error && (
        <ErrorBanner
          message={error}
        />
      )}

      {success && (
        <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm">
          {success}
        </div>
      )}

      {/* JOURNAL TABLE */}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

        {loading ? (
          <div className="p-12 text-center text-slate-400">
            Loading journal entries...
          </div>
        ) : entries.length === 0 ? (
          <div className="p-12 text-center text-slate-500">

            <p className="font-medium">
              No journal entries found.
            </p>

            <p className="text-sm text-slate-400 mt-1">
              Create a journal entry
              or use Bulk Import.
            </p>

          </div>
        ) : (
          <div className="overflow-x-auto">

            <table className="w-full text-sm">

              <thead>
                <tr className="border-b bg-slate-50 text-slate-600">

                  <th className="text-left py-3 px-4">
                    Entry #
                  </th>

                  <th className="text-left py-3 px-4">Date</th>

                  <th className="text-left py-3 px-4">Description</th>

                  <th className="text-left py-3 px-4">Status</th>

                  <th className="text-right py-3 px-4">
                    Action
                  </th>

                </tr>
              </thead>

              <tbody className="divide-y">

                {entries.map(
                  (entry) => (
                    <tr
                      key={entry.id}
                      className="hover:bg-slate-50 cursor-pointer"
                      onClick={() =>
                        navigate(
                          `/accounting/${entry.id}`
                        )
                      }
                    >

                      <td className="py-3.5 px-4 font-medium">
                        {entry.entry_no}
                      </td>

                      <td className="py-3.5 px-4 text-slate-600">
                        {formatDate(
                          entry.entry_date
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-slate-600">
                        {entry.description ||
                          "—"}
                      </td>

                      <td className="py-3.5 px-4">
                        <StatusBadge
                          status={
                            entry.status
                          }
                        />
                      </td>

                      <td className="py-3.5 px-4 text-right">

                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/accounting/${entry.id}`);
                            }}
                            className="text-primary-600 hover:text-primary-800 font-medium text-xs"
                          >
                            View / Edit →
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void printJournalVoucher(entry);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            title="Print journal voucher"
                          >
                            🖨 Print
                          </button>
                        </div>

                      </td>

                    </tr>
                  )
                )}

              </tbody>

            </table>

          </div>
        )}

      </div>

      {/* ===================================================
          SINGLE ENTRY MODAL
      =================================================== */}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">

          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">

            <div className="flex justify-between items-center border-b pb-3">

              <h3 className="font-bold text-lg">
                New Journal Entry
              </h3>

              <button
                type="button"
                onClick={() =>
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

                <input
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
                    <select className="mt-1 w-full border rounded p-2" value={form.currency_code || baseCurrency}
                      onChange={event => setForm(current => ({ ...current, currency_code: event.target.value }))}>
                      {availableCurrencies.map(currency => <option key={currency.code} value={currency.code}>{currency.code} · {currency.name}</option>)}
                    </select>
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

                    <p className="text-xs text-slate-500 mt-1">
                      AccountCode is optional.AccountHead and
                      AccountName are
                      separate columns.
                    </p>

                    <p className="text-xs text-slate-500 mt-1">
                      Example:
                      <strong>
                        {" "}
                        Accounts Payable</strong>
                      {" → "}
                      <strong>
                        Amjad Khan
                      </strong>
                    </p>

                  </div>

                  <div className="flex gap-2">

                    <button
                      type="button"
                      onClick={
                        downloadCSVTemplate
                      }
                      className="px-4 py-2 bg-white border rounded-lg text-sm font-semibold"
                    >
                      CSV Template
                    </button>

                    <button
                      type="button"
                      onClick={
                        downloadExcelTemplate
                      }
                      className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold"
                    >
                      Excel Template
                    </button>

                  </div>

                </div>

                <div className="mt-4 overflow-x-auto">

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

              </div>

              {/* UPLOAD */}

              <div className="border-2 border-dashed border-blue-300 bg-blue-50 rounded-xl p-8 text-center">

                <h3 className="font-bold">
                  Upload Journal File
                </h3>

                <p className="text-xs text-slate-500 mt-1 mb-4">
                  CSV or Excel-compatible
                  XLS
                </p>

                <label className="inline-flex cursor-pointer">

                  <span className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">
                    {importing
                      ? "Processing..."
                      : "Choose File"}
                  </span>

                  <input
                    type="file"
                    accept=".csv,.xls,text/csv,application/vnd.ms-excel"
                    onChange={
                      handleFileUpload
                    }
                    disabled={
                      importing ||
                      postingBulk
                    }
                    className="hidden"
                  />

                </label>

                {importFileName && (
                  <p className="text-xs font-semibold text-blue-700 mt-3">
                    Selected:{" "}
                    {importFileName}
                  </p>
                )}

              </div>

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
                            AccountHead
                          </th>

                          <th className="px-3 py-3 text-left">
                            AccountName
                          </th>

                          <th className="px-3 py-3 text-left">
                            Code
                          </th>

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

                                <div className="font-medium text-slate-700">
                                  {
                                    row.accountHead ||
                                    "—"
                                  }
                                </div>

                              </td>

                              <td className="px-3 py-2">

                                <div className="font-semibold text-slate-900">
                                  {
                                    row.accountName ||
                                    "—"
                                  }
                                </div>

                              </td>

                              <td className="px-3 py-2 font-mono text-slate-500">
                                {
                                  row.accountCode ||
                                  "—"
                                }
                              </td>

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

                AccountCode is optional.AccountHead and AccountName are separate.

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
