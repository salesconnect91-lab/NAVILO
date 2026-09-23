#!/usr/bin/env node

// Local-only NAVILO Phase 2B fixture provisioner and authorization test runner.
// It obtains local keys from `supabase status -o env`, keeps generated passwords
// in memory, refuses hosted endpoints, and prints no credentials or user emails.

import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const productionRef = "ijdaosaqpbgnqojudjbj";

function readLocalStatus() {
  const isWindows = process.platform === "win32";
  const executable = isWindows
    ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe")
    : "npx";
  const args = isWindows
    ? ["/d", "/s", "/c", "npx supabase status -o env"]
    : ["supabase", "status", "-o", "env"];
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
  });
  if (result.error) {
    throw new Error(`Unable to launch the local Supabase CLI (${result.error.code ?? "process error"}).`);
  }
  if (result.status !== 0) {
    const notRunning = /supabase start is not running/i.test(result.stderr ?? "");
    throw new Error(notRunning
      ? "Local Supabase is not running. Start it from this repository first."
      : `Local Supabase status failed with exit ${result.status}. Run npx supabase status in this repository for diagnostics.`);
  }
  const values = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  const url = values.API_URL ?? values.SUPABASE_URL;
  const publicKey = values.ANON_KEY ?? values.PUBLISHABLE_KEY;
  const secretKey = values.SERVICE_ROLE_KEY ?? values.SECRET_KEY;
  if (!url || !publicKey || !secretKey) {
    throw new Error("Supabase local status did not provide API, publishable/anon and secret/service-role values.");
  }
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.port !== "54321") {
    throw new Error("Refusing non-local Supabase endpoint. This runner only accepts localhost:54321.");
  }
  if (url.includes(productionRef)) throw new Error("Production Supabase is explicitly refused.");
  return { url: parsed.origin, publicKey, secretKey };
}

async function requestJson(url, path, apiKey, bearer, options = {}) {
  const response = await fetch(`${url}${path}`, {
    method: options.method ?? "GET",
    headers: {
      apikey: apiKey,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = raw; }
  }
  return { ok: response.ok, status: response.status, data };
}

function requireOk(result, operation) {
  if (!result.ok) {
    const code = typeof result.data === "object" && result.data ? result.data.code : null;
    const rawMessage = typeof result.data === "object" && result.data
      ? result.data.message
      : null;
    const message = typeof rawMessage === "string"
      ? rawMessage.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[synthetic-email-redacted]")
      : null;
    const detail = [code, message].filter(Boolean).join(": ");
    throw new Error(`${operation} failed with HTTP ${result.status}${detail ? ` (${detail})` : ""}.`);
  }
  return result.data;
}

async function createIdentity(local, label, runId) {
  const password = `N!${randomBytes(24).toString("base64url")}9a`;
  const response = await requestJson(local.url, "/auth/v1/admin/users", local.secretKey, local.secretKey, {
    method: "POST",
    body: {
      email: `phase2b-${label}-${runId}@example.invalid`,
      password,
      email_confirm: true,
      user_metadata: { synthetic_phase2b: true, test_role: label },
    },
  });
  const user = requireOk(response, `create ${label} identity`);
  if (!user?.id) throw new Error(`Auth did not return an id for ${label}.`);
  return { id: user.id, email: user.email, password };
}

async function serviceInsert(local, table, rows) {
  const result = await requestJson(local.url, `/rest/v1/${table}`, local.secretKey, local.secretKey, {
    method: "POST",
    body: rows,
    prefer: "return=representation",
  });
  return requireOk(result, `insert ${table}`);
}

async function serviceUpsert(local, table, rows, onConflict) {
  const conflict = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
  const result = await requestJson(local.url, `/rest/v1/${table}${conflict}`, local.secretKey, local.secretKey, {
    method: "POST",
    body: rows,
    prefer: "return=representation,resolution=merge-duplicates",
  });
  return requireOk(result, `upsert ${table}`);
}

async function serviceSelect(local, table, query) {
  const result = await requestJson(local.url, `/rest/v1/${table}?${query}`, local.secretKey, local.secretKey);
  return requireOk(result, `select ${table}`);
}

async function signIn(local, identity) {
  const result = await requestJson(
    local.url,
    "/auth/v1/token?grant_type=password",
    local.publicKey,
    null,
    { method: "POST", body: { email: identity.email, password: identity.password } },
  );
  const session = requireOk(result, "synthetic sign-in");
  if (!session?.access_token) throw new Error("Auth sign-in did not return an access token.");
  return session.access_token;
}

async function asUser(local, token, path, options = {}) {
  return requestJson(local.url, path, local.publicKey, token, options);
}

function rowQuery(table, id) {
  return `/rest/v1/${table}?select=id&id=eq.${encodeURIComponent(id)}`;
}

function rpcPath(name) {
  return `/rest/v1/rpc/${name}`;
}

const evidence = [];
function record(role, test, expected, result, pass, successValue) {
  const actual = result.ok
    ? successValue ?? (Array.isArray(result.data) ? `ROWS:${result.data.length}` : `VALUE:${JSON.stringify(result.data)}`)
    : `DENIED:HTTP_${result.status}`;
  evidence.push({ role, test, expected, actual, pass: Boolean(pass) });
}

async function provision(local) {
  const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const labels = ["owner", "accountsA", "salesA", "viewerA", "revokedA", "tenantB"];
  const identities = {};
  for (const label of labels) identities[label] = await createIdentity(local, label.toLowerCase(), runId);

  await serviceInsert(local, "user_profiles", [{
    id: identities.owner.id,
    user_id: identities.owner.id,
    role: "admin",
    is_active: true,
    platform_role: "super_admin",
    full_name: "Phase2B Synthetic Owner",
    email: identities.owner.email,
  }]);

  const companyA = randomUUID();
  const companyB = randomUUID();
  await serviceInsert(local, "companies", [
    { id: companyA, name: "PHASE2B-A", code: `P2A-${runId}`, status: "active", created_by: identities.owner.id },
    { id: companyB, name: "PHASE2B-B", code: `P2B-${runId}`, status: "active", created_by: identities.owner.id },
  ]);

  const defaultsA = await serviceSelect(local, "business_units", `select=id&company_id=eq.${companyA}&is_default=eq.true`);
  const defaultsB = await serviceSelect(local, "business_units", `select=id&company_id=eq.${companyB}&is_default=eq.true`);
  if (defaultsA.length !== 1 || defaultsB.length !== 1) throw new Error("Expected one default business unit per synthetic company.");
  const businessUnitA1 = defaultsA[0].id;
  const businessUnitB1 = defaultsB[0].id;
  const businessUnitA2 = randomUUID();
  const businessUnitB2 = randomUUID();
  await serviceInsert(local, "business_units", [
    { id: businessUnitA2, company_id: companyA, code: "SECOND", name: "Second Unit", unit_type: "custom", is_active: true, is_default: false },
    { id: businessUnitB2, company_id: companyB, code: "SECOND", name: "Second Unit", unit_type: "custom", is_active: true, is_default: false },
  ]);

  const branchA1 = randomUUID();
  const branchA2 = randomUUID();
  const branchB1 = randomUUID();
  const branchB2 = randomUUID();
  await serviceInsert(local, "operating_locations", [
    { id: branchA1, company_id: companyA, business_unit_id: businessUnitA1, code: "A1", name: "A Branch 1", location_type: "branch" },
    { id: branchA2, company_id: companyA, business_unit_id: businessUnitA2, code: "A2", name: "A Branch 2", location_type: "branch" },
    { id: branchB1, company_id: companyB, business_unit_id: businessUnitB1, code: "B1", name: "B Branch 1", location_type: "branch" },
    { id: branchB2, company_id: companyB, business_unit_id: businessUnitB2, code: "B2", name: "B Branch 2", location_type: "branch" },
  ]);

  const profileRows = [
    ["accountsA", "accountant", companyA, businessUnitA1, branchA1],
    ["salesA", "sales", companyA, businessUnitA1, branchA1],
    ["viewerA", "viewer", companyA, businessUnitA1, branchA1],
    ["revokedA", "viewer", companyA, businessUnitA1, branchA1],
    ["tenantB", "sales", companyB, businessUnitB1, branchB1],
  ].map(([label, role, company, unit, branch]) => ({
    id: identities[label].id,
    user_id: identities[label].id,
    role,
    is_active: true,
    platform_role: "user",
    full_name: `Phase2B Synthetic ${label}`,
    email: identities[label].email,
    last_company_id: company,
    last_business_unit_id: unit,
    locked_business_unit_id: unit,
    locked_operating_location_id: branch,
  }));
  await serviceInsert(local, "user_profiles", profileRows);

  await serviceInsert(local, "company_memberships", [
    { company_id: companyA, user_id: identities.accountsA.id, role: "accounts", is_active: true },
    { company_id: companyA, user_id: identities.salesA.id, role: "sales", is_active: true },
    { company_id: companyA, user_id: identities.viewerA.id, role: "viewer", is_active: true },
    { company_id: companyA, user_id: identities.revokedA.id, role: "viewer", is_active: false },
    { company_id: companyB, user_id: identities.tenantB.id, role: "sales", is_active: true },
  ]);

  const memberships = [
    [companyA, businessUnitA1, branchA1, "accountsA", "accounts", true],
    [companyA, businessUnitA1, branchA1, "salesA", "sales", true],
    [companyA, businessUnitA1, branchA1, "viewerA", "viewer", true],
    [companyA, businessUnitA1, branchA1, "revokedA", "viewer", false],
    [companyB, businessUnitB1, branchB1, "tenantB", "sales", true],
  ];
  await serviceUpsert(
    local,
    "business_unit_memberships",
    memberships.map(([company, unit, , label, role, active]) => ({
      company_id: company, business_unit_id: unit, user_id: identities[label].id, role, is_active: active,
    })),
    "business_unit_id,user_id",
  );
  await serviceInsert(local, "operating_location_memberships", memberships.map(([company, unit, branch, label, role, active]) => ({
    company_id: company, business_unit_id: unit, operating_location_id: branch,
    user_id: identities[label].id, role, is_active: active,
  })));

  const modules = ["dashboard", "master", "sales", "purchase", "inventory", "production", "accounting", "reports", "settings"];
  await serviceUpsert(
    local,
    "company_modules",
    [companyA, companyB].flatMap((company_id) => modules.map((module_key) => ({ company_id, module_key, enabled: true }))),
    "company_id,module_key",
  );
  await serviceUpsert(local, "business_unit_modules", [
    [companyA, businessUnitA1], [companyA, businessUnitA2], [companyB, businessUnitB1], [companyB, businessUnitB2],
  ].flatMap(([company_id, business_unit_id]) => modules.map((module_key) => ({ company_id, business_unit_id, module_key, enabled: true }))), "business_unit_id,module_key");

  const customerA = randomUUID();
  const customerB = randomUUID();
  await serviceInsert(local, "customers", [
    { id: customerA, user_id: identities.accountsA.id, company_id: companyA, name: "PHASE2B Customer A" },
    { id: customerB, user_id: identities.tenantB.id, company_id: companyB, name: "PHASE2B Customer B" },
  ]);

  return {
    identities, companyA, companyB, businessUnitA1, businessUnitA2, businessUnitB1, businessUnitB2,
    branchA1, branchA2, branchB1, branchB2, customerA, customerB,
  };
}

async function runTests(local, fixture) {
  const activeRoles = ["accountsA", "salesA", "viewerA", "tenantB"];
  for (const role of activeRoles) {
    const isTenantB = role === "tenantB";
    const token = await signIn(local, fixture.identities[role]);
    const ownCompany = isTenantB ? fixture.companyB : fixture.companyA;
    const foreignCompany = isTenantB ? fixture.companyA : fixture.companyB;
    const foreignUnit = isTenantB ? fixture.businessUnitA1 : fixture.businessUnitB1;
    const inaccessibleOwnCompanyUnit = isTenantB ? fixture.businessUnitB2 : fixture.businessUnitA2;
    const inaccessibleOwnCompanyBranch = isTenantB ? fixture.branchB2 : fixture.branchA2;
    const foreignCustomer = isTenantB ? fixture.customerA : fixture.customerB;

    let result = await asUser(local, token, rpcPath("has_company_access"), { method: "POST", body: { p_company_id: ownCompany } });
    record(role, "own company positive control", "VALUE:true", result, result.ok && result.data === true);

    result = await asUser(local, token, rpcPath("has_module_permission"), { method: "POST", body: { p_company_id: ownCompany, p_module: "reports", p_action: "view" } });
    record(role, "own reports permission positive control", "VALUE:true", result, result.ok && result.data === true);

    result = await asUser(local, token, rowQuery("companies", foreignCompany));
    record(role, "foreign company row", "ROWS:0 or denied", result, !result.ok || result.data?.length === 0);

    result = await asUser(local, token, rowQuery("customers", foreignCustomer));
    record(role, "foreign customer row", "ROWS:0 or denied", result, !result.ok || result.data?.length === 0);

    result = await asUser(local, token, rpcPath("has_company_access"), { method: "POST", body: { p_company_id: foreignCompany } });
    record(role, "foreign company helper", "VALUE:false or denied", result, !result.ok || result.data === false);

    result = await asUser(local, token, rpcPath("has_module_permission"), { method: "POST", body: { p_company_id: foreignCompany, p_module: "sales", p_action: "post" } });
    record(role, "foreign company module permission", "VALUE:false or denied", result, !result.ok || result.data === false);

    result = await asUser(local, token, rpcPath("set_current_business_unit"), { method: "POST", body: { p_business_unit_id: inaccessibleOwnCompanyUnit } });
    record(role, "unassigned same-company business unit", "DENIED", result, !result.ok);

    result = await asUser(local, token, rpcPath("set_current_operating_location"), { method: "POST", body: { p_location_id: inaccessibleOwnCompanyBranch } });
    record(role, "unassigned same-company branch", "DENIED", result, !result.ok);

    result = await asUser(local, token, rpcPath("assign_user_to_business_unit"), {
      method: "POST",
      body: { p_business_unit_id: foreignUnit, p_user_id: fixture.identities[role].id, p_role: "admin", p_is_active: true },
    });
    record(role, "owner-only assignment with forged unit", "DENIED", result, !result.ok);
  }

  const viewerToken = await signIn(local, fixture.identities.viewerA);
  let result = await asUser(local, viewerToken, rpcPath("has_module_permission"), {
    method: "POST", body: { p_company_id: fixture.companyA, p_module: "sales", p_action: "post" },
  });
  record("viewerA", "viewer sales post permission", "VALUE:false or denied", result, !result.ok || result.data === false);

  const revokedToken = await signIn(local, fixture.identities.revokedA);
  result = await asUser(local, revokedToken, rpcPath("has_company_access"), {
    method: "POST", body: { p_company_id: fixture.companyA },
  });
  record("revokedA", "revoked company access", "VALUE:false or denied", result, !result.ok || result.data === false);
  result = await asUser(local, revokedToken, rowQuery("customers", fixture.customerA));
  record("revokedA", "revoked customer access", "ROWS:0 or denied", result, !result.ok || result.data?.length === 0);

  const ownerToken = await signIn(local, fixture.identities.owner);
  result = await asUser(local, ownerToken, rpcPath("is_platform_owner"), { method: "POST", body: {} });
  record("owner", "platform owner positive control", "VALUE:true", result, result.ok && result.data === true);

  result = await requestJson(local.url, rpcPath("has_company_access"), local.publicKey, null, {
    method: "POST", body: { p_company_id: fixture.companyA },
  });
  record("anonymous", "authenticated-only helper grant", "DENIED", result, !result.ok);
}

const local = readLocalStatus();
const fixture = await provision(local);
await runTests(local, fixture);
const failed = evidence.filter((item) => !item.pass);
console.log(JSON.stringify({
  environment: "local-only",
  production_ref_refused: productionRef,
  synthetic_topology: { companies: 2, business_units_per_company: 2, branches_per_company: 2, authenticated_identities: 6 },
  summary: { total: evidence.length, passed: evidence.length - failed.length, failed: failed.length },
  evidence,
}, null, 2));
if (failed.length) process.exitCode = 1;
