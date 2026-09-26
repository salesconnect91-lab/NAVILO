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
    ]) expect(source).toContain(contract);
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
});
