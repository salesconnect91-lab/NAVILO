import SearchableSelect from "@/components/SearchableSelect";
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
};

type ImportRow = {
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

  /* -------------------------------------------------------
     STATE
  ------------------------------------------------------- */

  const [entry, setEntry] =
    useState<JournalEntry | null>(null);

  const [lines, setLines] =
    useState<JournalLine[]>([]);

  const [accounts, setAccounts] =
    useState<ChartOfAccount[]>([]);

  const [customers, setCustomers] =
    useState<Customer[]>([]);

  const [suppliers, setSuppliers] =
    useState<Supplier[]>([]);

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

  const [reversalOpen, setReversalOpen] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [reversalDate, setReversalDate] = useState(new Date().toISOString().slice(0, 10));
  const [reversalReason, setReversalReason] = useState("");
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

      setLines(mappedLines);
    },
    [id]
  );

  /* =========================================================
     FETCH MASTER DATA
  ========================================================= */

  const fetchAccounts = useCallback(
    async () => {
      const { data, error } =
        await supabase
          .from("chart_of_accounts")
          .select("*")
          .eq("is_active", true)
          .order("code", {
            ascending: true,
          });

      if (error) {
        throw new Error(error.message);
      }

      setAccounts(
        (data ?? []) as ChartOfAccount[]
      );
    },
    []
  );

  const fetchCustomers = useCallback(
    async () => {
      const { data, error } =
        await supabase
          .from("customers")
          .select("*")
          .eq("is_active", true)
          .order("name", {
            ascending: true,
          });

      if (error) {
        throw new Error(error.message);
      }

      setCustomers(
        (data ?? []) as Customer[]
      );
    },
    []
  );

  const fetchSuppliers = useCallback(
    async () => {
      const { data, error } =
        await supabase
          .from("suppliers")
          .select("*")
          .eq("is_active", true)
          .order("name", {
            ascending: true,
          });

      if (error) {
        throw new Error(error.message);
      }

      setSuppliers(
        (data ?? []) as Supplier[]
      );
    },
    []
  );

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
  ]);

  /* =========================================================
     ACCOUNT / PARTY HELPERS
  ========================================================= */

  const postingAccounts =
    accounts.filter(
      (account) =>
        account.is_active &&
        !account.is_group &&
        account.allow_manual_entries
    );

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
    supplierAccountIds.has(accountId);

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
          customer.account_id === accountId
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
          supplier.account_id === accountId
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

  const balanced =
    lines.length +
      activeDraftCount >
      0 &&
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
                  customer.account_id === accountId
              )
            ) ||
            (
              line.partyType === "supplier" &&
              suppliers.some(
                (supplier) =>
                  supplier.id === line.partyId &&
                  supplier.account_id === accountId
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
            !customer.account_id
          ) {
            return line;
          }

          return {
            ...line,
            accountId:
              customer.account_id,
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
          !supplier.account_id
        ) {
          return line;
        }

        return {
          ...line,
          accountId:
            supplier.account_id,
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
        const templateData = [
          {
            "Account Code": "1110",
            "Account Name": "Cash",
            "Party Type": "",
            "Party Name": "",
            Debit: 1000,
            Credit: "",
          },
          {
            "Account Code": "4100",
            "Account Name": "Sales Revenue",
            "Party Type": "",
            "Party Name": "",
            Debit: "",
            Credit: 1000,
          },
        ];

        const worksheet =
          XLSX.utils.json_to_sheet(
            templateData
          );

        worksheet["!cols"] = [
          { wch: 18 },
          { wch: 35 },
          { wch: 18 },
          { wch: 35 },
          { wch: 18 },
          { wch: 18 },
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
            debit === 0 &&
            credit === 0;

          if (isEmptyRow) {
            return;
          }

          if (!accountCode) {
            importErrors.push(
              `Row ${rowNumber}: Account Code is required.`
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

          const account =
            accounts.find(
              (item) =>
                String(
                  item.code
                ).trim() ===
                accountCode
            );

          if (!account) {
            importErrors.push(
              `Row ${rowNumber}: Account Code "${accountCode}" was not found in Chart of Accounts.`
            );

            return;
          }

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
            !account.allow_manual_entries
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
              account.id
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
              account.id
            ) {
              importErrors.push(
                `Row ${rowNumber}: Supplier "${supplier.name}" is not linked to account "${account.name}".`
              );

              return;
            }
          }

          importedRows.push({
            accountCode,
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

      if (
        activeLines.length === 0
      ) {
        setError(
          "Please enter at least one journal line."
        );

        return;
      }

      const rowsToInsert: {
        entry_id: string;
        account_id: string;
        account: string;
        party_type: PartyType | null;
        party_id: string | null;
        party_name: string | null;
        debit: number;
        credit: number;
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

        if (
          !account.allow_manual_entries
        ) {
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
            `Row ${rowNumber}: "${account.name}" requires a customer or supplier in Name / Party.`
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
            account.id
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
            account.id
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
          debit,
          credit,
        });
      }

      try {
        setSaving(true);

        const {
          data,
          error,
        } =
          await supabase
            .from("journal_lines")
            .insert(
              rowsToInsert
            )
            .select(`
              *,
              coa:chart_of_accounts(*)
            `);

        if (error) {
          throw new Error(
            error.message
          );
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
          `${mappedLines.length} journal line${
            mappedLines.length ===
            1
              ? ""
              : "s"
          } saved successfully.`
        );
      } catch (err: any) {
        setError(
          err?.message ||
            "Failed to save journal lines."
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
          `Journal is not balanced. Debit ${formatCurrency(
            totalDebit
          )} must equal Credit ${formatCurrency(
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
            !account.allow_manual_entries
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
          `"${account?.code ?? ""} - ${account?.name ?? "Party control account"}" requires a customer or supplier before posting.`
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
            "post_journal_entry",
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
          "Journal entry posted successfully. General Ledger and Party Ledger were created through the database posting transaction."
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

  const handleReverseEntry = async () => {
    if (!entry) return;
    if (!reversalDate) { setError("Reversal date is required."); return; }
    if (!reversalReason.trim()) { setError("Reversal reason is required."); return; }

    try {
      setReversing(true);
      setError(null);
      setSuccess(null);
      const { data, error: rpcError } = await supabase.rpc("reverse_manual_journal_entry", {
        p_entry_id: entry.id,
        p_reversal_date: reversalDate,
        p_reason: reversalReason.trim(),
      });
      if (rpcError) throw new Error(rpcError.message);
      const reversalId = data?.reversal_entry_id;
      if (!reversalId) throw new Error("Reversal journal was not returned by the database.");
      setReversalOpen(false);
      setReversalReason("");
      navigate(`/accounting/${reversalId}`);
    } catch (err: any) {
      setError(err?.message || "Failed to reverse journal entry.");
    } finally {
      setReversing(false);
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

  const isManualJournal =
    !entry.reversal_of_entry_id &&
    (!entry.trans_type || entry.trans_type === "Journal Entry" || entry.trans_type === "Manual Journal");

  /* =========================================================
     UI
  ========================================================= */

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div>
        <Link
          to="/accounting"
          className="text-sm font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1 w-fit"
        >
          ← Back to Journal Entries
        </Link>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">
              {entry.entry_no}
            </h1>

            <StatusBadge
              status={entry.status}
            />
          </div>

          <p className="text-sm text-slate-500 mt-1">
            {entry.description ||
              "No description provided for this entry."}
          </p>
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

          {isPosted && isManualJournal && !reversalEntry && (
            <button
              onClick={() => setReversalOpen(true)}
              disabled={reversing}
              className="px-3 py-2 text-sm font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200"
            >
              Reverse Journal
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Posting Date
          </div>

          <div className="font-semibold text-slate-800 mt-1">
            {formatDate(
              entry.entry_date
            )}
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Total Debit
          </div>

          <div className="font-semibold text-slate-800 mt-1">
            {formatCurrency(
              totalDebit
            )}
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Total Credit
          </div>

          <div className="font-semibold text-slate-800 mt-1">
            {formatCurrency(
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
              balanced
                ? "text-emerald-600"
                : "text-rose-600"
            }`}
          >
            {balanced
              ? "✓ Balanced"
              : "✕ Not Balanced"}
          </div>

          {!balanced && (
            <div className="text-xs text-rose-500 mt-1">
              Difference:{" "}
              {formatCurrency(
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
                : "Enter multiple journal lines manually or load them from Excel/CSV. Account and Name / Party are stored separately."}
            </p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="text-left py-3 px-4 font-semibold">Account</th>

                    <th className="text-left py-3 px-4 font-semibold">
                      Name / Party
                    </th>

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

                          <td className="py-3.5 px-4">
                            {partyName ? (
                              <>
                                <div className="font-medium text-slate-800">
                                  {partyName}
                                </div>

                                <div className="text-xs text-slate-400 mt-0.5 capitalize">
                                  {line.party_type}
                                </div>
                              </>
                            ) : (
                              <span className="text-slate-400">
                                —
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right text-slate-700 font-mono">
                            {Number(
                              line.debit
                            ) > 0
                              ? formatCurrency(
                                  Number(
                                    line.debit
                                  )
                                )
                              : "—"}
                          </td>

                          <td className="py-3.5 px-4 text-right text-slate-700 font-mono">
                            {Number(
                              line.credit
                            ) > 0
                              ? formatCurrency(
                                  Number(
                                    line.credit
                                  )
                                )
                              : "—"}
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
            <div className="border border-emerald-200 rounded-xl overflow-hidden">
              <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div>
                    <h4 className="font-bold text-slate-900">
                      📥 Bulk Journal Import
                    </h4>

                    <p className="text-xs text-slate-600 mt-1">
                      Excel/CSV file se bohat sari journal lines ek saath load karein.
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
                  Account Code, Account Name, Party Type, Party Name, Debit, Credit
                  <span className="ml-2">
                    • Party Type + Party Name required for customer/supplier control accounts
                  </span>
                </div>
              </div>
            </div>
          )}

          {!isPosted && (
            <div className="border border-blue-200 rounded-xl overflow-hidden">
              <div className="bg-blue-50 border-b border-blue-200 px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <h4 className="font-bold text-slate-900">
                    Fast Journal Entry
                  </h4>

                  <p className="text-xs text-slate-600 mt-0.5">
                    Account aur Name / Party alag fields hain. Party select karne par uska linked control account automatically select ho jayega.
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
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg"
                >
                  + Add Row
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1150px] text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-4 py-3 font-semibold text-slate-600 w-[34%]">Account</th>

                      <th className="text-left px-4 py-3 font-semibold text-slate-600 w-[26%]">
                        Name / Party
                      </th>

                      <th className="text-right px-4 py-3 font-semibold text-slate-600 w-[14%]">Debit</th>

                      <th className="text-right px-4 py-3 font-semibold text-slate-600 w-[14%]">Credit</th>

                      <th className="text-center px-4 py-3 font-semibold text-slate-600 w-[12%]">
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

                        return (
                          <tr
                            key={
                              line.tempId
                            }
                            className="border-b border-slate-100"
                          >
                            <td className="px-3 py-2">
                              <SearchableSelect
                                className="input bg-white w-full"
                                searchPlaceholder="Search account by code or name..."
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

                                {postingAccounts.map(
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
                                    >
                                      {account.name} ({account.type})
                                    </option>
                                  )
                                )}
                              </SearchableSelect>
                            </td>

                            <td className="px-3 py-2">
                              <SearchableSelect
                                className="input bg-white w-full"
                                searchPlaceholder="Search customer or supplier..."
                                emptyText="No matching customer / supplier"
                                value={
                                  line.partyType &&
                                  line.partyId
                                    ? `${line.partyType}:${line.partyId}`
                                    : ""
                                }
                                onChange={(
                                  e
                                ) =>
                                  updateDraftParty(
                                    line.tempId,
                                    e.target.value
                                  )
                                }
                              >
                                <option value="">
                                  {partyRequired
                                    ? "Choose Customer / Supplier..."
                                    : "No Party"}
                                </option>

                                {partyOptions.map(
                                  (party) => (
                                    <option
                                      key={
                                        party.key
                                      }
                                      value={
                                        party.key
                                      }
                                    >
                                      {party.type === "customer"
                                        ? "Customer"
                                        : "Supplier"}{" "}
                                      - {party.name}
                                    </option>
                                  )
                                )}
                              </SearchableSelect>

                              {partyRequired && (
                                <div className="text-[12px] text-amber-600 mt-1">
                                  Party required for this account
                                </div>
                              )}
                            </td>

                            <td className="px-3 py-2">
                              <input
                                className="input bg-white font-mono text-right w-full"
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

                            <td className="px-3 py-2">
                              <input
                                className="input bg-white font-mono text-right w-full"
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

                            <td className="px-3 py-2">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDuplicateRow(
                                      line
                                    )
                                  }
                                  disabled={
                                    saving ||
                                    posting ||
                                    importing
                                  }
                                  className="px-2 py-1 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded"
                                  title="Duplicate row"
                                >
                                  Copy
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
                                  className="px-2 py-1 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded"
                                  title="Remove row"
                                >
                                  Remove
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
                        className="px-4 py-3 font-bold text-slate-900"
                        colSpan={2}
                      >
                        New Lines Total
                      </td>

                      <td className="px-4 py-3 text-right font-mono font-bold">
                        {formatCurrency(
                          draftDebit
                        )}
                      </td>

                      <td className="px-4 py-3 text-right font-mono font-bold">
                        {formatCurrency(
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
                  new line
                  {activeDraftCount ===
                  1
                    ? ""
                    : "s"}
                </div>

                <button
                  type="button"
                  onClick={
                    handleSaveAllLines
                  }
                  disabled={
                    saving ||
                    posting ||
                    importing ||
                    activeDraftCount ===
                      0
                  }
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving
                    ? "Saving..."
                    : "✓ Save All Lines"}
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
                    {formatCurrency(
                      totalDebit
                    )}
                  </td>

                  <td className="py-4 px-4 text-right font-mono font-bold text-slate-900">
                    {formatCurrency(
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
              {balanced ? (
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
                      {formatCurrency(
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

      <Modal open={reversalOpen} title={`Reverse ${entry.entry_no}`} onClose={() => !reversing && setReversalOpen(false)}>
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            A new posted journal will be created with Debit and Credit reversed. The original journal will remain locked for audit history.
          </div>
          <div>
            <label className="label">Reversal Date</label>
            <input className="input" type="date" value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} />
          </div>
          <div>
            <label className="label">Mandatory Reason</label>
            <textarea className="input" rows={3} value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} placeholder="Explain why this posted journal must be reversed" />
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" disabled={reversing} onClick={() => setReversalOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={reversing || !reversalDate || !reversalReason.trim()} onClick={() => void handleReverseEntry()}>{reversing ? "Reversing…" : "Create & Post Reversal"}</button>
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
