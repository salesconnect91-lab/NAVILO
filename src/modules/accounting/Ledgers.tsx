import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useMemo, useState } from "react";
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
          await fetchGeneralLedger();
        } else {
          await fetchPartyLedger();
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
  }, [viewMode, fetchGeneralLedger, fetchPartyLedger]);

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

    const header =
      "Date,Party Type,Party Name,Reference,Description,Debit,Credit,Balance\n";

    const body = partyRowsWithBalance
      .map((row) =>
        [
          escapeCsv(row.entry_date),
          escapeCsv(row.party_type),
          escapeCsv(row.party_name || ""),
          escapeCsv(row.reference || ""),
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
              ≡ƒôè Export Excel
            </button>

            <button
              onClick={exportToPDF}
              className="px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1.5"
            >
              ≡ƒôÑ Print / PDF
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
                <option value="">ΓÇö All Accounts ΓÇö</option>

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
                  ? `${selectedParty.name} ΓÇö ${
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

          <div className="text-right">
            <div className="text-xs text-slate-400">Steel Mill ERP</div>
            <div className="text-xs text-slate-500 mt-1">
              Read-only posted accounting records
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
                        {row.account?.name || "ΓÇö"}
                      </td>

                      <td className="py-2.5 px-3 text-slate-700">
                        {row.description ?? "ΓÇö"}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {Number(row.debit) > 0
                          ? formatCurrency(Number(row.debit))
                          : "ΓÇö"}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {Number(row.credit) > 0
                          ? formatCurrency(Number(row.credit))
                          : "ΓÇö"}
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
            <table className="w-full text-sm min-w-[1050px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="text-left py-2.5 px-3 font-medium">Date</th>
                  <th className="text-left py-2.5 px-3 font-medium">
                    Party
                  </th>
                  <th className="text-left py-2.5 px-3 font-medium">Reference</th>
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
                      colSpan={7}
                      className="text-center py-8 text-slate-400"
                    >
                      Loading Party Statement...
                    </td>
                  </tr>
                ) : partyRowsWithBalance.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="text-center py-8 text-slate-400"
                    >
                      No party ledger entries found for this selection.
                    </td>
                  </tr>
                ) : (
                  partyRowsWithBalance.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-slate-100 hover:bg-slate-50/50"
                    >
                      <td className="py-2.5 px-3 text-slate-600">
                        {formatDate(row.entry_date)}
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-900">
                          {row.party_name || "ΓÇö"}
                        </div>
                        <div className="text-[12px] text-slate-400 capitalize">
                          {row.party_type}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-slate-600">
                        {row.reference || "ΓÇö"}
                      </td>

                      <td className="py-2.5 px-3 text-slate-700">
                        {row.description || "ΓÇö"}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {Number(row.debit) > 0
                          ? formatCurrency(Number(row.debit))
                          : "ΓÇö"}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {Number(row.credit) > 0
                          ? formatCurrency(Number(row.credit))
                          : "ΓÇö"}
                      </td>

                      <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                        {signedBalanceLabel(Number(row.displayBalance) || 0)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>

              {partyRowsWithBalance.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-200">
                    <td colSpan={4} className="py-3 px-3 text-right">
                      Total:
                    </td>
                    <td className="py-3 px-3 text-right">
                      {formatCurrency(totalDebit)}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {formatCurrency(totalCredit)}
                    </td>
                    <td className="py-3 px-3 text-right text-primary-700">
                      {selectedPartyKey
                        ? signedBalanceLabel(statementBalance)
                        : "Per Party"}
                    </td>
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
