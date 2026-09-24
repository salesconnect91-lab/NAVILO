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

  it("preserves local invoice-list import actions", () => {
    render(<MemoryRouter initialEntries={["/sales"]}><main id="navilo-main-content"><button type="button">Bulk Upload (CSV)</button></main><UniversalDataTools /></MemoryRouter>);
    expect(document.querySelector("[data-navilo-global-data-tools]")).toBeNull();
    expect(screen.getByRole("button", { name: "Bulk Upload (CSV)" }).style.display).not.toBe("none");
  });
});
