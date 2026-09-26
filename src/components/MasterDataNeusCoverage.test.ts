import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "src/modules/master-data");
const listScreens = [
  "Customers.tsx","Suppliers.tsx","Godown.tsx","Categories.tsx","Employees.tsx",
  "Items.tsx","Transporters.tsx","Uom.tsx","Warehouses.tsx",
];

describe("Master Data NEUS coverage", () => {
  for (const file of listScreens) {
    it(`${file} exposes search and a NEUS-capable grid`, () => {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source).toMatch(/search/i);
      expect(source).toMatch(/DataTable|data-neus-grid="true"|data-navilo-customizable="true"/);
    });
  }
  it("does not duplicate centralized Import Center controls", () => {
    for (const file of listScreens) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source.match(/>Import Center</g)?.length ?? 0).toBe(0);
    }
  });
});