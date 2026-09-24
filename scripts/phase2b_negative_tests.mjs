// Isolated NAVILO authorization probe. No service-role key is used.
// All IDs and users must be synthetic and provisioned in a separate project.
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

const productionRef = "ijdaosaqpbgnqojudjbj";
const ref = process.env.NAVILO_ISOLATED_PROJECT_REF;
const url = process.env.NAVILO_ISOLATED_SUPABASE_URL;
const anonKey = process.env.NAVILO_ISOLATED_ANON_KEY;
const fixturePath = process.env.NAVILO_ISOLATED_FIXTURES;
const usersRaw = process.env.NAVILO_ISOLATED_TEST_USERS_JSON;
if (!ref || ref === productionRef || !/^[a-z0-9]{20}$/.test(ref)) {
  throw new Error("A separate nonproduction project ref is required. Production ref is refused.");
}
if (!url || new URL(url).hostname !== `${ref}.supabase.co`) {
  throw new Error("Test URL must match the isolated project ref exactly.");
}
if (!anonKey || !fixturePath || !usersRaw) {
  throw new Error("Isolated anon key, synthetic fixture file and test users are required.");
}

const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const users = JSON.parse(usersRaw); // {accountsA:{email,password},salesA,...}; never log
const roles = ["accountsA", "salesA", "viewerA", "revokedA", "tenantB"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
for (const key of ["companyA", "companyB", "businessUnitA", "businessUnitB", "branchA", "branchB", "customerA", "customerB"]) {
  if (!uuid.test(fixture[key] ?? "")) throw new Error(`Missing synthetic UUID: ${key}`);
}
const results = [];
async function run(role, test, request, accepts) {
  const { data, error } = await request();
  const actual = error ? `DENIED:${error.code ?? "error"}` : Array.isArray(data) ? `ROWS:${data.length}` : `VALUE:${JSON.stringify(data)}`;
  results.push({ role, test, expected: "DENIED or no foreign rows", actual, pass: accepts(data, error) });
}
for (const role of roles) {
  if (!users[role]?.email || !users[role]?.password) throw new Error(`Missing secure test identity: ${role}`);
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await client.auth.signInWithPassword(users[role]);
  if (login.error || !login.data.user) throw new Error(`Authentication failed for test role ${role}`);
  const foreignCompany = role === "tenantB" ? fixture.companyA : fixture.companyB;
  const foreignBusinessUnit = role === "tenantB" ? fixture.businessUnitA : fixture.businessUnitB;
  const foreignBranch = role === "tenantB" ? fixture.branchA : fixture.branchB;
  const foreignCustomer = role === "tenantB" ? fixture.customerA : fixture.customerB;
  await run(role, "foreign company membership", () => client.from("companies").select("id").eq("id", foreignCompany), (d, e) => !!e || d?.length === 0);
  await run(role, "foreign customer row", () => client.from("customers").select("id").eq("id", foreignCustomer), (d, e) => !!e || d?.length === 0);
  await run(role, "foreign company access helper", () => client.rpc("has_company_access", { p_company_id: foreignCompany }), (d, e) => !!e || d === false);
  await run(role, "foreign company module permission", () => client.rpc("has_module_permission", { p_company_id: foreignCompany, p_module: "sales", p_action: "post" }), (d, e) => !!e || d === false);
  await run(role, "foreign business unit row", () => client.from("business_units").select("id").eq("id", foreignBusinessUnit), (d, e) => !!e || d?.length === 0);
  await run(role, "foreign branch row", () => client.from("operating_locations").select("id").eq("id", foreignBranch), (d, e) => !!e || d?.length === 0);
  await run(role, "owner-only assignment with forged BU", () => client.rpc("assign_user_to_business_unit", { p_business_unit_id: foreignBusinessUnit, p_user_id: login.data.user.id, p_role: "admin", p_is_active: true }), (d, e) => !!e);
  if (role === "revokedA") {
    await run(role, "revoked access to former company", () => client.rpc("has_company_access", { p_company_id: fixture.companyA }), (d, e) => !!e || d === false);
    await run(role, "revoked access to former customer", () => client.from("customers").select("id").eq("id", fixture.customerA), (d, e) => !!e || d?.length === 0);
  }
  if (role === "viewerA") {
    await run(role, "viewer sales post permission", () => client.rpc("has_module_permission", { p_company_id: fixture.companyA, p_module: "sales", p_action: "post" }), (d, e) => !!e || d === false);
  }
  await client.auth.signOut();
}
if (!users.owner?.email || !users.owner?.password) throw new Error("Missing secure owner test identity");
const ownerClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const ownerLogin = await ownerClient.auth.signInWithPassword(users.owner);
if (ownerLogin.error || !ownerLogin.data.user) throw new Error("Authentication failed for isolated owner role");
const ownerResult = await ownerClient.rpc("is_platform_owner");
results.push({ role: "owner", test: "isolated owner identity", expected: "VALUE:true", actual: ownerResult.error ? `DENIED:${ownerResult.error.code ?? "error"}` : `VALUE:${JSON.stringify(ownerResult.data)}`, pass: !ownerResult.error && ownerResult.data === true });
await ownerClient.auth.signOut();
console.log(JSON.stringify({ project_ref: ref, evidence: results }, null, 2));
if (results.some((result) => !result.pass)) process.exitCode = 1;
