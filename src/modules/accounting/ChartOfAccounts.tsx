import SearchableSelect from "@/components/SearchableSelect";
  import {
    useEffect,
    useMemo,
    useState,
    type ReactNode,
  } from "react";

  import {
    activateAccount,
    deactivateAccount,
    deleteAccount,
    listAccounts,
    saveAccount,
    ACCOUNT_DETAIL_TYPES,
    ACCOUNT_STATEMENTS,
    ACCOUNT_TYPE_LABELS,
  } from "@/lib/accountService";

  import { ChartOfAccount } from "@/types";

  /* -------------------------------------------------------------------------- */
  /* Types                                                                      */
  /* -------------------------------------------------------------------------- */

  type AccountType =
    | "asset"
    | "liability"
    | "equity"
    | "revenue"
    | "expense";

  /**
   * IMPORTANT:
   *
   * These are the ONLY account_role values allowed by the database
   * CHECK constraint:
   *
   * general
   * party
   * sales_person
   * charge
   * system
   */
  type AccountRole =
    | "general"
    | "party"
    | "sales_person"
    | "charge"
    | "system";

  type AccountRow = ChartOfAccount & {
    parent_id?: string | null;
    is_group?: boolean;
    allow_manual_entries?: boolean;
    is_active?: boolean;
    detail_type?: string | null;
    parent_head?: string | null;
    account_role?: string | null;
    is_system_account?: boolean;
  };

  type AccountForm = {
    id?: string;
    code: string;
    name: string;
    type: AccountType;
    parent_id: string | null;
    is_group: boolean;
    allow_manual_entries: boolean;
    is_active: boolean;
    detail_type: string;
    account_role: AccountRole;
    parent_head: string;
  };

  type DetailOption = {
    value: string;
    label: string;
    role?: string;
  };

  type SummaryFilter =
    | "all"
    | "active"
    | "group"
    | "posting";

  /* -------------------------------------------------------------------------- */
  /* Account types                                                              */
  /* -------------------------------------------------------------------------- */

  const ACCOUNT_TYPES: Array<{
    value: AccountType;
    label: string;
    statement: string;
  }> = [
    {
      value: "asset",
      label: "Asset",
      statement: "Balance Sheet",
    },
    {
      value: "liability",
      label: "Liability",
      statement: "Balance Sheet",
    },
    {
      value: "equity",
      label: "Equity",
      statement: "Balance Sheet",
    },
    {
      value: "revenue",
      label: "Income",
      statement: "Profit & Loss",
    },
    {
      value: "expense",
      label: "Expense",
      statement: "Profit & Loss",
    },
  ];

  /* -------------------------------------------------------------------------- */
  /* Database-safe account roles                                                */
  /* -------------------------------------------------------------------------- */

  const ACCOUNT_ROLES: Array<{
    value: AccountRole;
    label: string;
    description: string;
  }> = [
    {
      value: "general",
      label: "General",
      description: "Normal accounting account.",
    },
    {
      value: "party",
      label: "Party",
      description: "Customer / supplier / party-related account.",
    },
    {
      value: "sales_person",
      label: "Sales person",
      description: "Sales-person related account.",
    },
    {
      value: "charge",
      label: "Charge",
      description: "Charge, fee or adjustment account.",
    },
    {
      value: "system",
      label: "System",
      description: "System-controlled accounting account.",
    },
  ];

  /* -------------------------------------------------------------------------- */
  /* Automatic root code ranges                                                 */
  /* -------------------------------------------------------------------------- */

  const ROOT_CODE_BASE: Record<AccountType, number> = {
    asset: 1000,
    liability: 2000,
    equity: 3000,
    revenue: 4000,
    expense: 5000,
  };

  /* -------------------------------------------------------------------------- */
  /* Styles                                                                     */
  /* -------------------------------------------------------------------------- */

  const TYPE_STYLES: Record<
    AccountType,
    {
      badge: string;
      dot: string;
    }
  > = {
    asset: {
      badge: "bg-blue-50 text-blue-700 border-blue-200",
      dot: "bg-blue-500",
    },

    liability: {
      badge: "bg-amber-50 text-amber-700 border-amber-200",
      dot: "bg-amber-500",
    },

    equity: {
      badge: "bg-purple-50 text-purple-700 border-purple-200",
      dot: "bg-purple-500",
    },

    revenue: {
      badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
      dot: "bg-emerald-500",
    },

    expense: {
      badge: "bg-rose-50 text-rose-700 border-rose-200",
      dot: "bg-rose-500",
    },
  };

  /* -------------------------------------------------------------------------- */
  /* Empty form                                                                 */
  /* -------------------------------------------------------------------------- */

  const emptyForm: AccountForm = {
    code: "",
    name: "",
    type: "asset",
    parent_id: null,
    is_group: false,
    allow_manual_entries: true,
    is_active: true,
    detail_type: "",
    account_role: "general",
    parent_head: "",
  };

  /* -------------------------------------------------------------------------- */
  /* Allowed account role helper                                                */
  /* -------------------------------------------------------------------------- */

  /**
   * Converts any old/legacy role into one of the database-supported roles.
   *
   * Database allows ONLY:
   * general | party | sales_person | charge | system
   */
  function normalizeAccountRole(
    role: unknown
  ): AccountRole {
    const value =
      typeof role === "string"
        ? role.trim().toLowerCase()
        : "";

    switch (value) {
      case "party":
      case "receivable":
      case "payable":
      case "customer":
      case "supplier":
        return "party";

      case "sales_person":
      case "salesperson":
      case "sales-person":
        return "sales_person";

      case "charge":
      case "tax":
      case "fee":
      case "charges":
        return "charge";

      case "system":
        return "system";

      case "general":
      case "cash":
      case "bank":
      case "inventory":
      case "sales":
      case "expense":
      default:
        return "general";
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Helpers                                                                    */
  /* -------------------------------------------------------------------------- */

  function getChildren(
    accounts: AccountRow[],
    parentId: string | null
  ): AccountRow[] {
    return accounts
      .filter(
        (account) =>
          (account.parent_id ?? null) === parentId
      )
      .sort((a, b) =>
        a.code.localeCompare(
          b.code,
          undefined,
          {
            numeric: true,
          }
        )
      );
  }

  function hasChildren(
    accounts: AccountRow[],
    accountId: string
  ): boolean {
    return accounts.some(
      (account) =>
        account.parent_id === accountId
    );
  }

  /* -------------------------------------------------------------------------- */
  /* Automatic account code generation                                          */
  /* -------------------------------------------------------------------------- */

  function generateAccountCode(
    accounts: AccountRow[],
    type: AccountType,
    parentId: string | null
  ): string {
    const siblings = accounts.filter(
      (account) =>
        account.type === type &&
        (account.parent_id ?? null) === parentId
    );

    const usedCodes = new Set(
      accounts
        .map((account) =>
          Number.parseInt(account.code, 10)
        )
        .filter((value) =>
          Number.isFinite(value)
        )
    );

    /* Root account */

    if (!parentId) {
      const base = ROOT_CODE_BASE[type];

      let next = base;

      while (usedCodes.has(next)) {
        next += 1;
      }

      return String(next);
    }

    /* Child account */

    const parent = accounts.find(
      (account) =>
        account.id === parentId
    );

    if (!parent) {
      return generateAccountCode(
        accounts,
        type,
        null
      );
    }

    const parentCode = Number.parseInt(
      parent.code,
      10
    );

    if (!Number.isFinite(parentCode)) {
      return "";
    }

    const siblingCodes = new Set(
      siblings
        .map((account) =>
          Number.parseInt(account.code, 10)
        )
        .filter((value) =>
          Number.isFinite(value)
        )
    );

    let next = parentCode + 1;

    while (
      siblingCodes.has(next) ||
      usedCodes.has(next)
    ) {
      next += 1;
    }

    return String(next);
  }

  /* -------------------------------------------------------------------------- */
  /* Component                                                                  */
  /* -------------------------------------------------------------------------- */

  export default function ChartOfAccounts() {
    const [accounts, setAccounts] = useState<
      AccountRow[]
    >([]);

    const [loading, setLoading] =
      useState(true);

    const [saving, setSaving] =
      useState(false);

    const [search, setSearch] =
      useState("");

    const [typeFilter, setTypeFilter] =
      useState<"all" | AccountType>("all");

    const [statusFilter, setStatusFilter] =
      useState<
        "all" | "active" | "inactive"
      >("active");

    const [summaryFilter, setSummaryFilter] =
      useState<SummaryFilter>("active");

    const [expanded, setExpanded] =
      useState<Set<string>>(new Set());

    const [showModal, setShowModal] =
      useState(false);

    const [editingAccount, setEditingAccount] =
      useState<AccountRow | null>(null);

    const [form, setForm] =
      useState<AccountForm>(emptyForm);

    const [error, setError] =
      useState<string | null>(null);

    const [success, setSuccess] =
      useState<string | null>(null);

    /* ------------------------------------------------------------------------ */
    /* Load                                                                     */
    /* ------------------------------------------------------------------------ */

    async function loadAccounts() {
      try {
        setLoading(true);
        setError(null);

        const data = await listAccounts();

        const rows =
          (data ?? []) as AccountRow[];

        setAccounts(rows);

        const rootGroups = rows
          .filter(
            (account) =>
              !account.parent_id &&
              account.is_group
          )
          .map(
            (account) => account.id
          );

        setExpanded(
          new Set(rootGroups)
        );
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load Chart of Accounts."
        );
      } finally {
        setLoading(false);
      }
    }

    useEffect(() => {
      loadAccounts();
    }, []);

    /* ------------------------------------------------------------------------ */
    /* Detail types                                                             */
    /* ------------------------------------------------------------------------ */

    const detailTypes = useMemo(() => {
      return (
        ACCOUNT_DETAIL_TYPES[
          form.type
        ] as readonly DetailOption[]
      ) ?? [];
    }, [form.type]);

    const selectedDetail = useMemo(() => {
      return detailTypes.find(
        (item) =>
          item.value ===
          form.detail_type
      );
    }, [
      detailTypes,
      form.detail_type,
    ]);

    /* ------------------------------------------------------------------------ */
    /* Automatically generated code                                             */
    /* ------------------------------------------------------------------------ */

    const generatedCode = useMemo(() => {
      if (editingAccount) {
        return form.code;
      }

      return generateAccountCode(
        accounts,
        form.type,
        form.parent_id
      );
    }, [
      accounts,
      form.type,
      form.parent_id,
      editingAccount,
      form.code,
    ]);

    /* ------------------------------------------------------------------------ */
    /* Filter                                                                   */
    /* ------------------------------------------------------------------------ */

    const filteredAccounts = useMemo(() => {
      const query =
        search.trim().toLowerCase();

      const directlyMatched = accounts.filter(
        (account) => {
          const matchesSearch =
            !query ||
            account.code
              .toLowerCase()
              .includes(query) ||
            account.name
              .toLowerCase()
              .includes(query);

          const matchesType =
            typeFilter === "all" ||
            account.type === typeFilter;

          const matchesStatus =
            statusFilter === "all" ||
            (statusFilter === "active"
              ? account.is_active !== false
              : account.is_active === false);

          const matchesSummary =
            summaryFilter === "all" ||
            (summaryFilter === "active"
              ? account.is_active !== false
              : summaryFilter === "group"
                ? account.is_group === true
                : account.is_group !== true &&
                  account.allow_manual_entries !== false);

          return (
            matchesSearch &&
            matchesType &&
            matchesStatus &&
            matchesSummary
          );
        }
      );

      // Keep parent accounts as hierarchy context when a child matches a filter.
      const includedIds = new Set(
        directlyMatched.map((account) => account.id)
      );
      const accountById = new Map(
        accounts.map((account) => [account.id, account])
      );

      directlyMatched.forEach((account) => {
        let parentId = account.parent_id;

        while (parentId) {
          const parent = accountById.get(parentId);
          if (!parent) break;
          includedIds.add(parent.id);
          parentId = parent.parent_id;
        }
      });

      return accounts.filter((account) => includedIds.has(account.id));
    }, [
      accounts,
      search,
      typeFilter,
      statusFilter,
      summaryFilter,
    ]);

    function applySummaryFilter(filter: SummaryFilter) {
      setSummaryFilter(filter);

      if (filter === "group" || filter === "posting") {
        setExpanded(
          new Set(
            accounts
              .filter((account) => account.is_group)
              .map((account) => account.id)
          )
        );
      }

      if (filter === "active") {
        setStatusFilter("active");
      } else {
        setStatusFilter("all");
      }

      if (filter === "all") {
        setTypeFilter("all");
      }
    }

    /* ------------------------------------------------------------------------ */
    /* Visible accounts                                                         */
    /* ------------------------------------------------------------------------ */

    const visibleIds = useMemo(() => {
      const result =
        new Set<string>();

      function walk(
        parentId: string | null
      ) {
        const children =
          getChildren(
            filteredAccounts,
            parentId
          );

        for (const child of children) {
          result.add(child.id);

          if (
            child.is_group &&
            expanded.has(child.id)
          ) {
            walk(child.id);
          }
        }
      }

      walk(null);

      return result;
    }, [
      filteredAccounts,
      expanded,
    ]);

    const visibleAccounts = useMemo(
      () =>
        filteredAccounts.filter(
          (account) =>
            visibleIds.has(account.id)
        ),
      [
        filteredAccounts,
        visibleIds,
      ]
    );

    const rootAccounts = useMemo(
      () =>
        getChildren(
          filteredAccounts,
          null
        ),
      [filteredAccounts]
    );

    /* ------------------------------------------------------------------------ */
    /* Parent accounts                                                          */
    /* ------------------------------------------------------------------------ */

    const groupAccounts = useMemo(
      () =>
        accounts.filter(
          (account) =>
            account.is_group &&
            account.is_active !== false
        ),
      [accounts]
    );

    const availableParents = useMemo(
      () =>
        groupAccounts
          .filter((account) => {
            if (
              editingAccount?.id ===
              account.id
            ) {
              return false;
            }

            return (
              account.type ===
              form.type
            );
          })
          .sort((a, b) =>
            a.code.localeCompare(
              b.code,
              undefined,
              {
                numeric: true,
              }
            )
          ),
      [
        groupAccounts,
        form.type,
        editingAccount,
      ]
    );

    /* ------------------------------------------------------------------------ */
    /* Summary                                                                  */
    /* ------------------------------------------------------------------------ */

    const totalAccounts =
      accounts.length;

    const activeAccounts =
      accounts.filter(
        (account) =>
          account.is_active !== false
      ).length;

    const groupCount =
      accounts.filter(
        (account) =>
          account.is_group
      ).length;

    const postingCount =
      accounts.filter(
        (account) =>
          !account.is_group &&
          account.allow_manual_entries !== false
      ).length;

    /* ------------------------------------------------------------------------ */
    /* Tree controls                                                            */
    /* ------------------------------------------------------------------------ */

    function toggleExpanded(
      id: string
    ) {
      setExpanded((previous) => {
        const next =
          new Set(previous);

        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }

        return next;
      });
    }

    function expandAll() {
      setExpanded(
        new Set(
          accounts
            .filter(
              (account) =>
                account.is_group
            )
            .map(
              (account) =>
                account.id
            )
        )
      );
    }

    function collapseAll() {
      setExpanded(new Set());
    }

    /* ------------------------------------------------------------------------ */
    /* New account                                                              */
    /* ------------------------------------------------------------------------ */

    function openNewAccount(
      parent?: AccountRow
    ) {
      setEditingAccount(null);

      const type =
        parent?.type ?? "asset";

      const parentId =
        parent?.id ?? null;

      const autoCode =
        generateAccountCode(
          accounts,
          type,
          parentId
        );

      setForm({
        ...emptyForm,

        type,

        parent_id:
          parentId,

        is_group: false,

        allow_manual_entries: true,

        detail_type: "",

        account_role: "general",

        code: autoCode,
      });

      setError(null);
      setSuccess(null);
      setShowModal(true);
    }

    /* ------------------------------------------------------------------------ */
    /* Edit account                                                             */
    /* ------------------------------------------------------------------------ */

    function openEdit(
      account: AccountRow
    ) {
      setEditingAccount(account);

      setForm({
        id: account.id,

        code: account.code,

        name: account.name,

        type: account.type,

        parent_id:
          account.parent_id ??
          null,

        is_group:
          account.is_group ??
          false,

        allow_manual_entries:
          account.allow_manual_entries ??
          true,

        is_active:
          account.is_active !== false,

        detail_type:
          account.detail_type ??
          "",

        account_role:
          normalizeAccountRole(
            account.account_role
          ),

        parent_head:
          account.parent_head ??
          "",
      });

      setError(null);
      setSuccess(null);
      setShowModal(true);
    }

    /* ------------------------------------------------------------------------ */
    /* Close modal                                                              */
    /* ------------------------------------------------------------------------ */

    function closeModal() {
      if (saving) return;

      setShowModal(false);
      setEditingAccount(null);
      setForm(emptyForm);
      setError(null);
    }

    /* ------------------------------------------------------------------------ */
    /* Form update                                                              */
    /* ------------------------------------------------------------------------ */

    function updateForm<
      K extends keyof AccountForm
    >(
      key: K,
      value: AccountForm[K]
    ) {
      setForm((previous) => ({
        ...previous,
        [key]: value,
      }));
    }

    /* ------------------------------------------------------------------------ */
    /* Account type change                                                      */
    /* ------------------------------------------------------------------------ */

    function handleTypeChange(
      type: AccountType
    ) {
      const newCode =
        editingAccount
          ? editingAccount.code
          : generateAccountCode(
              accounts,
              type,
              null
            );

      setForm((previous) => ({
        ...previous,

        type,

        parent_id: null,

        detail_type: "",

        account_role: "general",

        parent_head: "",

        code: newCode,
      }));
    }

    /* ------------------------------------------------------------------------ */
    /* Parent change                                                            */
    /* ------------------------------------------------------------------------ */

    function handleParentChange(
      parentId: string | null
    ) {
      const newCode =
        editingAccount
          ? form.code
          : generateAccountCode(
              accounts,
              form.type,
              parentId
            );

      setForm((previous) => ({
        ...previous,

        parent_id: parentId,

        code: newCode,
      }));
    }

    /* ------------------------------------------------------------------------ */
    /* Detail type change                                                       */
    /* ------------------------------------------------------------------------ */

    function handleDetailTypeChange(
      value: string
    ) {
      const selected =
        detailTypes.find(
          (item) =>
            item.value === value
        );

      /**
       * IMPORTANT:
       *
       * selected.role may contain old values such as:
       * cash, bank, receivable, payable, inventory, etc.
       *
       * normalizeAccountRole() converts them into the
       * database-supported roles.
       */
      const safeRole =
        normalizeAccountRole(
          selected?.role
        );

      setForm((previous) => ({
        ...previous,

        detail_type: value,

        account_role: safeRole,
      }));
    }

    /* ------------------------------------------------------------------------ */
    /* Save                                                                     */
    /* ------------------------------------------------------------------------ */

    async function handleSave() {
      setError(null);

      if (!form.name.trim()) {
        setError(
          "Account name is required."
        );
        return;
      }

      const finalCode =
        editingAccount
          ? form.code.trim()
          : generatedCode.trim();

      if (!finalCode) {
        setError(
          "Unable to generate account code."
        );
        return;
      }

      if (
        form.is_group &&
        form.allow_manual_entries
      ) {
        setError(
          "Group accounts cannot allow manual journal entries."
        );
        return;
      }

      /**
       * FINAL SAFETY CHECK
       *
       * Never send an invalid account_role to Supabase.
       */
      const safeAccountRole =
        form.is_group
          ? "general"
          : normalizeAccountRole(
              form.account_role
            );

      try {
        setSaving(true);

        await saveAccount({
          id: editingAccount?.id,

          code: finalCode,

          name: form.name.trim(),

          type: form.type,

          parent_id:
            form.parent_id,

          is_group:
            form.is_group,

          allow_manual_entries:
            form.is_group
              ? false
              : form.allow_manual_entries,

          is_active:
            form.is_active,

          detail_type:
            form.detail_type.trim() ||
            null,

          parent_head:
            form.parent_head.trim() ||
            null,

          /**
           * Database-safe role.
           */
          account_role:
            safeAccountRole,
        });

        setSuccess(
          editingAccount
            ? "Account updated successfully."
            : "Account created successfully."
        );

        setShowModal(false);
        setEditingAccount(null);
        setForm(emptyForm);

        await loadAccounts();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to save account."
        );
      } finally {
        setSaving(false);
      }
    }

    /* ------------------------------------------------------------------------ */
    /* Toggle active                                                            */
    /* ------------------------------------------------------------------------ */

    async function handleToggleActive(
      account: AccountRow
    ) {
      try {
        setError(null);

        if (
          account.is_active === false
        ) {
          await activateAccount(
            account.id
          );
        } else {
          await deactivateAccount(
            account.id
          );
        }

        await loadAccounts();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to change account status."
        );
      }
    }

    /* ------------------------------------------------------------------------ */
    /* Delete                                                                   */
    /* ------------------------------------------------------------------------ */

    async function handleDelete(
      account: AccountRow
    ) {
      const confirmed =
        window.confirm(
          `Delete "${account.name}"?\n\nThis action cannot be undone.`
        );

      if (!confirmed) {
        return;
      }

      try {
        setError(null);

        await deleteAccount(
          account.id
        );

        setSuccess(
          "Account deleted successfully."
        );

        await loadAccounts();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to delete account."
        );
      }
    }

    /* ------------------------------------------------------------------------ */
    /* Indent                                                                   */
    /* ------------------------------------------------------------------------ */

    function getIndent(
      account: AccountRow
    ) {
      let depth = 0;

      let parentId =
        account.parent_id ??
        null;

      const visited =
        new Set<string>();

      while (parentId) {
        if (
          visited.has(parentId)
        ) {
          break;
        }

        visited.add(parentId);

        depth += 1;

        const parent =
          accounts.find(
            (item) =>
              item.id ===
              parentId
          );

        parentId =
          parent?.parent_id ??
          null;

        if (depth > 20) {
          break;
        }
      }

      return depth;
    }

    /* ------------------------------------------------------------------------ */
    /* Parent name                                                              */
    /* ------------------------------------------------------------------------ */

    function getParentName(
      account: AccountRow
    ) {
      if (!account.parent_id) {
        return "Root account";
      }

      return (
        accounts.find(
          (item) =>
            item.id ===
            account.parent_id
        )?.name ??
        "Unknown parent"
      );
    }

    /* ------------------------------------------------------------------------ */
    /* Render                                                                   */
    /* ------------------------------------------------------------------------ */

    return (
      <div className="min-h-screen bg-[#f4f7fb]">
        {/* Header */}

        <div className="border-b border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.03)]">
          <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-4">
                <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm sm:flex">
                  <span className="text-lg font-bold">COA</span>
                </div>

                <div>
                  <div className="mb-1 text-[12px] font-bold uppercase tracking-[0.18em] text-blue-600">
                    Accounting Master
                  </div>

                  <h1 className="text-2xl font-bold tracking-tight text-slate-950">Chart of Accounts</h1>

                  <p className="mt-1 max-w-2xl text-sm text-slate-500">
                    Manage account hierarchy, posting controls and financial-statement classification.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  openNewAccount()
                }
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <span className="text-lg leading-none">
                  +
                </span>

                New account
              </button>
            </div>
          </div>
        </div>

        {/* Main */}

        <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
          {error && (
            <div className="mb-4 flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span>{error}</span>

              <button
                type="button"
                onClick={() =>
                  setError(null)
                }
                className="font-semibold"
              >
                ×
              </button>
            </div>
          )}

          {success && (
            <div className="mb-4 flex items-start justify-between gap-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <span>{success}</span>

              <button
                type="button"
                onClick={() =>
                  setSuccess(null)
                }
                className="font-semibold"
              >
                ×
              </button>
            </div>
          )}

          {/* Summary */}

          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="Total accounts"
              value={totalAccounts}
              description="All accounts"
              tone="slate"
              active={summaryFilter === "all"}
              onClick={() => applySummaryFilter("all")}
            />

            <SummaryCard
              label="Active accounts"
              value={activeAccounts}
              description="Available for use"
              tone="emerald"
              active={summaryFilter === "active"}
              onClick={() => applySummaryFilter("active")}
            />

            <SummaryCard
              label="Group accounts"
              value={groupCount}
              description="Parent / category accounts"
              tone="amber"
              active={summaryFilter === "group"}
              onClick={() => applySummaryFilter("group")}
            />

            <SummaryCard
              label="Posting accounts"
              value={postingCount}
              description="Used in journal entries"
              tone="blue"
              active={summaryFilter === "posting"}
              onClick={() => applySummaryFilter("posting")}
            />
          </div>

          {/* Main table */}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.05)]">
            <div className="border-b border-slate-200 bg-white px-5 py-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-1 flex-col gap-3 md:flex-row">
                  <div className="relative min-w-0 flex-1 md:max-w-md">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                      ⌕
                    </span>

                    <input
                      value={search}
                      onChange={(event) =>
                        setSearch(
                          event.target.value
                        )
                      }
                      placeholder="Search account name or code"
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  <SearchableSelect
                    value={typeFilter}
                    onChange={(event) =>
                      setTypeFilter(
                        event.target.value as "all" | AccountType
                      )
                    }
                    className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="all">
                      All account types
                    </option>

                    {ACCOUNT_TYPES.map(
                      (type) => (
                        <option
                          key={
                            type.value
                          }
                          value={
                            type.value
                          }
                        >
                          {type.label}
                        </option>
                      )
                    )}
                  </SearchableSelect>

                  <SearchableSelect
                    value={statusFilter}
                    onChange={(event) => {
                      setStatusFilter(
                        event.target.value as "all" | "active" | "inactive"
                      );
                      setSummaryFilter("all");
                    }}
                    className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="active">
                      Active only
                    </option>

                    <option value="inactive">
                      Inactive only
                    </option>

                    <option value="all">
                      All statuses
                    </option>
                  </SearchableSelect>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={expandAll}
                    className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Expand all
                  </button>

                  <button
                    type="button"
                    onClick={
                      collapseAll
                    }
                    className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Collapse all
                  </button>

                  <button
                    type="button"
                    onClick={
                      loadAccounts
                    }
                    className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >Refresh</button>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <div data-report-content data-navilo-customizable="true" className="contents"><table className="w-full min-w-[1100px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900">
                    <th className="w-[39%] px-5 py-3.5 text-left text-[12px] font-bold uppercase tracking-wider text-slate-200">Account</th>

                    <th className="w-[10%] px-4 py-3.5 text-left text-[12px] font-bold uppercase tracking-wider text-slate-200">
                      Code
                    </th>

                    <th className="w-[12%] px-4 py-3.5 text-left text-[12px] font-bold uppercase tracking-wider text-slate-200">
                      Type
                    </th>

                    <th className="w-[15%] px-4 py-3.5 text-left text-[12px] font-bold uppercase tracking-wider text-slate-200">Detail type</th>

                    <th className="w-[12%] px-4 py-3.5 text-left text-[12px] font-bold uppercase tracking-wider text-slate-200">
                      Statement
                    </th>

                    <th className="w-[8%] px-4 py-3.5 text-left text-[12px] font-bold uppercase tracking-wider text-slate-200">Status</th>

                    <th className="w-[6%] px-4 py-3.5 text-right text-[12px] font-bold uppercase tracking-wider text-slate-200">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-5 py-16 text-center text-sm text-slate-500"
                      >
                        Loading Chart of Accounts...
                      </td>
                    </tr>
                  ) : visibleAccounts.length ===
                    0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-5 py-16 text-center"
                      >
                        <div className="text-sm font-medium text-slate-700">
                          No accounts found
                        </div>

                        <div className="mt-1 text-sm text-slate-400">
                          Create your first account to get started.
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            openNewAccount()
                          }
                          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                        >
                          New account
                        </button>
                      </td>
                    </tr>
                  ) : (
                    rootAccounts.map(
                      (account) => (
                        <AccountTreeRows
                          key={
                            account.id
                          }
                          account={
                            account
                          }
                          accounts={
                            filteredAccounts
                          }
                          allAccounts={
                            accounts
                          }
                          expanded={
                            expanded
                          }
                          onToggle={
                            toggleExpanded
                          }
                          onEdit={
                            openEdit
                          }
                          onAddChild={
                            openNewAccount
                          }
                          onDelete={
                            handleDelete
                          }
                          onToggleActive={
                            handleToggleActive
                          }
                          getParentName={
                            getParentName
                          }
                          getIndent={
                            getIndent
                          }
                        />
                      )
                    )
                  )}
                </tbody>
              </table></div>
            </div>

            {!loading && (
              <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Showing{" "}
                  {
                    visibleAccounts.length
                  }{" "}
                  of{" "}
                  {
                    filteredAccounts.length
                  }{" "}
                  accounts
                </span>

                <span>
                  Group accounts are categories and cannot receive direct journal entries.
                </span>
              </div>
            )}
          </div>
        </main>

        {/* ------------------------------------------------------------------ */}
        {/* Add / Edit Modal                                                   */}
        {/* ------------------------------------------------------------------ */}

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 sm:p-4">
            <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl">
              {/* Header */}

              <div className="shrink-0 border-b border-slate-200 px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[12px] font-semibold uppercase tracking-wider text-blue-600">
                      Accounting setup
                    </div>

                    <h2 className="mt-0.5 text-lg font-semibold text-slate-900">
                      {editingAccount
                        ? "Edit account"
                        : "Create account"}
                    </h2>

                    <p className="mt-0.5 text-xs text-slate-500">
                      Configure the account and hierarchy.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={
                      closeModal
                    }
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* Body */}

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {error && (
                  <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <div className="space-y-4">
                  {/* Basic information */}

                  <section>
                    <SectionTitle
                      title="Basic information"
                      description="Choose the main accounting classification."
                    />

                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <FormField
                        label="Account type"
                        required
                      >
                        <SearchableSelect
                          value={
                            form.type
                          }
                          onChange={(
                            event
                          ) =>
                            handleTypeChange(
                              event
                                .target
                                .value as AccountType
                            )
                          }
                          className="form-input"
                        >
                          {ACCOUNT_TYPES.map(
                            (type) => (
                              <option
                                key={
                                  type.value
                                }
                                value={
                                  type.value
                                }
                              >
                                {
                                  type.label
                                }
                              </option>
                            )
                          )}
                        </SearchableSelect>
                      </FormField>

                      <FormField label="Financial statement">
                        <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700">
                          {
                            ACCOUNT_STATEMENTS[
                              form.type
                            ]
                          }
                        </div>
                      </FormField>
                    </div>
                  </section>

                  {/* Account details */}

                  <section>
                    <SectionTitle
                      title="Account details"
                      description="Account name and automatic account number."
                    />

                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <FormField
                        label="Account name"
                        required
                      >
                        <input
                          value={
                            form.name
                          }
                          onChange={(
                            event
                          ) =>
                            updateForm(
                              "name",
                              event
                                .target
                                .value
                            )
                          }
                          placeholder="Enter account name"
                          className="form-input"
                          autoFocus
                        />
                      </FormField>

                      <FormField
                        label="Account code"
                        hint="Automatically generated by the system."
                      >
                        <div className="flex h-10 items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-3">
                          <span className="font-mono text-sm font-semibold text-blue-700">
                            {generatedCode ||
                              "Auto"}
                          </span>

                          <span className="text-[12px] font-medium text-blue-500">
                            AUTO
                          </span>
                        </div>
                      </FormField>
                    </div>

                    <div className="mt-3">
                      <FormField
                        label="Detail type"
                        hint="This classification determines how the account is presented in reporting."
                      >
                        <SearchableSelect
                          value={
                            form.detail_type
                          }
                          onChange={(
                            event
                          ) =>
                            handleDetailTypeChange(
                              event
                                .target
                                .value
                            )
                          }
                          className="form-input"
                        >
                          <option value="">
                            Select detail type
                          </option>

                          {detailTypes.map(
                            (
                              detail
                            ) => (
                              <option
                                key={
                                  detail.value
                                }
                                value={
                                  detail.value
                                }
                              >
                                {
                                  detail.label
                                }
                              </option>
                            )
                          )}
                        </SearchableSelect>
                      </FormField>
                    </div>
                  </section>

                  {/* Information */}

                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <InfoBox
                        label="Account type"
                        value={
                          ACCOUNT_TYPE_LABELS[
                            form.type
                          ]
                        }
                      />

                      <InfoBox
                        label="Statement"
                        value={
                          ACCOUNT_STATEMENTS[
                            form.type
                          ]
                        }
                      />

                      <InfoBox
                        label="Detail classification"
                        value={
                          selectedDetail?.label ??
                          "Not selected"
                        }
                      />
                    </div>
                  </div>

                  {/* Hierarchy */}

                  <section>
                    <SectionTitle
                      title="Account hierarchy"
                      description="Select a group account if this should be a subaccount."
                    />

                    <div className="mt-3">
                      <FormField
                        label="Parent account"
                        hint="Root account means this account has no parent."
                      >
                        <SearchableSelect
                          value={
                            form.parent_id ??
                            ""
                          }
                          onChange={(
                            event
                          ) =>
                            handleParentChange(
                              event
                                .target
                                .value ||
                                null
                            )
                          }
                          className="form-input"
                        >
                          <option value="">
                            Root account
                          </option>

                          {availableParents.map(
                            (
                              parent
                            ) => (
                              <option
                                key={
                                  parent.id
                                }
                                value={
                                  parent.id
                                }
                              >
                                {
                                  parent.code
                                }{" "}
                                —{" "}
                                {
                                  parent.name
                                }
                              </option>
                            )
                          )}
                        </SearchableSelect>
                      </FormField>
                    </div>

                    {form.parent_id && (
                      <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
                        <span className="font-semibold">
                          Subaccount:
                        </span>{" "}
                        this account will be placed under the selected parent and its code will be generated automatically.
                      </div>
                    )}

                    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={
                            form.is_group
                          }
                          onChange={(
                            event
                          ) => {
                            const checked =
                              event
                                .target
                                .checked;

                            setForm(
                              (
                                previous
                              ) => ({
                                ...previous,

                                is_group:
                                  checked,

                                allow_manual_entries:
                                  checked
                                    ? false
                                    : previous.allow_manual_entries,

                                /**
                                 * Group accounts should
                                 * always remain general.
                                 */
                                account_role:
                                  checked
                                    ? "general"
                                    : previous.account_role,
                              })
                            );
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />

                        <span>
                          <span className="block text-sm font-semibold text-slate-800">
                            Group account
                          </span>

                          <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                            Use this account as a parent/category. Group accounts cannot receive direct journal entries.
                          </span>
                        </span>
                      </label>
                    </div>
                  </section>

                  {/* Posting settings */}

                  <section>
                    <SectionTitle
                      title="Posting settings"
                      description="Control direct journal posting."
                    />

                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
                        <input
                          type="checkbox"
                          checked={
                            form.allow_manual_entries
                          }
                          disabled={
                            form.is_group
                          }
                          onChange={(
                            event
                          ) =>
                            updateForm(
                              "allow_manual_entries",
                              event
                                .target
                                .checked
                            )
                          }
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />

                        <span>
                          <span className="block text-sm font-semibold text-slate-800">
                            Allow manual entries
                          </span>

                          <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                            Available for journal entries.
                          </span>
                        </span>
                      </label>

                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
                        <input
                          type="checkbox"
                          checked={
                            form.is_active
                          }
                          onChange={(
                            event
                          ) =>
                            updateForm(
                              "is_active",
                              event
                                .target
                                .checked
                            )
                          }
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />

                        <span>
                          <span className="block text-sm font-semibold text-slate-800">
                            Active account
                          </span>

                          <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                            Available for accounting transactions.
                          </span>
                        </span>
                      </label>
                    </div>
                  </section>

                  {/* Metadata */}

                  <section>
                    <SectionTitle
                      title="Accounting metadata"
                      description="Optional metadata for accounting modules."
                    />

                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <FormField
                        label="Account role"
                        hint="Only database-supported account roles are available."
                      >
                        <SearchableSelect
                          value={
                            form.account_role
                          }
                          onChange={(
                            event
                          ) =>
                            updateForm(
                              "account_role",
                              normalizeAccountRole(
                                event
                                  .target
                                  .value
                              )
                            )
                          }
                          disabled={
                            form.is_group
                          }
                          className="form-input disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                        >
                          {ACCOUNT_ROLES.map(
                            (
                              role
                            ) => (
                              <option
                                key={
                                  role.value
                                }
                                value={
                                  role.value
                                }
                              >
                                {
                                  role.label
                                }
                              </option>
                            )
                          )}
                        </SearchableSelect>
                      </FormField>

                      <FormField
                        label="Parent head"
                        hint="Optional reporting label."
                      >
                        <input
                          value={
                            form.parent_head
                          }
                          onChange={(
                            event
                          ) =>
                            updateForm(
                              "parent_head",
                              event
                                .target
                                .value
                            )
                          }
                          placeholder="Optional"
                          className="form-input"
                        />
                      </FormField>
                    </div>

                    <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
                      <span className="font-semibold">
                        Account role:
                      </span>{" "}
                      {
                        ACCOUNT_ROLES.find(
                          (role) =>
                            role.value ===
                            form.account_role
                        )?.description
                      }
                    </div>
                  </section>
                </div>
              </div>

              {/* Footer */}

              <div className="shrink-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
                <button
                  type="button"
                  onClick={
                    closeModal
                  }
                  disabled={saving}
                  className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >Cancel</button>

                <button
                  type="button"
                  onClick={
                    handleSave
                  }
                  disabled={
                    saving ||
                    !form.name.trim()
                  }
                  className="h-9 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving
                    ? "Saving..."
                    : editingAccount
                      ? "Save changes"
                      : "Create account"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* -------------------------------------------------------------------------- */
  /* Summary Card                                                               */
  /* -------------------------------------------------------------------------- */

  function SummaryCard({
    label,
    value,
    description,
    tone,
    active,
    onClick,
  }: {
    label: string;
    value: number;
    description: string;
    tone: "slate" | "emerald" | "amber" | "blue";
    active: boolean;
    onClick: () => void;
  }) {
    const tones = {
      slate: {
        bar: "bg-slate-700",
        value: "text-slate-950",
        icon: "bg-slate-100 text-slate-700",
        mark: "Σ",
      },
      emerald: {
        bar: "bg-emerald-500",
        value: "text-emerald-700",
        icon: "bg-emerald-50 text-emerald-700",
        mark: "✓",
      },
      amber: {
        bar: "bg-amber-500",
        value: "text-amber-700",
        icon: "bg-amber-50 text-amber-700",
        mark: "▦",
      },
      blue: {
        bar: "bg-blue-600",
        value: "text-blue-700",
        icon: "bg-blue-50 text-blue-700",
        mark: "↗",
      },
    } as const;

    const selectedTone = tones[tone];

    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`relative w-full overflow-hidden rounded-xl border bg-white p-4 text-left shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
          active
            ? "-translate-y-0.5 border-slate-400 ring-2 ring-slate-200 shadow-md"
            : "border-slate-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
        }`}
      >
        <span className={`absolute inset-y-0 left-0 w-1 ${selectedTone.bar}`} />

        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[12px] font-bold uppercase tracking-wider text-slate-500">
              {label}
            </div>

            <div className={`mt-2 text-2xl font-bold tracking-tight ${selectedTone.value}`}>
              {value}
            </div>

            <div className="mt-0.5 text-xs text-slate-400">
              {description}
            </div>
          </div>

          <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold ${selectedTone.icon}`}>
            {selectedTone.mark}
          </div>
        </div>

        {active && (
          <span className="absolute bottom-2 right-3 text-[12px] font-bold uppercase tracking-wider text-slate-400">
            Filter active
          </span>
        )}
      </button>
    );
  }

  /* -------------------------------------------------------------------------- */
  /* Section title                                                              */
  /* -------------------------------------------------------------------------- */

  function SectionTitle({
    title,
    description,
  }: {
    title: string;
    description: string;
  }) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-slate-900">
          {title}
        </h3>

        <p className="mt-0.5 text-xs leading-5 text-slate-500">
          {description}
        </p>
      </div>
    );
  }

  /* -------------------------------------------------------------------------- */
  /* Form field                                                                 */
  /* -------------------------------------------------------------------------- */

  function FormField({
    label,
    required,
    hint,
    children,
  }: {
    label: string;
    required?: boolean;
    hint?: string;
    children: ReactNode;
  }) {
    return (
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          {label}

          {required && (
            <span className="ml-1 text-red-500">
              *
            </span>
          )}
        </label>

        {children}

        {hint && (
          <p className="mt-1 text-[12px] leading-4 text-slate-400">
            {hint}
          </p>
        )}
      </div>
    );
  }

  /* -------------------------------------------------------------------------- */
  /* Info box                                                                   */
  /* -------------------------------------------------------------------------- */

  function InfoBox({
    label,
    value,
  }: {
    label: string;
    value: string;
  }) {
    return (
      <div>
        <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </div>

        <div className="mt-0.5 truncate text-sm font-medium text-slate-700">
          {value}
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------------------- */
  /* Tree rows                                                                  */
  /* -------------------------------------------------------------------------- */

  function AccountTreeRows({
    account,
    accounts,
    allAccounts,
    expanded,
    onToggle,
    onEdit,
    onAddChild,
    onDelete,
    onToggleActive,
    getParentName,
    getIndent,
  }: {
    account: AccountRow;
    accounts: AccountRow[];
    allAccounts: AccountRow[];
    expanded: Set<string>;
    onToggle: (id: string) => void;
    onEdit: (
      account: AccountRow
    ) => void;
    onAddChild: (
      account: AccountRow
    ) => void;
    onDelete: (
      account: AccountRow
    ) => void;
    onToggleActive: (
      account: AccountRow
    ) => void;
    getParentName: (
      account: AccountRow
    ) => string;
    getIndent: (
      account: AccountRow
    ) => number;
  }) {
    const children =
      getChildren(
        accounts,
        account.id
      );

    const childExists =
      hasChildren(
        allAccounts,
        account.id
      );

    const isExpanded =
      expanded.has(account.id);

    const depth =
      getIndent(account);

    const style =
      TYPE_STYLES[
        account.type
      ];

    const detailLabel =
      account.detail_type
        ? findDetailLabel(
            account.type,
            account.detail_type
          )
        : "—";

    const statement =
      ACCOUNT_STATEMENTS[
        account.type
      ];

    return (
      <>
        <tr
          className={`group transition-colors hover:bg-blue-50/40 ${
            account.is_active === false
              ? "bg-slate-50/70 text-slate-400"
              : ""
          }`}
        >
          <td className="px-5 py-3.5">
            <div
              className="flex min-w-0 items-center"
              style={{
                paddingLeft:
                  `${depth * 28}px`,
              }}
            >
              <button
                type="button"
                onClick={() =>
                  childExists &&
                  onToggle(
                    account.id
                  )
                }
                className={`mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 ${
                  childExists
                    ? "hover:bg-slate-100 hover:text-slate-700"
                    : "cursor-default"
                }`}
              >
                {childExists ? (
                  <span
                    className={`text-xs transition-transform ${
                      isExpanded
                        ? "rotate-90"
                        : ""
                    }`}
                  >
                    ▶
                  </span>
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                )}
              </button>

              <div
                className={`mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                  account.is_group
                    ? "border-slate-200 bg-slate-100"
                    : "border-slate-100 bg-white shadow-sm"
                }`}
              >
                {account.is_group ? (
                  <span className="text-xs font-bold text-slate-600">
                    ▣
                  </span>
                ) : (
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${style.dot}`}
                  />
                )}
              </div>

              <div className="min-w-0">
                <div
                  className={`truncate text-sm ${
                    account.is_group
                      ? "font-semibold text-slate-900"
                      : "font-medium text-slate-800"
                  }`}
                >
                  {account.name}
                </div>

                <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                  {account.is_group && (
                    <span>
                      Group account
                    </span>
                  )}

                  {!account.is_group &&
                    account.allow_manual_entries !==
                      false && (
                      <span>
                        Posting account
                      </span>
                    )}
                </div>
              </div>
            </div>
          </td>

          <td className="px-4 py-3.5">
            <span className="font-mono text-sm text-slate-600">
              {account.code}
            </span>
          </td>

          <td className="px-4 py-3.5">
            <span
              className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${style.badge}`}
            >
              {
                ACCOUNT_TYPE_LABELS[
                  account.type
                ]
              }
            </span>
          </td>

          <td className="px-4 py-3.5">
            <span className="block max-w-[190px] truncate text-sm text-slate-600">
              {detailLabel}
            </span>
          </td>

          <td className="px-4 py-3.5">
            <span className="text-xs font-medium text-slate-600">
              {statement}
            </span>
          </td>

          <td className="px-4 py-3.5">
            <button
              type="button"
              onClick={() =>
                onToggleActive(
                  account
                )
              }
              className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                account.is_active ===
                false
                  ? "text-slate-400"
                  : "text-emerald-600"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  account.is_active ===
                  false
                    ? "bg-slate-400"
                    : "bg-emerald-500"
                }`}
              />

              {account.is_active ===
              false
                ? "Inactive"
                : "Active"}
            </button>
          </td>

          <td className="px-4 py-3.5 text-right">
            <div className="flex items-center justify-end gap-1">
              {account.is_group && (
                <button
                  type="button"
                  onClick={() =>
                    onAddChild(
                      account
                    )
                  }
                  title="Add subaccount"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-blue-600 transition hover:border-blue-200 hover:bg-blue-50"
                >
                  +
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  onEdit(
                    account
                  )
                }
                title="Edit account"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-slate-500 transition hover:border-slate-200 hover:bg-slate-100 hover:text-slate-800"
              >
                ✎
              </button>

              <button
                type="button"
                onClick={() =>
                  onDelete(
                    account
                  )
                }
                title="Delete account"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-red-500 transition hover:border-red-200 hover:bg-red-50"
              >
                ×
              </button>
            </div>
          </td>
        </tr>

        {isExpanded &&
          children.map(
            (child) => (
              <AccountTreeRows
                key={
                  child.id
                }
                account={
                  child
                }
                accounts={
                  accounts
                }
                allAccounts={
                  allAccounts
                }
                expanded={
                  expanded
                }
                onToggle={
                  onToggle
                }
                onEdit={
                  onEdit
                }
                onAddChild={
                  onAddChild
                }
                onDelete={
                  onDelete
                }
                onToggleActive={
                  onToggleActive
                }
                getParentName={
                  getParentName
                }
                getIndent={
                  getIndent
                }
              />
            )
          )}
      </>
    );
  }

  /* -------------------------------------------------------------------------- */
  /* Find detail label                                                          */
  /* -------------------------------------------------------------------------- */

  function findDetailLabel(
    type: AccountType,
    value: string
  ): string {
    const details =
      ACCOUNT_DETAIL_TYPES[
        type
      ] as readonly DetailOption[];

    return (
      details.find(
        (item) =>
          item.value === value
      )?.label ?? value
    );
  }
