// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ImportCenter from "./ImportCenter";

vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({
  activeCompany: { membership_role: "company_owner", enabled_modules: ["master", "sales", "purchase", "transport"] },
  activeBusinessUnit: { membership_role: "company_owner", enabled_modules: ["master", "sales", "purchase", "transport"] },
  isPlatformOwner: true,
}) }));
afterEach(cleanup);

describe("import center", () => {
  it("links only to implemented import screens and marks bank upload unavailable", () => {
    render(<MemoryRouter><ImportCenter /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Transport Rate Imports" })).toBeTruthy();\n    expect(screen.getAllByRole("heading", { level: 2 }).map(node => node.textContent)).toEqual(["Transport Rate Imports","Bank Data", "Customers", "Suppliers", "Invoices"]);\n    expect(screen.getByRole("option", { name: "Customer Route Rates" })).toBeTruthy();\n    expect(screen.getByRole("option", { name: "Supplier Route Rates" })).toBeTruthy();\n    expect(screen.getByRole("option", { name: "Customer Additional Charges" })).toBeTruthy();
    expect(screen.getByText("Not available")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open customer import/ }).getAttribute("href")).toBe("/master-data/customers");
    expect(screen.getByRole("link", { name: /Open supplier import/ }).getAttribute("href")).toBe("/master-data/suppliers");
    expect(screen.getByRole("link", { name: /Sales/ }).getAttribute("href")).toBe("/sales");
    expect(screen.getByRole("link", { name: /Purchase/ }).getAttribute("href")).toBe("/purchase");
  });
});
