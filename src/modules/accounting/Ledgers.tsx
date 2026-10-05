import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchAllPages, fetchByIdChunks } from "@/lib/fetchAllPages";
import { supabase } from "@/lib/supabase";
import {
  Ledger,
  ChartOfAccount,
  Customer,
  Supplier,
  PartyLedger,
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

type PartyLedgerRow = PartyLedger & {
  party_name?: string | null;
};

type TransportDetail = {
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

type TransportMovementLink = {
  journal_entry_id?: string | null;
  order_no?: string | null;
  trip_no?: string | null;
};

const PARTY_COLUMNS = [
  ["date", "Date"], ["party", "Party"], ["reference", "Reference"],
  ["trip", "Trip"], ["from", "From"], ["to", "To"], ["vehicle", "Vehicle"],
  ["driver", "Driver"], ["owner", "Owner"], ["job", "Job / PO / DO"],
  ["description", "Description"], ["base", "Base Amount"], ["charges", "Charges"], ["tax", "VAT / Tax"], ["postedTotal", "Posted Total"], ["debit", "Debit"], ["credit", "Credit"], ["balance", "Balance"],
] as const;
type PartyColumnKey = (typeof PARTY_COLUMNS)[number][0];
const DEFAULT_PARTY_COLUMNS: PartyColumnKey[] = [
  "date","party","reference","trip","from","to","vehicle","description","base","charges","tax","postedTotal","debit","credit","balance",
];

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

export default function Ledgers() {
  const [viewMode, setViewMode] = useState<ViewMode>("general");

  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [partyRows, setPartyRows] = useState<PartyLedgerRow[]>([]);

  const [selectedAccount, setSelectedAccount] = useState("");
  const [partyFilterType, setPartyFilterType] =
    useState<PartyFilterType>("all");
  const [selectedPartyKey, setSelectedPartyKey] = useState("");
  const [partySearch, setPartySearch] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transportDetails, setTransportDetails] = useState<TransportDetail[]>([]);
  const [transportMovements, setTransportMovements] = useState<TransportMovementLink[]>([]);
  const [showColumns, setShowColumns] = useState(false);
  const partyColumnDragKey = useRef<PartyColumnKey | null>(null);
  const [partyColumnOrder, setPartyColumnOrder] = useState<PartyColumnKey[]>(() => {
    try {
      const saved = localStorage.getItem("navilo-ledger-party-column-order");
      if (saved) {
        const parsed = JSON.parse(saved) as PartyColumnKey[];
        const allowed = new Set(PARTY_COLUMNS.map(([key]) => key));
        const valid = parsed.filter((key) => allowed.has(key));
        const missing = PARTY_COLUMNS.map(([key]) => key).filter((key) => !valid.includes(key));
        if (valid.length) return [...valid, ...missing];
      }
    } catch {}
    return PARTY_COLUMNS.map(([key]) => key);
  });
  const [visiblePartyColumns, setVisiblePartyColumns] = useState<PartyColumnKey[]>(() => {
    try {
      const saved = localStorage.getItem("navilo-ledger-party-columns");
      if (saved) {
        const parsed = JSON.parse(saved) as PartyColumnKey[];
        const allowed = new Set(PARTY_COLUMNS.map(([key]) => key));
        const valid = parsed.filter((key) => allowed.has(key));
        if (valid.length) return valid;
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

  const fetchGeneralLedger = useCallback(async () => {
    const data = await fetchAllPages<LedgerRow>((fromRow, toRow) => {
      let query = supabase
        .from("ledgers")
        .select("*, account:chart_of_accounts(*)")
        .order("entry_date", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

      if (selectedAccount) {
        query = query.eq("account_id", selectedAccount);
      }

      return query.range(fromRow, toRow);
    });

    setLedgerRows(data);
  }, [selectedAccount]);

  const fetchPartyLedger = useCallback(async () => {
    const data = await fetchAllPages<PartyLedgerRow>((fromRow, toRow) => {
      let query = supabase
        .from("party_ledgers")
        .select("*")
        .order("entry_date", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

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
    });

    setPartyRows(data);
  }, [partyFilterType, selectedPartyKey]);

  const fetchTransportContext = useCallback(async () => {
    const selected = selectedPartyKey ? selectedPartyKey.split(":") as [PartyType, string] : null;
    const sides: PartyType[] = selected ? [selected[0]] : partyFilterType === "all" ? ["customer", "supplier"] : [partyFilterType];
    const details: TransportDetail[] = [];
    const movements: TransportMovementLink[] = [];

    await Promise.all(sides.map(async (side) => {
      try {
        const allowed = await supabase.rpc("transport_financial_read_allowed", { p_side: side });
        if (allowed.error || allowed.data !== true) return;
        const party = selected?.[0] === side ? selected[1] : "";
        const [detailRows, movementRows] = await Promise.all([
          fetchAllPages<TransportDetail>((fromRow, toRow) =>
            supabase.rpc("transport_document_trip_detail_query", {
              p_side: side,
              p_filters: { party, to: "", search: "" },
              p_limit: toRow - fromRow + 1,
              p_offset: fromRow,
            })
          ),
          fetchAllPages<TransportMovementLink>((fromRow, toRow) =>
            supabase.rpc("transport_party_report_query", {
              p_kind: "movements",
              p_side: side,
              p_filters: { party, to: "", search: "" },
              p_limit: toRow - fromRow + 1,
              p_offset: fromRow,
            })
          ),
        ]);
        details.push(...detailRows);
        movements.push(...movementRows);
      } catch {
        // Ledger remains usable for companies/business units without Transport access.
      }
    }));

    setTransportDetails(details);
    setTransportMovements(movements);
  }, [partyFilterType, selectedPartyKey]);

  useEffect(() => {
    try {
      localStorage.setItem("navilo-ledger-party-columns", JSON.stringify(visiblePartyColumns));
      localStorage.setItem("navilo-ledger-party-column-order", JSON.stringify(partyColumnOrder));
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

        if (viewMode === "general") {
          await Promise.all([fetchGeneralLedger(), fetchTransportContext()]);
        } else {
          await Promise.all([fetchPartyLedger(), fetchTransportContext()]);
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
    };
  }, [viewMode, fetchGeneralLedger, fetchPartyLedger, fetchTransportContext]);

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
    const search = partySearch.trim().toLowerCase();

    if (!search) {
      return partyOptions.slice(0, 50);
    }

    return partyOptions
      .filter((party) => {
        const typeLabel =
          party.type === "customer" ? "customer" : "supplier";

        return (
          party.name.toLowerCase().includes(search) ||
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

  const generalRowsWithBalance = useMemo(() => {
    if (selectedAccount) {
      let runningBalance = 0;

      return ledgerRows.map((row) => {
        const debit = Number(row.debit) || 0;
        const credit = Number(row.credit) || 0;
        runningBalance += debit - credit;

        return {
          ...row,
          displayBalance: runningBalance,
        };
      });
    }

    const balances = new Map<string, number>();

    return ledgerRows.map((row) => {
      const accountId = row.account_id || "unassigned";
      const debit = Number(row.debit) || 0;
      const credit = Number(row.credit) || 0;
      const nextBalance =
        (balances.get(accountId) || 0) + debit - credit;

      balances.set(accountId, nextBalance);

      return {
        ...row,
        displayBalance: nextBalance,
      };
    });
  }, [ledgerRows, selectedAccount]);

  const partyRowsWithBalance = useMemo(() => {
    const balances = new Map<string, number>();

    return partyRows.map((row) => {
      const key = `${row.party_type}:${row.party_id}`;
      const debit = Number(row.debit) || 0;
      const credit = Number(row.credit) || 0;
      const nextBalance =
        (balances.get(key) || 0) + debit - credit;

      balances.set(key, nextBalance);

      return {
        ...row,
        party_name:
          row.party_name || getPartyName(row.party_type, row.party_id),
        displayBalance: nextBalance,
      };
    });
  }, [partyRows, getPartyName]);

  const transportInfoByJournal = useMemo(() => {
    const detailsByOrder = new Map<string, TransportDetail[]>();
    for (const detail of transportDetails) {
      if (!detail.order_no) continue;
      const list = detailsByOrder.get(detail.order_no) || [];
      list.push(detail);
      detailsByOrder.set(detail.order_no, list);
    }
    const ordersByJournal = new Map<string, Set<string>>();
    for (const movement of transportMovements) {
      if (!movement.journal_entry_id || !movement.order_no) continue;
      const set = ordersByJournal.get(movement.journal_entry_id) || new Set<string>();
      set.add(movement.order_no);
      ordersByJournal.set(movement.journal_entry_id, set);
    }
    const unique = (values: Array<string | null | undefined>) =>
      [...new Set(values.filter((value): value is string => !!value))].join(" / ");
    return (row: PartyLedgerRow | LedgerRow) => {
      const reference = "reference" in row ? row.reference : null;
      const orderNos = new Set<string>();
      if (reference && detailsByOrder.has(reference)) orderNos.add(reference);
      if (row.journal_entry_id) {
        for (const orderNo of ordersByJournal.get(row.journal_entry_id) || []) orderNos.add(orderNo);
      }
      const details = [...orderNos].flatMap((orderNo) => detailsByOrder.get(orderNo) || []);
      // Financial fields returned by transport_document_trip_detail_query are document-level
      // snapshots repeated on each Trip row. Sum each order once; Trip context remains multi-row.
      const financialDetails = [...orderNos].map((orderNo) => (detailsByOrder.get(orderNo) || [])[0]).filter((d): d is TransportDetail => Boolean(d));
      return {
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
  }, [transportDetails, transportMovements]);

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
    const source = viewMode === "general" ? ledgerRows : partyRows;
    return source.reduce((sum, row) => sum + (Number(row.debit) || 0), 0);
  }, [viewMode, ledgerRows, partyRows]);

  const totalCredit = useMemo(() => {
    const source = viewMode === "general" ? ledgerRows : partyRows;
    return source.reduce((sum, row) => sum + (Number(row.credit) || 0), 0);
  }, [viewMode, ledgerRows, partyRows]);

  const statementBalance = totalDebit - totalCredit;

  const exportToExcel = () => {
    if (viewMode === "general") {
      const header =
        "Date,Account Code,Account Name,Description,Debit,Credit,Balance\n";

      const body = generalRowsWithBalance
        .map((row) =>
          [
            escapeCsv(row.entry_date),
            escapeCsv(row.account?.code || ""),
            escapeCsv(row.account?.name || ""),
            escapeCsv(row.description || ""),
            Number(row.debit) || 0,
            Number(row.credit) || 0,
            escapeCsv(signedBalanceLabel(Number(row.displayBalance) || 0)),
          ].join(",")
        )
        .join("\n");

      const blob = new Blob([header + body], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `General_Ledger_${
        selectedAccountObj?.code || "All_Accounts"
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
        trip: transport.trip, from: transport.from, to: transport.to, vehicle: transport.vehicle,
        driver: transport.driver, owner: transport.owner, job: transport.job,
        description: row.description || "", base: transport.base || "", charges: transport.charges || "", tax: transport.tax || "", postedTotal: transport.postedTotal || "", debit: Number(row.debit) || "", credit: Number(row.credit) || "",
        balance: signedBalanceLabel(Number(row.displayBalance) || 0),
      };
      return exportColumns.map(([key]) => escapeCsv(values[key])).join(",");
    }).join("\n");

    const blob = new Blob([header + body], {
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

  const exportToPDF = () => {
    window.print();
  };

  const handlePartyTypeChange = (value: PartyFilterType) => {
    setPartyFilterType(value);
    setSelectedPartyKey("");
    setPartySearch("");
  };

  const handleSelectParty = (partyKey: string, partyName: string) => {
    setSelectedPartyKey(partyKey);
    setPartySearch(partyName);
  };

  const handleClearParty = () => {
    setSelectedPartyKey("");
    setPartySearch("");
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
              className="px-3 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors flex items-center gap-1.5"
            >
              Export
            </button>

            <button
              onClick={exportToPDF}
              className="px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1.5"
            >
              Print / PDF
            </button>
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}

      <div className="card p-4 print:hidden">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4">
          <div className="min-w-[220px]">
            <label className="label text-xs font-semibold text-slate-700 mb-1">
              Statement Type
            </label>

            <SearchableSelect
              className="input text-sm"
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
            >
              <option value="general">General Ledger</option>
              <option value="party">Party Statement</option>
            </SearchableSelect>
          </div>

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
                      <button type="button" className="text-xs text-blue-700" onClick={() => { setVisiblePartyColumns(DEFAULT_PARTY_COLUMNS); setPartyColumnOrder(PARTY_COLUMNS.map(([key]) => key)); }}>Reset</button>
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
              <div className="text-xs text-slate-400">Steel Mill ERP</div>
              <div className="text-xs text-slate-500 mt-1">Read-only posted accounting records</div>
            </div>
          </div>
        </div>

        {viewMode === "general" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="text-left py-2.5 px-3 font-medium">Date</th>
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
                      <td className="py-2.5 px-3 text-slate-600">
                        {formatDate(row.entry_date)}
                      </td>

                      <td className="py-2.5 px-3 font-medium text-slate-900">
                        {row.account?.name || ""}
                      </td>

                      <td className="py-2.5 px-3 text-slate-700">
                        {row.description ?? ""}
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
            <table className="w-full text-sm min-w-max">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  {displayedPartyColumns.map(([key, label]) => (
                    <th key={key} draggable onDragStart={(e) => { partyColumnDragKey.current = key; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key); }} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={(e) => { e.preventDefault(); const source = partyColumnDragKey.current || e.dataTransfer.getData("text/plain") as PartyColumnKey; partyColumnDragKey.current = null; if (source) movePartyColumn(source, key); }} onDragEnd={() => { partyColumnDragKey.current = null; }} title="Drag left or right to reorder" className={`cursor-grab select-none py-2 px-2 font-medium whitespace-nowrap active:cursor-grabbing ${["base","charges","tax","postedTotal","debit","credit","balance"].includes(key) ? "text-right" : "text-left"}`}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={visiblePartyColumns.length} className="text-center py-8 text-slate-400">Loading Party Statement...</td></tr>
                ) : partyRowsWithBalance.length === 0 ? (
                  <tr><td colSpan={visiblePartyColumns.length} className="text-center py-8 text-slate-400">No party ledger entries found for this selection.</td></tr>
                ) : partyRowsWithBalance.map((row) => {
                  const transport = transportInfoByJournal(row);
                  const cells: Record<PartyColumnKey, ReactNode> = {
                    date: formatDate(row.entry_date),
                    party: <><div className="font-medium text-slate-900">{row.party_name || ""}</div><div className="text-[11px] text-slate-400 capitalize">{row.party_type}</div></>,
                    reference: row.reference || "",
                    trip: transport.trip, from: transport.from, to: transport.to, vehicle: transport.vehicle,
                    driver: transport.driver, owner: transport.owner, job: transport.job,
                    description: row.description || "",
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
                        <td key={key} className={`py-2 px-2 whitespace-nowrap ${["base","charges","tax","postedTotal","debit","credit","balance"].includes(key) ? "text-right" : "text-left"} ${key === "balance" ? "font-semibold text-slate-900" : "text-slate-700"}`}>
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
                      <td key={key} className={`py-2 px-2 ${["base","charges","tax","postedTotal","debit","credit","balance"].includes(key) ? "text-right" : ""}`}>
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
