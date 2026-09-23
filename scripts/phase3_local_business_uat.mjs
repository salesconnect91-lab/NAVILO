#!/usr/bin/env node

// NAVILO Phase 3 local-only business correctness UAT.
// Uses only synthetic data on localhost:54321, refuses the production ref,
// keeps generated credentials in memory and emits sanitized expected/actual evidence.

import { randomBytes, randomUUID } from "node:crypto";
import {
  asUser,
  productionRef,
  provision,
  readLocalStatus,
  requireOk,
  rpcPath,
  serviceSelect,
  signIn,
} from "./phase2b_local_security_tests.mjs";

const evidence = [];
const today = new Date().toISOString().slice(0, 10);
const year = Number(today.slice(0, 4));
const runTag = `${Date.now()}-${randomBytes(3).toString("hex")}`;

function sanitizeMessage(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[synthetic-email-redacted]")
    .replace(/[A-F0-9]{8}-[A-F0-9]{4}-[1-5][A-F0-9]{3}-[89AB][A-F0-9]{3}-[A-F0-9]{12}/gi, "[uuid-redacted]");
}

function responseActual(result) {
  if (result.ok) {
    if (Array.isArray(result.data)) return `ROWS:${result.data.length}`;
    if (result.data && typeof result.data === "object") {
      const safe = {};
      for (const key of ["success", "status", "entry_no", "note_no", "payment_amount", "allocated_amount", "grand_total", "total"]) {
        if (key in result.data) safe[key] = result.data[key];
      }
      return `OK:${JSON.stringify(Object.keys(safe).length ? safe : { object: true })}`;
    }
    return `OK:${JSON.stringify(result.data)}`;
  }
  const code = result.data && typeof result.data === "object" ? result.data.code : null;
  const message = result.data && typeof result.data === "object" ? sanitizeMessage(result.data.message) : null;
  return `DENIED:HTTP_${result.status}${code ? `:${code}` : ""}${message ? `:${message}` : ""}`;
}

function record(area, test, expected, actual, pass) {
  evidence.push({ area, test, expected, actual: sanitizeMessage(String(actual)), pass: Boolean(pass) });
}

function near(actual, expected, tolerance = 0.01) {
  return Math.abs(Number(actual) - Number(expected)) <= tolerance;
}

async function userRequest(local, token, table, method, query = "", body) {
  return asUser(local, token, `/rest/v1/${table}${query ? `?${query}` : ""}`, {
    method,
    body,
    prefer: method === "DELETE" ? "return=representation" : "return=representation",
  });
}

async function userInsert(local, token, table, rows) {
  const result = await userRequest(local, token, table, "POST", "", rows);
  return requireOk(result, `authenticated insert ${table}`);
}

async function userPatch(local, token, table, query, body) {
  return userRequest(local, token, table, "PATCH", query, body);
}

async function rpc(local, token, name, body = {}) {
  return asUser(local, token, rpcPath(name), { method: "POST", body });
}

async function selectOne(local, table, query, label) {
  const rows = await serviceSelect(local, table, query);
  if (rows.length !== 1) throw new Error(`${label} expected exactly one row, got ${rows.length}.`);
  return rows[0];
}

async function selectMany(local, table, query) {
  return serviceSelect(local, table, query);
}

async function selectContext(local, token, companyId, businessUnitId, branchId) {
  requireOk(await rpc(local, token, "set_current_company", { p_company_id: companyId }), "select Phase 3 company");
  requireOk(await rpc(local, token, "set_current_business_unit", { p_business_unit_id: businessUnitId }), "select Phase 3 business unit");
  requireOk(await rpc(local, token, "set_current_operating_location", { p_location_id: branchId }), "select Phase 3 branch");
}

async function stockQuantity(local, fixture, itemId, godownId) {
  const rows = await selectMany(
    local,
    "warehouse_stock",
    `select=quantity&company_id=eq.${fixture.companyA}&business_unit_id=eq.${fixture.businessUnitA1}&operating_location_id=eq.${fixture.branchA1}&item_id=eq.${itemId}&godown_id=eq.${godownId}`,
  );
  return rows.length === 1 ? Number(rows[0].quantity) : null;
}

async function documentState(local, table, id) {
  return selectOne(local, table, `select=*&id=eq.${id}`, `${table} state`);
}

async function journalBalance(local, entryId) {
  const rows = await selectMany(local, "journal_lines", `select=debit,credit&entry_id=eq.${entryId}`);
  return {
    rows: rows.length,
    debit: rows.reduce((sum, row) => sum + Number(row.debit ?? 0), 0),
    credit: rows.reduce((sum, row) => sum + Number(row.credit ?? 0), 0),
  };
}

async function setupBusinessFixture(local, fixture, tokens) {
  // Phase 3 must exercise each role inside the same explicit workspace context
  // that the UI establishes after login. Previously only the owner selected the
  // company/BU/branch, so accountsA payment RPCs could post under a different
  // session workspace and post_journal_entry correctly rejected the new journal.
  await selectContext(local, tokens.owner, fixture.companyA, fixture.businessUnitA1, fixture.branchA1);
  await selectContext(local, tokens.accountsA, fixture.companyA, fixture.businessUnitA1, fixture.branchA1);
  await selectContext(local, tokens.salesA, fixture.companyA, fixture.businessUnitA1, fixture.branchA1);
  await selectContext(local, tokens.viewerA, fixture.companyA, fixture.businessUnitA1, fixture.branchA1);

  const initialize = await rpc(local, tokens.owner, "initialize_default_coa", {});
  requireOk(initialize, "initialize default chart of accounts");

  const mappings = await selectMany(
    local,
    "account_mappings",
    `select=mapping_key,account_id&company_id=eq.${fixture.companyA}`,
  );
  const account = Object.fromEntries(mappings.map((row) => [row.mapping_key, row.account_id]));
  for (const key of ["cash", "bank", "accounts_receivable", "accounts_payable", "inventory", "input_vat", "output_vat", "sales_revenue", "cogs", "general_expense"]) {
    if (!account[key]) throw new Error(`Default COA mapping ${key} is missing after initialization.`);
  }

  requireOk(
    await userPatch(local, tokens.owner, "customers", `id=eq.${fixture.customerA}`, { account_id: account.accounts_receivable }),
    "link synthetic customer to AR",
  );

  const supplierId = randomUUID();
  const warehouseId = randomUUID();
  const godownId = randomUUID();
  const itemId = randomUUID();
  const master = {
    company_id: fixture.companyA,
  };
  const transaction = {
    ...master,
    business_unit_id: fixture.businessUnitA1,
    operating_location_id: fixture.branchA1,
  };

  await userInsert(local, tokens.owner, "suppliers", [{
    ...master,
    id: supplierId,
    name: `PHASE3 Supplier ${runTag}`,
    account_id: account.accounts_payable,
  }]);
  await userInsert(local, tokens.owner, "warehouses", [{
    ...master,
    id: warehouseId,
    name: `PHASE3 Warehouse ${runTag}`,
    location: "Synthetic local UAT",
  }]);
  await userInsert(local, tokens.owner, "godowns", [{
    ...master,
    id: godownId,
    warehouse_id: warehouseId,
    name: `PHASE3 Godown ${runTag}`,
    location: "Synthetic local UAT",
  }]);
  await userInsert(local, tokens.owner, "items", [{
    ...master,
    id: itemId,
    sku: `P3-${runTag}`,
    name: `PHASE3 Item ${runTag}`,
    type: "finished",
    unit: "pcs",
    cost: 50,
    price: 100,
    warehouse_id: warehouseId,
  }]);

  return { account, supplierId, warehouseId, godownId, itemId, transaction };
}

async function createPurchase(local, fixture, tokens, business, suffix, qty = 10, unitCost = 50) {
  const orderId = randomUUID();
  const lineId = randomUUID();
  const orderNo = `P3-PO-${suffix}-${runTag}`;
  await userInsert(local, tokens.owner, "purchase_orders", [{
    ...business.transaction,
    id: orderId,
    order_no: orderNo,
    supplier_id: business.supplierId,
    order_date: today,
    status: "draft",
    invoice_type: "Purchase Invoice",
    tax_percent: 0,
    total: qty * unitCost,
  }]);
  await userInsert(local, tokens.owner, "purchase_order_lines", [{
    ...business.transaction,
    id: lineId,
    order_id: orderId,
    item_id: business.itemId,
    godown_id: business.godownId,
    qty,
    unit_cost: unitCost,
    line_total: qty * unitCost,
    tax_percent: 0,
    description: "Synthetic purchase line",
  }]);
  return { orderId, lineId, orderNo, qty, unitCost, total: qty * unitCost };
}

async function createSale(local, fixture, tokens, business, suffix, qty = 4, unitPrice = 100) {
  const orderId = randomUUID();
  const lineId = randomUUID();
  const orderNo = `P3-SI-${suffix}-${runTag}`;
  await userInsert(local, tokens.owner, "sales_orders", [{
    ...business.transaction,
    id: orderId,
    order_no: orderNo,
    customer_id: fixture.customerA,
    order_date: today,
    status: "draft",
    invoice_type: "Sale Invoice",
    payment_mode: "Credit",
    settlement_method: "Credit",
    tax_percent: 0,
    total: qty * unitPrice,
  }]);
  await userInsert(local, tokens.owner, "sales_order_lines", [{
    ...business.transaction,
    id: lineId,
    order_id: orderId,
    item_id: business.itemId,
    godown_id: business.godownId,
    qty,
    unit_price: unitPrice,
    line_total: qty * unitPrice,
    tax_percent: 0,
    description: "Synthetic sales line",
  }]);
  return { orderId, lineId, orderNo, qty, unitPrice, total: qty * unitPrice };
}

async function testPurchase(local, fixture, tokens, business) {
  const purchase = await createPurchase(local, fixture, tokens, business, "MAIN");
  const posted = await rpc(local, tokens.owner, "post_purchase_invoice", { p_order_id: purchase.orderId });
  record("purchase", "valid purchase invoice posts", "success=true", responseActual(posted), posted.ok && posted.data?.success === true);
  if (!posted.ok || posted.data?.success !== true) return null;

  const state = await documentState(local, "purchase_orders", purchase.orderId);
  record("purchase", "posted totals and AP outstanding", "posted,total=500,outstanding=500", `${state.status},${state.total},${state.outstanding_amount}`, state.status === "posted" && near(state.total, 500) && near(state.outstanding_amount, 500));

  const lineSnapshot = await selectOne(local, "purchase_order_lines", `select=description,item_name_snapshot,item_unit_snapshot,godown_name_snapshot&id=eq.${purchase.lineId}`, "purchase line snapshot");
  record("purchase", "posted purchase preserves line names", "description and item/unit/godown snapshots populated", `${lineSnapshot.description},${lineSnapshot.item_name_snapshot},${lineSnapshot.item_unit_snapshot},${lineSnapshot.godown_name_snapshot}`, lineSnapshot.description === "Synthetic purchase line" && Boolean(lineSnapshot.item_name_snapshot) && Boolean(lineSnapshot.item_unit_snapshot) && Boolean(lineSnapshot.godown_name_snapshot));

  const stock = await stockQuantity(local, fixture, business.itemId, business.godownId);
  record("inventory", "purchase increases branch stock", "quantity=10", `quantity=${stock}`, near(stock, 10));

  const journal = await selectOne(local, "journal_entries", `select=id,status&company_id=eq.${fixture.companyA}&entry_no=eq.PUR-${encodeURIComponent(purchase.orderNo)}`, "purchase journal");
  const balance = await journalBalance(local, journal.id);
  record("accounting", "purchase journal balances", "debit=credit=500", `rows=${balance.rows},debit=${balance.debit},credit=${balance.credit}`, balance.rows >= 2 && near(balance.debit, 500) && near(balance.credit, 500));

  const repeat = await rpc(local, tokens.owner, "post_purchase_invoice", { p_order_id: purchase.orderId });
  const stockAfterRepeat = await stockQuantity(local, fixture, business.itemId, business.godownId);
  const journalsAfterRepeat = await selectMany(local, "journal_entries", `select=id&company_id=eq.${fixture.companyA}&entry_no=eq.PUR-${encodeURIComponent(purchase.orderNo)}`);
  record("purchase", "duplicate purchase posting is atomic", "denied,one journal,stock unchanged", `${responseActual(repeat)},journals=${journalsAfterRepeat.length},stock=${stockAfterRepeat}`, !repeat.ok && journalsAfterRepeat.length === 1 && near(stockAfterRepeat, 10));

  const patch = await userPatch(local, tokens.owner, "purchase_orders", `id=eq.${purchase.orderId}`, { total: 999 });
  const afterPatch = await documentState(local, "purchase_orders", purchase.orderId);
  record("immutability", "posted purchase cannot be edited", "denied or zero rows,total=500", `${responseActual(patch)},total=${afterPatch.total}`, (!patch.ok || patch.data?.length === 0) && near(afterPatch.total, 500));

  const deletion = await userRequest(local, tokens.owner, "purchase_orders", "DELETE", `id=eq.${purchase.orderId}`);
  const afterDelete = await selectMany(local, "purchase_orders", `select=id&id=eq.${purchase.orderId}`);
  record("immutability", "posted purchase cannot be deleted", "denied or zero rows,row remains", `${responseActual(deletion)},remaining=${afterDelete.length}`, (!deletion.ok || deletion.data?.length === 0) && afterDelete.length === 1);

  const supplierPayment = await rpc(local, tokens.accountsA, "pay_supplier", {
    p_supplier_id: business.supplierId,
    p_payment_date: today,
    p_payment_account_id: business.account.cash,
    p_payment_method: "cash",
    p_reference: "PHASE3-UAT",
    p_description: "Synthetic partial supplier payment",
    p_notes: "Local only",
    p_purchase_order_id: purchase.orderId,
    p_amount: 200,
  });
  record("accounts-payable", "partial supplier payment posts", "success=true,payment=200", responseActual(supplierPayment), supplierPayment.ok && supplierPayment.data?.success === true && near(supplierPayment.data?.payment_amount, 200));

  const paidState = await documentState(local, "purchase_orders", purchase.orderId);
  record("accounts-payable", "supplier payment updates AP status", "paid=200,outstanding=300,partial", `${paidState.paid_amount},${paidState.outstanding_amount},${paidState.payment_status}`, near(paidState.paid_amount, 200) && near(paidState.outstanding_amount, 300) && paidState.payment_status === "partial");

  const overpay = await rpc(local, tokens.accountsA, "pay_supplier", {
    p_supplier_id: business.supplierId,
    p_payment_date: today,
    p_payment_account_id: business.account.cash,
    p_payment_method: "cash",
    p_reference: "PHASE3-OVERPAY",
    p_description: "Must fail",
    p_notes: "Local only",
    p_purchase_order_id: purchase.orderId,
    p_amount: 400,
  });
  const overpayActual = responseActual(overpay);
  record("accounts-payable", "supplier overpayment is rejected", "denied for outstanding-limit violation", overpayActual, !overpay.ok && overpayActual.includes("exceeds Purchase Invoice outstanding balance"));

  const reverse = await rpc(local, tokens.accountsA, "reverse_payment_voucher", {
    p_journal_entry_id: supplierPayment.data?.journal_entry_id,
    p_reversal_date: today,
    p_reason: "Phase 3 regression reversal",
  });
  record("accounts-payable", "supplier payment reversal posts", "success=true", responseActual(reverse), reverse.ok && reverse.data?.success === true);

  const reversedState = await documentState(local, "purchase_orders", purchase.orderId);
  const allocations = await selectMany(local, "purchase_payment_allocations", `select=id&purchase_order_id=eq.${purchase.orderId}`);
  record("accounts-payable", "supplier reversal restores AP outstanding", "paid=0,outstanding=500,unpaid,no allocation", `${reversedState.paid_amount},${reversedState.outstanding_amount},${reversedState.payment_status},allocations=${allocations.length}`, near(reversedState.paid_amount, 0) && near(reversedState.outstanding_amount, 500) && reversedState.payment_status === "unpaid" && allocations.length === 0);

  const reverseTwice = await rpc(local, tokens.accountsA, "reverse_payment_voucher", {
    p_journal_entry_id: supplierPayment.data?.journal_entry_id,
    p_reversal_date: today,
    p_reason: "Must fail duplicate reversal",
  });
  const reverseTwiceActual = responseActual(reverseTwice);
  record("accounting", "duplicate supplier-payment reversal rejected", "denied as already reversed", reverseTwiceActual, !reverseTwice.ok && reverseTwiceActual.includes("already been reversed"));

  return purchase;
}

async function testSales(local, fixture, tokens, business) {
  const sale = await createSale(local, fixture, tokens, business, "MAIN");
  const posted = await rpc(local, tokens.salesA, "post_sales_invoice", { p_order_id: sale.orderId });
  record("sales", "valid credit sales invoice posts", "success=true", responseActual(posted), posted.ok && posted.data?.success === true);
  if (!posted.ok || posted.data?.success !== true) return null;

  const state = await documentState(local, "sales_orders", sale.orderId);
  record("sales", "sales total and AR outstanding", "posted,total=400,outstanding=400", `${state.status},${state.total},${state.outstanding_amount}`, state.status === "posted" && near(state.total, 400) && near(state.outstanding_amount, 400));
  const lineSnapshot = await selectOne(local, "sales_order_lines", `select=description,item_name_snapshot,item_unit_snapshot,godown_name_snapshot&id=eq.${sale.lineId}`, "sales line snapshot");
  record("sales", "posted sale preserves line names", "description and item/unit/godown snapshots populated", `${lineSnapshot.description},${lineSnapshot.item_name_snapshot},${lineSnapshot.item_unit_snapshot},${lineSnapshot.godown_name_snapshot}`, lineSnapshot.description === "Synthetic sales line" && Boolean(lineSnapshot.item_name_snapshot) && Boolean(lineSnapshot.item_unit_snapshot) && Boolean(lineSnapshot.godown_name_snapshot));
  const stock = await stockQuantity(local, fixture, business.itemId, business.godownId);
  record("inventory", "sales posting decreases branch stock", "quantity=6", `quantity=${stock}`, near(stock, 6));

  const journal = await selectOne(local, "journal_entries", `select=id,status&company_id=eq.${fixture.companyA}&entry_no=eq.${encodeURIComponent(sale.orderNo)}`, "sales journal");
  const balance = await journalBalance(local, journal.id);
  record("accounting", "sales revenue and COGS journal balances", "balanced debit=credit", `rows=${balance.rows},debit=${balance.debit},credit=${balance.credit}`, balance.rows >= 4 && near(balance.debit, balance.credit) && balance.debit > 400);

  const repeat = await rpc(local, tokens.salesA, "post_sales_invoice", { p_order_id: sale.orderId });
  const stockAfterRepeat = await stockQuantity(local, fixture, business.itemId, business.godownId);
  const journalsAfterRepeat = await selectMany(local, "journal_entries", `select=id&company_id=eq.${fixture.companyA}&entry_no=eq.${encodeURIComponent(sale.orderNo)}`);
  record("sales", "duplicate sales posting is atomic", "denied,one journal,stock unchanged", `${responseActual(repeat)},journals=${journalsAfterRepeat.length},stock=${stockAfterRepeat}`, !repeat.ok && journalsAfterRepeat.length === 1 && near(stockAfterRepeat, 6));

  const patch = await userPatch(local, tokens.salesA, "sales_orders", `id=eq.${sale.orderId}`, { total: 999 });
  const afterPatch = await documentState(local, "sales_orders", sale.orderId);
  record("immutability", "posted sales invoice cannot be edited", "denied or zero rows,total=400", `${responseActual(patch)},total=${afterPatch.total}`, (!patch.ok || patch.data?.length === 0) && near(afterPatch.total, 400));

  const deletion = await userRequest(local, tokens.salesA, "sales_orders", "DELETE", `id=eq.${sale.orderId}`);
  const afterDelete = await selectMany(local, "sales_orders", `select=id&id=eq.${sale.orderId}`);
  record("immutability", "posted sales invoice cannot be deleted", "denied or zero rows,row remains", `${responseActual(deletion)},remaining=${afterDelete.length}`, (!deletion.ok || deletion.data?.length === 0) && afterDelete.length === 1);

  const receipt = await rpc(local, tokens.accountsA, "receive_customer_payment", {
    p_customer_id: fixture.customerA,
    p_payment_date: today,
    p_payment_account_id: business.account.cash,
    p_payment_method: "cash",
    p_reference: "PHASE3-UAT",
    p_description: "Synthetic partial customer receipt",
    p_notes: "Local only",
    p_allocations: [{ sales_order_id: sale.orderId, amount: 150 }],
    p_amount: 150,
  });
  record("accounts-receivable", "partial customer receipt posts", "success=true,payment=150", responseActual(receipt), receipt.ok && receipt.data?.success === true && near(receipt.data?.payment_amount, 150));

  const paidState = await documentState(local, "sales_orders", sale.orderId);
  record("accounts-receivable", "receipt updates AR status", "paid=150,outstanding=250,partial", `${paidState.paid_amount},${paidState.outstanding_amount},${paidState.payment_status}`, near(paidState.paid_amount, 150) && near(paidState.outstanding_amount, 250) && paidState.payment_status === "partial");

  const overpay = await rpc(local, tokens.accountsA, "receive_customer_payment", {
    p_customer_id: fixture.customerA,
    p_payment_date: today,
    p_payment_account_id: business.account.cash,
    p_payment_method: "cash",
    p_reference: "PHASE3-OVERPAY",
    p_description: "Must fail",
    p_notes: "Local only",
    p_allocations: [{ sales_order_id: sale.orderId, amount: 300 }],
    p_amount: 300,
  });
  const overpayActual = responseActual(overpay);
  record("accounts-receivable", "customer over-allocation is rejected", "denied for outstanding-limit violation", overpayActual, !overpay.ok && overpayActual.includes("exceeds outstanding balance"));

  const reverse = await rpc(local, tokens.accountsA, "reverse_payment_voucher", {
    p_journal_entry_id: receipt.data?.journal_entry_id,
    p_reversal_date: today,
    p_reason: "Phase 3 regression reversal",
  });
  record("accounts-receivable", "customer receipt reversal posts", "success=true", responseActual(reverse), reverse.ok && reverse.data?.success === true);

  const reversedState = await documentState(local, "sales_orders", sale.orderId);
  const allocations = await selectMany(local, "invoice_payment_allocations", `select=id&sales_order_id=eq.${sale.orderId}`);
  record("accounts-receivable", "receipt reversal restores AR outstanding", "paid=0,outstanding=400,unpaid,no allocation", `${reversedState.paid_amount},${reversedState.outstanding_amount},${reversedState.payment_status},allocations=${allocations.length}`, near(reversedState.paid_amount, 0) && near(reversedState.outstanding_amount, 400) && reversedState.payment_status === "unpaid" && allocations.length === 0);

  return sale;
}

async function testRoleAndTenantDenials(local, fixture, tokens, business) {
  const sale = await createSale(local, fixture, tokens, business, "FORGED", 1, 100);
  let result = await rpc(local, tokens.tenantB, "post_sales_invoice", { p_order_id: sale.orderId });
  let state = await documentState(local, "sales_orders", sale.orderId);
  record("isolation", "tenant B cannot post company A invoice", "denied,draft unchanged", `${responseActual(result)},status=${state.status}`, !result.ok && state.status === "draft");

  result = await rpc(local, tokens.viewerA, "post_sales_invoice", { p_order_id: sale.orderId });
  state = await documentState(local, "sales_orders", sale.orderId);
  record("permissions", "viewer cannot post sales invoice", "denied,draft unchanged", `${responseActual(result)},status=${state.status}`, !result.ok && state.status === "draft");

  result = await rpc(local, tokens.accountsA, "post_sales_invoice", { p_order_id: sale.orderId });
  state = await documentState(local, "sales_orders", sale.orderId);
  record("permissions", "accounts role cannot post sales invoice", "denied,draft unchanged", `${responseActual(result)},status=${state.status}`, !result.ok && state.status === "draft");

  const purchase = await createPurchase(local, fixture, tokens, business, "FORGED", 1, 50);
  result = await rpc(local, tokens.salesA, "post_purchase_invoice", { p_order_id: purchase.orderId });
  const purchaseState = await documentState(local, "purchase_orders", purchase.orderId);
  record("permissions", "sales role cannot post purchase invoice", "denied,draft unchanged", `${responseActual(result)},status=${purchaseState.status}`, !result.ok && purchaseState.status === "draft");

  result = await rpc(local, tokens.revokedA, "receive_customer_payment", {
    p_customer_id: fixture.customerA,
    p_payment_date: today,
    p_payment_account_id: business.account.cash,
    p_payment_method: "cash",
    p_reference: "PHASE3-REVOKED",
    p_description: "Must fail",
    p_notes: "Local only",
    p_allocations: [],
    p_amount: 10,
  });
  record("permissions", "revoked role cannot create receipt", "denied", responseActual(result), !result.ok);

  result = await asUser(local, null, rpcPath("post_sales_invoice"), { method: "POST", body: { p_order_id: sale.orderId } });
  record("security", "anonymous posting RPC is denied", "HTTP 401/403/404", responseActual(result), !result.ok);
}

async function testReturns(local, fixture, tokens, business, purchase, sale) {
  if (!purchase || !sale) {
    record("returns", "return workflow prerequisites", "posted purchase and sale", "prerequisite posting failed", false);
    return;
  }
  const salesReturn = await rpc(local, tokens.owner, "create_and_post_return_note", {
    p_note_type: "sales_credit",
    p_order_id: sale.orderId,
    p_note_date: today,
    p_reason: "Synthetic sales return",
    p_lines: [{ line_id: sale.lineId, qty: 1 }],
  });
  record("returns", "sales credit note posts atomically", "success=true,total=100", responseActual(salesReturn), salesReturn.ok && salesReturn.data?.success === true && near(salesReturn.data?.total, 100));
  let stock = await stockQuantity(local, fixture, business.itemId, business.godownId);
  let saleState = await documentState(local, "sales_orders", sale.orderId);
  record("returns", "sales return restores stock and reduces AR", "stock=7,outstanding=300", `stock=${stock},outstanding=${saleState.outstanding_amount}`, near(stock, 7) && near(saleState.outstanding_amount, 300));

  const overReturn = await rpc(local, tokens.owner, "create_and_post_return_note", {
    p_note_type: "sales_credit",
    p_order_id: sale.orderId,
    p_note_date: today,
    p_reason: "Must exceed remaining quantity",
    p_lines: [{ line_id: sale.lineId, qty: 4 }],
  });
  stock = await stockQuantity(local, fixture, business.itemId, business.godownId);
  record("returns", "sales over-return is rejected atomically", "denied,stock=7", `${responseActual(overReturn)},stock=${stock}`, !overReturn.ok && near(stock, 7));

  const purchaseReturn = await rpc(local, tokens.owner, "create_and_post_return_note", {
    p_note_type: "purchase_debit",
    p_order_id: purchase.orderId,
    p_note_date: today,
    p_reason: "Synthetic purchase return",
    p_lines: [{ line_id: purchase.lineId, qty: 1 }],
  });
  record("returns", "purchase debit note posts atomically", "success=true,total=50", responseActual(purchaseReturn), purchaseReturn.ok && purchaseReturn.data?.success === true && near(purchaseReturn.data?.total, 50));
  stock = await stockQuantity(local, fixture, business.itemId, business.godownId);
  const purchaseState = await documentState(local, "purchase_orders", purchase.orderId);
  record("returns", "purchase return removes stock and reduces AP", "stock=6,outstanding=450", `stock=${stock},outstanding=${purchaseState.outstanding_amount}`, near(stock, 6) && near(purchaseState.outstanding_amount, 450));
}

async function createJournal(local, fixture, tokens, business, suffix, debit, credit) {
  const entryId = randomUUID();
  const entryNo = `P3-JE-${suffix}-${runTag}`;
  await userInsert(local, tokens.owner, "journal_entries", [{
    ...business.transaction,
    id: entryId,
    entry_no: entryNo,
    entry_date: today,
    description: "Synthetic Phase 3 journal",
    status: "draft",
    trans_type: "Manual Journal",
  }]);
  await userInsert(local, tokens.owner, "journal_lines", [
    { ...business.transaction, entry_id: entryId, account_id: business.account.cash, account: "Cash", debit, credit: 0 },
    { ...business.transaction, entry_id: entryId, account_id: business.account.general_expense, account: "General Expense", debit: 0, credit },
  ]);
  return { entryId, entryNo };
}

async function testManualJournalAndPeriod(local, fixture, tokens, business) {
  const unbalanced = await createJournal(local, fixture, tokens, business, "UNBAL", 25, 20);
  let result = await rpc(local, tokens.owner, "post_journal_entry", { p_entry_id: unbalanced.entryId });
  let state = await documentState(local, "journal_entries", unbalanced.entryId);
  const unbalancedLedgers = await selectMany(local, "ledgers", `select=id&journal_entry_id=eq.${unbalanced.entryId}`);
  record("accounting", "unbalanced journal is rejected atomically", "denied,draft,no ledger", `${responseActual(result)},status=${state.status},ledgers=${unbalancedLedgers.length}`, !result.ok && state.status === "draft" && unbalancedLedgers.length === 0);

  const balanced = await createJournal(local, fixture, tokens, business, "BAL", 25, 25);
  result = await rpc(local, tokens.owner, "post_journal_entry", { p_entry_id: balanced.entryId });
  state = await documentState(local, "journal_entries", balanced.entryId);
  const balance = await journalBalance(local, balanced.entryId);
  record("accounting", "balanced manual journal posts", "success=true,posted,debit=credit=25", `${responseActual(result)},status=${state.status},debit=${balance.debit},credit=${balance.credit}`, result.ok && state.status === "posted" && near(balance.debit, 25) && near(balance.credit, 25));

  const patch = await userPatch(local, tokens.owner, "journal_entries", `id=eq.${balanced.entryId}`, { description: "Must not change" });
  const afterPatch = await documentState(local, "journal_entries", balanced.entryId);
  record("immutability", "posted journal cannot be edited", "denied or zero rows,description unchanged", `${responseActual(patch)},description=${afterPatch.description}`, (!patch.ok || patch.data?.length === 0) && afterPatch.description === "Synthetic Phase 3 journal");

  const reversal = await rpc(local, tokens.owner, "reverse_manual_journal_entry", {
    p_entry_id: balanced.entryId,
    p_reversal_date: today,
    p_reason: "Phase 3 manual journal reversal",
  });
  record("accounting", "manual journal reversal posts", "success=true", responseActual(reversal), reversal.ok && reversal.data?.success === true);
  const reversalBalance = reversal.ok ? await journalBalance(local, reversal.data.reversal_entry_id) : { rows: 0, debit: 0, credit: 1 };
  record("accounting", "manual reversal is balanced", "debit=credit=25", `rows=${reversalBalance.rows},debit=${reversalBalance.debit},credit=${reversalBalance.credit}`, reversalBalance.rows === 2 && near(reversalBalance.debit, 25) && near(reversalBalance.credit, 25));

  const duplicate = await rpc(local, tokens.owner, "reverse_manual_journal_entry", {
    p_entry_id: balanced.entryId,
    p_reversal_date: today,
    p_reason: "Must fail duplicate reversal",
  });
  record("accounting", "duplicate manual reversal rejected", "denied", responseActual(duplicate), !duplicate.ok);

  result = await rpc(local, tokens.owner, "initialize_accounting_year", { p_year: year });
  record("period-control", "accounting year initializes", "success=true", responseActual(result), result.ok && result.data?.success === true);
  const periods = await selectMany(local, "accounting_periods", `select=id,status,period_start,period_end&company_id=eq.${fixture.companyA}&period_start=lte.${today}&period_end=gte.${today}`);
  if (periods.length !== 1) throw new Error(`Expected one accounting period covering ${today}, got ${periods.length}.`);
  const period = periods[0];
  result = await rpc(local, tokens.owner, "set_accounting_period_status", { p_period_id: period.id, p_status: "closed" });
  record("period-control", "current accounting period closes", "success=true,status=closed", responseActual(result), result.ok && result.data?.success === true && result.data?.status === "closed");

  const closedJournal = await createJournal(local, fixture, tokens, business, "CLOSED", 10, 10);
  result = await rpc(local, tokens.owner, "post_journal_entry", { p_entry_id: closedJournal.entryId });
  state = await documentState(local, "journal_entries", closedJournal.entryId);
  record("period-control", "posting into closed period is rejected", "denied,draft", `${responseActual(result)},status=${state.status}`, !result.ok && state.status === "draft");

  const reopened = await rpc(local, tokens.owner, "set_accounting_period_status", { p_period_id: period.id, p_status: "open" });
  record("period-control", "synthetic period is reopened after test", "success=true,status=open", responseActual(reopened), reopened.ok && reopened.data?.success === true && reopened.data?.status === "open");
}

async function main() {
  const local = readLocalStatus();
  const fixture = await provision(local);
  const tokens = {
    owner: await signIn(local, fixture.identities.owner),
    accountsA: await signIn(local, fixture.identities.accountsA),
    salesA: await signIn(local, fixture.identities.salesA),
    viewerA: await signIn(local, fixture.identities.viewerA),
    revokedA: await signIn(local, fixture.identities.revokedA),
    tenantB: await signIn(local, fixture.identities.tenantB),
  };
  const business = await setupBusinessFixture(local, fixture, tokens);
  async function runArea(area, operation) {
    try {
      return await operation();
    } catch (error) {
      record(area, `${area} test area completes`, "no fatal error", sanitizeMessage(error instanceof Error ? error.message : String(error)), false);
      return null;
    }
  }

  const purchase = await runArea("purchase", () => testPurchase(local, fixture, tokens, business));
  const sale = await runArea("sales", () => testSales(local, fixture, tokens, business));
  await runArea("role-and-tenant-denials", () => testRoleAndTenantDenials(local, fixture, tokens, business));
  await runArea("returns", () => testReturns(local, fixture, tokens, business, purchase, sale));
  await runArea("manual-journal-and-period", () => testManualJournalAndPeriod(local, fixture, tokens, business));

  const failed = evidence.filter((item) => !item.pass);
  console.log(JSON.stringify({
    environment: "local-only",
    production_ref_refused: productionRef,
    synthetic_data_only: true,
    tested_date: today,
    scope: ["sales", "purchase", "inventory", "AR", "AP", "journals", "returns", "reversals", "immutability", "period-control", "role-and-tenant-denials"],
    summary: { total: evidence.length, passed: evidence.length - failed.length, failed: failed.length },
    evidence,
  }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    environment: "local-only",
    production_ref_refused: productionRef,
    synthetic_data_only: true,
    fatal: sanitizeMessage(error instanceof Error ? error.message : String(error)),
    completed_assertions: evidence.length,
    evidence,
  }, null, 2));
  process.exitCode = 1;
});
