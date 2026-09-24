// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Reports from "./Reports";
import ReportSurface from "@/components/reports/ReportSurface";

vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({
  user: { id: "synthetic-user" }, isPlatformOwner: true,
  activeCompany: { company_id: "synthetic-company" }, activeBusinessUnit: { business_unit_id: "synthetic-unit" },
}) }));
vi.mock("@/lib/documentPrintSettings", () => ({ loadDocumentPrintSettings: async () => ({}) }));
vi.mock("@/lib/exportUtils", () => ({
  exportDomReportToExcel: vi.fn(), exportDomReportToCSV: vi.fn(), triggerPrint: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { from: (table:string) => {
  const result = table === "customers" ? { data: [{ name: "Synthetic Customer" }], error: null } :
    { data: [{ id: "row-1", invoice_no: "INV-1", invoice_date: "2026-09-24", customer_name: "Synthetic Customer", net_sales_amount: 100 }], error: null };
  const query = { select: () => query, limit: () => query, eq: () => query, order: async () => result };
  return query;
} } }));

const showReport = () => render(<MemoryRouter initialEntries={["/reports/sales-margin"]}><ReportSurface><Reports /></ReportSurface></MemoryRouter>);
beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("generic report workspace", () => {
  it("keeps filters and primary actions compact and exposes only real output actions", async () => {
    showReport();
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Accounting method" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Customise" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save As" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print report" })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Email report unavailable" }).disabled).toBe(true);
    await waitFor(() => expect(screen.getByRole("columnheader", { name: "Customer" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Column grouping" }));
    fireEvent.click(screen.getByRole("option", { name: "Party" }));
    expect(screen.getByText("Party: Synthetic Customer (1)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export report" }));
    expect(screen.getByRole("button", { name: "Excel" })).toBeTruthy();
  });

  it("saves named filters only for the current synthetic user, company and unit", async () => {
    showReport();
    await waitFor(() => expect(screen.getByRole("columnheader", { name: "Customer" })).toBeTruthy());
    fireEvent.change(screen.getByRole("textbox", { name: "Search report" }), { target: { value: "Synthetic" } });
    fireEvent.click(screen.getByRole("button", { name: "Save As" }));
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), { target: { value: "My sales view" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    const value = localStorage.getItem("navilo:report-view:synthetic-user:synthetic-company:synthetic-unit:/reports/sales-margin");
    expect(JSON.parse(value || "{}").filters.q).toBe("Synthetic");
    expect(screen.getByRole("button", { name: "My sales view" })).toBeTruthy();
  });

  it("keeps the action bar usable when report filters are hidden", async () => {
    showReport();
    await waitFor(() => expect(screen.getByRole("columnheader", { name: "Customer" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Customise" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show filters" }));
    expect(screen.getByRole("button", { name: "Save As" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Customise" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Date range", hidden: true }).closest("[data-report-filters]")?.getAttribute("style")).toContain("display: none");
  });
});
