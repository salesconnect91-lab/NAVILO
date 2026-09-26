import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = path.resolve(process.cwd(), "src");
const listScreens = [
  "modules/master-data/Items.tsx",
  "modules/master-data/Categories.tsx",
  "modules/master-data/Customers.tsx",
  "modules/master-data/Suppliers.tsx",
  "modules/master-data/Employees.tsx",
  "modules/master-data/Warehouses.tsx",
  "modules/master-data/Godown.tsx",
  "modules/master-data/Uom.tsx",
  "modules/master-data/Transporters.tsx",
  "modules/sales/ChargeMaster.tsx",
];

describe("Master Data NEUS real coverage", () => {
  for (const file of listScreens) {
    it(`${file} uses the shared NEUS DataTable and search`, () => {
      const source = fs.readFileSync(path.join(src, file), "utf8");
      expect(source).toMatch(/search/i);
      expect(source).toMatch(/<DataTable(?:<|\s)/);
      expect(source).not.toMatch(/navigate\(\s*["']\/dashboard["']/);
    });
  }

  it("shared DataTable exposes the frozen core NEUS controls", () => {
    const source = fs.readFileSync(path.join(src, "components/DataTable.tsx"), "utf8");
    for (const contract of [
      "Select all rows on page", "draggable", "beginResize", "Pin L", "Pin R",
      "Select All", "Clear All", "Save View", "Reset Default",
      "Compact", "Comfortable", "Spacious", "25,50,100,250",
      "First", "Previous", "Next", "Last", "data-no-print", "data-no-export",
      "multi-column sort", "role=\"separator\"", "data-navilo-bulk-actions", "bulkActions",
      "preferenceScope", "Move ${column.label} left", "Move ${column.label} right",
    ]) expect(source).toContain(contract);
  });

  it("scopes persistent NEUS preferences to authenticated tenant context", () => {
    const source = fs.readFileSync(path.join(src, "components/DataTable.tsx"), "utf8");
    expect(source).toContain("useAuth()");
    expect(source).toContain("user?.id");
    expect(source).toContain("activeCompany?.company_id");
    expect(source).toContain("activeBusinessUnit?.business_unit_id");
    expect(source).toContain("resolvedPreferenceScope");
  });

  it("does not leave always-visible Urdu columns in single-language master tables", () => {
    for (const file of ["modules/master-data/Items.tsx","modules/master-data/Categories.tsx","modules/master-data/Employees.tsx","modules/master-data/Warehouses.tsx","modules/master-data/Uom.tsx","modules/master-data/Transporters.tsx","modules/sales/ChargeMaster.tsx"]) {
      const source = fs.readFileSync(path.join(src, file), "utf8");
      expect(source).not.toMatch(/\{key:"(?:name_urdu|charge_name_urdu)",label:"Urdu Name",render:[^}]+showUrdu\?/);
    }
  });

  it("does not duplicate centralized Import Center controls", () => {
    for (const file of listScreens) {
      const source = fs.readFileSync(path.join(src, file), "utf8");
      expect(source.match(/>Import Center</g)?.length ?? 0).toBe(0);
    }
  });
  it("locks accurate centralized export scopes and print isolation", () => {
    const table = fs.readFileSync(path.join(src, "components/DataTable.tsx"), "utf8");
    const tools = fs.readFileSync(path.join(src, "components/UniversalDataTools.tsx"), "utf8");
    const exports = fs.readFileSync(path.join(src, "lib/exportUtils.ts"), "utf8");
    expect(table).toContain('data-navilo-export-table={scope}');
    expect(table).toContain('exportTable("filtered", sortedRows)');
    expect(table).toContain('exportTable("selected", selectedRows)');
    expect(tools).toContain('Excel — Current Page');
    expect(tools).toContain('CSV — Current Page');
    expect(tools).toContain('Excel — Filtered');
    expect(tools).toContain('Excel — Selected');
    expect(tools).toContain('triggerPrint(reportSelector())');
    expect(exports).toContain('[data-navilo-export-snapshots]');
  });

  it("keeps master row mutations permission-aware", () => {
    for (const file of listScreens) {
      const source = fs.readFileSync(path.join(src, file), "utf8");
      expect(source).toMatch(/can(Create|Edit|Delete)|canPerformModule|hasPermission/);
    }
  });

  it("keeps explicit filter clearing on every master list", () => {
    for (const file of listScreens) {
      const source = fs.readFileSync(path.join(src, file), "utf8");
      expect(source).toMatch(/Clear(?: Filters)?|resetFilter|clearFilter/i);
    }
  });

  it("keeps Urdu persistence isolated to the active language configuration", () => {
    for (const file of ["modules/master-data/Customers.tsx","modules/master-data/Suppliers.tsx","modules/master-data/Transporters.tsx","modules/sales/ChargeMaster.tsx"]) {
      const source = fs.readFileSync(path.join(src, file), "utf8");
      expect(source).toContain("showUrdu");
      expect(source).toMatch(/showUrdu\s*\?/);
    }
  });

  it("marks every Master Data screen with an explicit print surface", () => {
    for (const file of listScreens) {
      const source = fs.readFileSync(path.join(src, file), "utf8");
      expect(source).toMatch(/data-navilo-print-surface|data-report-content/);
    }
  });

});
