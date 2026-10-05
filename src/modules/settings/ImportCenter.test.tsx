// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ImportCenter from "./ImportCenter";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({
  activeCompany: { membership_role: "company_owner", enabled_modules: ["master", "sales", "purchase", "transport"] },
  activeBusinessUnit: { membership_role: "company_owner", enabled_modules: ["master", "sales", "purchase", "transport"] },
  isPlatformOwner: true,
}) }));
afterEach(cleanup);

describe("import center", () => {
  it("shows centralized Transport rate imports and implemented destinations", () => {
    render(<MemoryRouter><ImportCenter /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Transport Master Imports" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Transport Rate Imports" })).toBeTruthy();
    for (const name of ["Vehicles","Drivers","Truck Types","Locations","Vehicle Expense Types","Vehicle Ownership History"]) expect(screen.getByRole("option", { name })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map(node => node.textContent)).toEqual(["Transport Master Imports","Transport Rate Imports","Transport Trip Expense Import","NAVILO → NAVILO Transport Transfer","Transport Driver Pay Import","Transport Receipts / Payments Import","Transport Sales Invoice Import","Bank Data","Customers","Suppliers","Invoices"]);
    expect(screen.getByRole("option", { name: "Customer Route Rates" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Supplier Route Rates" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Customer Additional Charges" })).toBeTruthy();
    expect(screen.getByText("Not available")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open customer import/ }).getAttribute("href")).toBe("/master-data/customers");
    expect(screen.getByRole("link", { name: /Open supplier import/ }).getAttribute("href")).toBe("/master-data/suppliers");
  });
});