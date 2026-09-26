// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import UniversalDataTools from "./UniversalDataTools";

vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ isPlatformOwner: true, activeCompany: null, activeBusinessUnit: null }) }));
vi.mock("@/components/ConsolidatedInvoiceTools", () => ({ default: () => null }));
afterEach(cleanup);

describe("contextual output actions", () => {
  it("does not place generic export/print on a cash-entry screen or hide its local actions", () => {
    render(<MemoryRouter initialEntries={["/accounting/cash-counter"]}><main id="navilo-main-content"><button type="button">Print receipt</button></main><UniversalDataTools /></MemoryRouter>);
    expect(document.querySelector("[data-navilo-global-data-tools]")).toBeNull();
    expect(screen.getByRole("button", { name: "Print receipt" }).style.display).not.toBe("none");
  });

  it("centralizes invoice-list outputs and suppresses duplicate local import actions", async () => {
    render(<MemoryRouter initialEntries={["/sales"]}><main id="navilo-main-content"><span data-navilo-standard-tools-host /><div data-report-content data-navilo-customizable="true"><button type="button">Bulk Upload (CSV)</button></div></main><UniversalDataTools /></MemoryRouter>);
    expect(document.querySelector("[data-navilo-global-data-tools]")).not.toBeNull();
    const duplicateImport = document.querySelector<HTMLButtonElement>(
      '[data-navilo-duplicate-global-action="true"]'
    );
    expect(duplicateImport).not.toBeNull();
    expect(duplicateImport?.textContent).toContain("Bulk Upload (CSV)");
    expect(duplicateImport?.style.display).toBe("none");
  });
});
