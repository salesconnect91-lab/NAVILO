import { fetchAllPages } from "@/lib/fetchAllPages";
import { masterDeleteError } from "@/lib/masterDeleteError";
import { supabase } from "@/lib/supabase";
import { AccountMapping, ChartOfAccount } from "@/types";

/* -------------------------------------------------------------------------- */
/* Account metadata                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Stable mapping keys used by accounting modules.
 *
 * These are defaults only.
 * They do NOT automatically create accounts.
 */
export const DEFAULT_MAPPINGS = [
  ["cash", "Cash"],
  ["bank", "Bank"],
  ["accounts_receivable", "Accounts Receivable"],
  ["inventory", "Inventory"],
  ["input_vat", "Input VAT"],
  ["accounts_payable", "Accounts Payable"],
  ["output_vat", "Output VAT"],
  ["share_capital", "Share Capital"],
  ["retained_earnings", "Retained Earnings"],
  ["sales_revenue", "Sales Revenue"],
  ["service_revenue", "Service Revenue"],
  ["cogs", "Cost of Goods Sold"],
  ["salaries", "Salaries & Wages"],
  ["rent", "Rent"],
  ["utilities", "Utilities"],
  ["transport_expense", "Transport & Freight"],
  ["general_expense", "General Expenses"],
  ["driver_pay_expense", "Transport Driver Pay Expense"],
  ["employee_loan_receivable", "Employee Loan / Advance Receivable"],
] as const;

export const ACCOUNT_MAPPING_TYPES: Record<
  string,
  ChartOfAccount["type"]
> = {
  cash: "asset",
  bank: "asset",
  accounts_receivable: "asset",
  inventory: "asset",
  input_vat: "asset",
  accounts_payable: "liability",
  output_vat: "liability",
  share_capital: "equity",
  retained_earnings: "equity",
  sales_revenue: "revenue",
  service_revenue: "revenue",
  cogs: "expense",
  salaries: "expense",
  rent: "expense",
  utilities: "expense",
  transport_expense: "expense",
  general_expense: "expense",
  driver_pay_expense: "expense",
  employee_loan_receivable: "asset",
  // Read-compatible aliases retained while older installations are upgraded.
  sales: "revenue",
  cost_of_goods_sold: "expense",
  transport: "expense",
  expense: "expense",
};

async function getMappedKeysForAccount(
  accountId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("account_mappings")
    .select("mapping_key")
    .eq("account_id", accountId);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => String(row.mapping_key));
}

async function validateMappedAccountLifecycle(
  accountId: string,
  nextType: ChartOfAccount["type"],
  nextIsGroup: boolean,
  nextIsActive: boolean
): Promise<void> {
  const mappingKeys = await getMappedKeysForAccount(accountId);

  if (mappingKeys.length === 0) return;

  const mappingList = mappingKeys.join(", ");

  if (!nextIsActive) {
    throw new Error(
      `This account is used by mapping(s): ${mappingList}. Reassign those mappings before deactivating it.`
    );
  }

  if (nextIsGroup) {
    throw new Error(
      `This account is used by mapping(s): ${mappingList}. A mapped posting account cannot become a group account.`
    );
  }

  const incompatibleKey = mappingKeys.find(
    (key) => ACCOUNT_MAPPING_TYPES[key] !== nextType
  );

  if (incompatibleKey) {
    throw new Error(
      `Mapping '${incompatibleKey}' requires an ${ACCOUNT_MAPPING_TYPES[incompatibleKey] ?? "approved"} account. Reassign it before changing this account type.`
    );
  }
}

/**
 * Account types used by the accounting system.
 *
 * Database:
 * asset
 * liability
 * equity
 * revenue
 * expense
 *
 * UI can display revenue as "Income".
 */
export const ACCOUNT_TYPE_LABELS = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  revenue: "Income",
  expense: "Expense",
} as const;

/**
 * Financial statement for each account type.
 */
export const ACCOUNT_STATEMENTS = {
  asset: "Balance Sheet",
  liability: "Balance Sheet",
  equity: "Balance Sheet",
  revenue: "Profit & Loss",
  expense: "Profit & Loss",
} as const;

/**
 * Detail types.
 *
 * These are stored in chart_of_accounts.detail_type.
 *
 * The actual account type remains the main accounting classification.
 */
export const ACCOUNT_DETAIL_TYPES = {
  asset: [
    {
      value: "cash_and_cash_equivalents",
      label: "Cash and cash equivalents",
      role: "cash",
    },
    {
      value: "accounts_receivable",
      label: "Accounts receivable (A/R)",
      role: "receivable",
    },
    {
      value: "current_assets",
      label: "Current assets",
      role: "general",
    },
    {
      value: "fixed_assets",
      label: "Fixed assets",
      role: "general",
    },
    {
      value: "non_current_assets",
      label: "Non-current assets",
      role: "general",
    },
    {
      value: "inventory",
      label: "Inventory / اسٹاک",
      role: "inventory",
    },
    {
      value: "bank",
      label: "Bank",
      role: "bank",
    },
    {
      value: "cash",
      label: "Cash",
      role: "cash",
    },
    {
      value: "input_vat",
      label: "Input VAT",
      role: "tax",
    },
    {
      value: "other_current_asset",
      label: "Other current asset",
      role: "general",
    },
    {
      value: "other_non_current_asset",
      label: "Other non-current asset",
      role: "general",
    },
  ],

  liability: [
    {
      value: "credit_card",
      label: "Credit card",
      role: "general",
    },
    {
      value: "accounts_payable",
      label: "Accounts payable (A/P)",
      role: "payable",
    },
    {
      value: "current_liabilities",
      label: "Current liabilities",
      role: "general",
    },
    {
      value: "non_current_liabilities",
      label: "Non-current liabilities",
      role: "general",
    },
    {
      value: "output_vat",
      label: "Output VAT",
      role: "tax",
    },
    {
      value: "short_term_loan",
      label: "Short-term loan",
      role: "general",
    },
    {
      value: "long_term_loan",
      label: "Long-term loan",
      role: "general",
    },
    {
      value: "other_current_liability",
      label: "Other current liability",
      role: "general",
    },
    {
      value: "other_non_current_liability",
      label: "Other non-current liability",
      role: "general",
    },
  ],

  equity: [
    {
      value: "owners_equity",
      label: "Owner's equity",
      role: "general",
    },
    {
      value: "retained_earnings",
      label: "Retained earnings",
      role: "general",
    },
    {
      value: "owners_drawings",
      label: "Owner's drawings",
      role: "general",
    },
    {
      value: "capital",
      label: "Capital",
      role: "general",
    },
    {
      value: "other_equity",
      label: "Other equity",
      role: "general",
    },
  ],

  revenue: [
    {
      value: "income",
      label: "Income",
      role: "sales",
    },
    {
      value: "other_income",
      label: "Other income",
      role: "sales",
    },
    {
      value: "sales",
      label: "Sales / فروخت",
      role: "sales",
    },
    {
      value: "service_income",
      label: "Service income",
      role: "sales",
    },
    {
      value: "other_revenue",
      label: "Other revenue",
      role: "general",
    },
  ],

  expense: [
    {
      value: "cost_of_sales",
      label: "Cost of sales",
      role: "expense",
    },
    {
      value: "expenses",
      label: "Expenses / اخراجات",
      role: "expense",
    },
    {
      value: "other_expense",
      label: "Other expense",
      role: "expense",
    },
    {
      value: "cost_of_goods_sold",
      label: "Cost of Goods Sold",
      role: "expense",
    },
    {
      value: "operating_expense",
      label: "Operating expense",
      role: "expense",
    },
    {
      value: "administrative_expense",
      label: "Administrative expense",
      role: "expense",
    },
    {
      value: "selling_expense",
      label: "Selling expense",
      role: "expense",
    },
    {
      value: "finance_expense",
      label: "Finance expense",
      role: "expense",
    },
    {
      value: "tax_expense",
      label: "Tax expense",
      role: "tax",
    },
  ],
} as const;

/* -------------------------------------------------------------------------- */
/* Input type                                                                  */
/* -------------------------------------------------------------------------- */

type SaveAccountInput = {
  id?: string;

  code?: string;

  name: string;

  type: ChartOfAccount["type"];

  parent_id?: string | null;

  is_group?: boolean;

  allow_manual_entries?: boolean;

  is_active?: boolean;

  detail_type?: string | null;

  parent_head?: string | null;

  account_role?: string | null;

  is_system_account?: boolean;
};

/* -------------------------------------------------------------------------- */
/* List accounts                                                               */
/* -------------------------------------------------------------------------- */

export async function listAccounts(): Promise<ChartOfAccount[]> {
  return fetchAllPages<ChartOfAccount>((from,to)=>supabase
    .from("chart_of_accounts").select("*")
    .order("code",{ascending:true}).order("id",{ascending:true}).range(from,to));
}

/* -------------------------------------------------------------------------- */
/* Get account                                                                 */
/* -------------------------------------------------------------------------- */

export async function getAccountById(
  id: string
): Promise<ChartOfAccount | null> {
  const { data, error } = await supabase
    .from("chart_of_accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? null) as ChartOfAccount | null;
}

/* -------------------------------------------------------------------------- */
/* Validate parent                                                             */
/* -------------------------------------------------------------------------- */

async function validateParent(
  parentId: string | null | undefined,
  type: ChartOfAccount["type"],
  accountId?: string
): Promise<void> {
  if (!parentId) {
    return;
  }

  if (accountId && parentId === accountId) {
    throw new Error("An account cannot be its own parent.");
  }

  const parent = await getAccountById(parentId);

  if (!parent) {
    throw new Error("Selected parent account was not found.");
  }

  if (parent.type !== type) {
    throw new Error(
      `Parent "${parent.name}" must have the same account type.`
    );
  }

  if (!parent.is_group) {
    throw new Error(
      `"${parent.name}" is not a group account. Only group accounts can contain subaccounts.`
    );
  }

  if (parent.is_active === false) {
    throw new Error(
      `"${parent.name}" is inactive. An inactive account cannot be used as a parent.`
    );
  }

  /**
   * Protect against circular hierarchy.
   *
   * Example:
   *
   * A -> B -> C
   *
   * C cannot be moved under A if that creates a cycle.
   */
  if (accountId) {
    let currentParentId: string | null =
      parent.parent_id ?? null;

    const visited = new Set<string>();

    while (currentParentId) {
      if (currentParentId === accountId) {
        throw new Error(
          "Invalid hierarchy: this change would create a circular account structure."
        );
      }

      if (visited.has(currentParentId)) {
        break;
      }

      visited.add(currentParentId);

      const ancestor = await getAccountById(
        currentParentId
      );

      if (!ancestor) {
        break;
      }

      currentParentId = ancestor.parent_id ?? null;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Generate child code                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Generate the next child code under a parent.
 *
 * Example:
 *
 * 1000 Assets
 *   1001 Cash
 *   1002 Bank
 *
 * 1100 Current Assets
 *   1101 Accounts Receivable
 *   1102 Inventory
 *
 * Deeper:
 *
 * 1101
 *   11011 Customer A
 *   11012 Customer B
 */
async function generateChildCode(
  parentId: string,
  type: ChartOfAccount["type"]
): Promise<string> {
  const parent = await getAccountById(parentId);

  if (!parent) {
    throw new Error("Parent account was not found.");
  }

  if (parent.type !== type) {
    throw new Error(
      `Parent account type must be ${type}, but parent is ${parent.type}.`
    );
  }

  if (!parent.is_group) {
    throw new Error(
      `"${parent.name}" is a posting account and cannot have child accounts.`
    );
  }

  const { data, error } = await supabase
    .from("chart_of_accounts")
    .select("id, code, type, parent_id")
    .eq("parent_id", parentId)
    .order("code", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const children = (data ?? []) as Array<{
    id: string;
    code: string;
    type: ChartOfAccount["type"];
    parent_id: string | null;
  }>;

  const usedCodes = new Set(
    children
      .map((child) => child.code)
      .filter(Boolean)
  );

  const parentCode = parent.code.trim();

  if (!parentCode) {
    throw new Error(
      "Parent account does not have a valid account code."
    );
  }

  /**
   * Preferred 4-digit structure:
   *
   * 1000 -> 1001 -> 1002 -> 1003
   */
  if (parentCode.length === 4) {
    const parentNumber = Number(parentCode);

    if (!Number.isFinite(parentNumber)) {
      throw new Error(
        `Parent account code "${parentCode}" is not numeric.`
      );
    }

    let next = Math.floor(parentNumber) + 1;

    while (usedCodes.has(String(next).padStart(4, "0"))) {
      next += 1;
    }

    return String(next).padStart(4, "0");
  }

  /**
   * Deeper hierarchy:
   *
   * 1101 -> 11011
   * 1101 -> 11012
   */
  let suffix = 1;

  let nextCode = `${parentCode}${suffix}`;

  while (usedCodes.has(nextCode)) {
    suffix += 1;
    nextCode = `${parentCode}${suffix}`;
  }

  return nextCode;
}

/* -------------------------------------------------------------------------- */
/* Unique code                                                                */
/* -------------------------------------------------------------------------- */

async function validateUniqueCode(
  code: string,
  accountId?: string
): Promise<void> {
  let query = supabase
    .from("chart_of_accounts")
    .select("id")
    .eq("code", code);

  if (accountId) {
    query = query.neq("id", accountId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (data) {
    throw new Error(
      `Account code ${code} is already in use.`
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Save account                                                                */
/* -------------------------------------------------------------------------- */

export async function saveAccount(
  account: SaveAccountInput
): Promise<void> {
  const name = account.name.trim();

  if (!name) {
    throw new Error("Account name is required.");
  }

  const isGroup = account.is_group ?? false;

  const parentId = account.parent_id ?? null;

  if (account.id) {
    await validateMappedAccountLifecycle(
      account.id,
      account.type,
      isGroup,
      account.is_active ?? true
    );
  }

  /**
   * Validate parent first.
   */
  await validateParent(
    parentId,
    account.type,
    account.id
  );

  /**
   * If an existing account is being edited, make sure
   * we do not accidentally convert an account with children
   * into a posting account.
   */
  if (account.id && !isGroup) {
    const { data: children, error } = await supabase
      .from("chart_of_accounts")
      .select("id")
      .eq("parent_id", account.id)
      .limit(1);

    if (error) {
      throw new Error(error.message);
    }

    if (children && children.length > 0) {
      throw new Error(
        "This account has subaccounts and must remain a group account."
      );
    }
  }

  let code = account.code?.trim() || "";

  /**
   * New child:
   *
   * Always generate its code automatically.
   */
  if (!account.id && parentId) {
    code = await generateChildCode(
      parentId,
      account.type
    );
  }

  /**
   * Root accounts need their own code.
   */
  if (!code) {
    throw new Error(
      "Account code is required for a root account."
    );
  }

  await validateUniqueCode(
    code,
    account.id
  );

  /**
   * IMPORTANT:
   *
   * Do NOT add "description" here.
   *
   * Your current DB table does not contain a description
   * column according to the schema you supplied.
   */
  const payload = {
    code,
    name,
    type: account.type,

    /**
     * Hierarchy
     */
    parent_id: parentId,

    /**
     * Group / posting behaviour
     */
    is_group: isGroup,

    allow_manual_entries: isGroup
      ? false
      : account.allow_manual_entries ?? true,

    /**
     * Status
     */
    is_active: account.is_active ?? true,

    /**
     * Accounting classification
     */
    detail_type:
      account.detail_type?.trim() || null,

    parent_head:
      account.parent_head?.trim() || null,

    account_role:
      account.account_role?.trim() || "general",

    /**
     * System account.
     *
     * Only include this when explicitly supplied.
     * This avoids unnecessarily overwriting the DB default.
     */
    ...(account.is_system_account !== undefined
      ? {
          is_system_account:
            account.is_system_account,
        }
      : {}),
  };

  /**
   * UPDATE
   */
  if (account.id) {
    const { error } = await supabase
      .from("chart_of_accounts")
      .update(payload)
      .eq("id", account.id);

    if (error) {
      throw new Error(error.message);
    }

    return;
  }

  /**
   * INSERT
   */
  const { error } = await supabase
    .from("chart_of_accounts")
    .insert(payload);

  if (error) {
    throw new Error(error.message);
  }
}

/* -------------------------------------------------------------------------- */
/* Default COA                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * We intentionally do NOT automatically create accounts.
 *
 * The user controls the Chart of Accounts.
 */
export async function ensureDefaultChartOfAccounts() {
  return;
}

/* -------------------------------------------------------------------------- */
/* Activate                                                                    */
/* -------------------------------------------------------------------------- */

export async function activateAccount(
  id: string
): Promise<void> {
  const { error } = await supabase
    .from("chart_of_accounts")
    .update({
      is_active: true,
    })
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

/* -------------------------------------------------------------------------- */
/* Deactivate                                                                  */
/* -------------------------------------------------------------------------- */

export async function deactivateAccount(
  id: string
): Promise<void> {
  /**
   * Check if account has children.
   *
   * We allow deactivation, but an inactive parent should not
   * be used for creating new children.
   */
  const account = await getAccountById(id);

  if (!account) {
    throw new Error("Account not found.");
  }

  await validateMappedAccountLifecycle(
    id,
    account.type,
    account.is_group ?? false,
    false
  );

  const { error } = await supabase
    .from("chart_of_accounts")
    .update({
      is_active: false,
    })
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

/* -------------------------------------------------------------------------- */
/* Delete                                                                      */
/* -------------------------------------------------------------------------- */

export async function deleteAccount(
  id: string
): Promise<void> {
  const account = await getAccountById(id);

  if (!account) {
    throw new Error("Account not found.");
  }

  /**
   * System accounts cannot be deleted.
   */
  if (account.is_system_account) {
    throw new Error(
      `"${account.name}" is a system account and cannot be deleted.`
    );
  }

  /**
   * Do not delete accounts that contain children.
   */
  const { data: children, error: childError } =
    await supabase
      .from("chart_of_accounts")
      .select("id")
      .eq("parent_id", id)
      .limit(1);

  if (childError) {
    throw new Error(childError.message);
  }

  if (children && children.length > 0) {
    throw new Error(
      `"${account.name}" has subaccounts. Move or delete the subaccounts first.`
    );
  }

  /**
   * Delete account.
   */
  const { error } = await supabase
    .from("chart_of_accounts")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(masterDeleteError(error));
  }
}

/* -------------------------------------------------------------------------- */
/* Account mappings                                                            */
/* -------------------------------------------------------------------------- */

export async function listMappings(): Promise<
  AccountMapping[]
> {
  return fetchAllPages<AccountMapping>((from,to)=>supabase
    .from("account_mappings").select("*, account:chart_of_accounts(*)")
    .order("mapping_key").order("id").range(from,to));
}

/* -------------------------------------------------------------------------- */
/* Set mapping                                                                 */
/* -------------------------------------------------------------------------- */

export async function setMapping(
  mappingKey: string,
  accountId: string
): Promise<void> {
  if (!mappingKey || !accountId) {
    throw new Error(
      "Mapping key and account are required."
    );
  }

  const normalizedKey = mappingKey.trim().toLowerCase();
  const expectedType = ACCOUNT_MAPPING_TYPES[normalizedKey];

  if (!expectedType) {
    throw new Error(
      `Unsupported accounting mapping key '${mappingKey}'.`
    );
  }

  const { data: account, error: accountError } = await supabase
    .from("chart_of_accounts")
    .select("id,type,is_active,is_group")
    .eq("id", accountId)
    .maybeSingle();

  if (accountError) {
    throw new Error(accountError.message);
  }

  if (!account) {
    throw new Error(
      "The selected account does not exist or belongs to another company."
    );
  }

  if (account.is_group) {
    throw new Error(
      "A group/header account cannot be used as an accounting mapping."
    );
  }

  if (!account.is_active) {
    throw new Error(
      "An inactive account cannot be used as an accounting mapping."
    );
  }

  if (account.type !== expectedType) {
    throw new Error(
      `'${normalizedKey}' requires an ${expectedType} account, not ${account.type}.`
    );
  }

  const { error } = await supabase
    .from("account_mappings")
    .upsert(
      {
        mapping_key: normalizedKey,
        account_id: accountId,
      },
      {
        onConflict: "company_id,mapping_key",
      }
    );

  if (error) {
    throw new Error(error.message);
  }
}

/* -------------------------------------------------------------------------- */
/* Resolve mapping                                                             */
/* -------------------------------------------------------------------------- */

export async function resolveMappedAccount(
  mappingKey: string
): Promise<ChartOfAccount> {
  const { data, error } = await supabase
    .from("account_mappings")
    .select(
      "account:chart_of_accounts(*)"
    )
    .eq("mapping_key", mappingKey)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const account = (data as any)?.account as
    | ChartOfAccount
    | null;

  if (!account) {
    throw new Error(
      `No Chart of Accounts mapping configured for '${mappingKey}'.`
    );
  }

  return account;
}
