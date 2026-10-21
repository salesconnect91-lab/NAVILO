#!/usr/bin/env node
// Local-only NAVILO launch acceptance. Never uses production data or endpoints.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readLocalStatus, productionRef } from "./phase2b_local_security_tests.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
export const SUITES = [
  ["onboarding", "supabase/tests/onboarding_default_unit_rehearsal.sql"],
  ["sales_purchase_vat", "supabase/tests/tax_posting_reconciliation_rehearsal.sql"],
  ["purchase_returns", "supabase/tests/phase2_acc006_purchase_return_cost_rehearsal.sql"],
  ["journal_permissions", "supabase/tests/journal_feature_authorization_rehearsal.sql"],
  ["transport_import", "supabase/tests/transport_bulk_settlement_import_rehearsal.sql"],
  ["transport_reports", "supabase/tests/transport_party_reporting_rehearsal.sql"],
];

export function assertLocalDbUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error("Invalid local Supabase DB URL."); }
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)
      || !["127.0.0.1", "localhost"].includes(parsed.hostname)
      || parsed.port !== "54322" || parsed.pathname !== "/postgres"
      || parsed.search || parsed.hash || value.includes(productionRef)) {
    throw new Error("Refusing non-local PostgreSQL endpoint; only local Supabase localhost:54322/postgres is accepted.");
  }
  return { host: parsed.hostname, port: parsed.port, database: "postgres",
           username: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password) };
}

export function assertSafeRehearsal(contents, name) {
  const sql = contents.replace(/^\uFEFF/, "");
  if (!/(?:^|\n)\s*begin\s*;/i.test(sql) || !/(?:^|\n)\s*rollback\s*;\s*$/i.test(sql)
      || /(?:^|\n)\s*commit\s*;/i.test(sql)
      || /(?:^|\n)\s*\\(?:i|include|connect|copy|!|gexec)(?:\s|$)/im.test(sql)) {
    throw new Error("Refusing non-rollback or meta-command SQL rehearsal: " + name);
  }
  return true;
}

function localDbUrl() {
  const windows = process.platform === "win32";
  const program = windows ? (process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe") : "npx";
  const args = windows ? ["/d", "/s", "/c", "npx supabase status -o env"] : ["supabase", "status", "-o", "env"];
  const result = spawnSync(program, args, { cwd: root, encoding: "utf8", shell: false, timeout: 30000 });
  if (result.error || result.status !== 0) throw new Error("Local Supabase status failed; start the local stack first.");
  const line = (result.stdout || "").split(/\r?\n/).find(x => x.startsWith("DB_URL="));
  if (!line) throw new Error("Local Supabase status did not return DB_URL.");
  return assertLocalDbUrl(line.slice(7).trim().replace(/^['"]|['"]$/g, ""));
}

export function runLocalLaunchAcceptance() {
  readLocalStatus(); // Validates that the API is localhost:54321, not hosted.
  const db = localDbUrl();
  const results = [];
  const env = { ...process.env, PGHOST: db.host, PGPORT: db.port,
                PGDATABASE: db.database, PGUSER: db.username, PGPASSWORD: db.password,
                PGCONNECT_TIMEOUT: "8", PGAPPNAME: "navilo_local_acceptance" };
  for (const [name, file] of SUITES) {
    const full = resolve(root, file);
    assertSafeRehearsal(readFileSync(full, "utf8"), file);
    const task = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-f", full], {
      env, cwd: root, encoding: "utf8", shell: false, timeout: 120000, maxBuffer: 5 * 1024 * 1024,
    });
    results.push({ suite: name, passed: task.status === 0 && !task.error && !task.signal,
                   error: task.status === 0 && !task.error && !task.signal ? null
                     : task.error ? "psql unavailable" : task.signal ? "timeout/terminated" : "SQL exit " + task.status });
  }
  const fail = results.filter(x => !x.passed).length;
  return { environment: "localhost-only", production_ref_refused: productionRef,
           summary: { total: results.length, passed: results.length - fail, failed: fail }, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = runLocalLaunchAcceptance();
    console.log(JSON.stringify(report, null, 2));
    if (report.summary.failed) process.exitCode = 1;
  } catch (error) {
    console.error("Local launch acceptance unavailable: " + (error?.message || "Unknown error"));
    process.exitCode = 1;
  }
}
