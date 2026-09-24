// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Layout from "./Layout";

vi.mock("@/auth/AuthContext", () => ({
  useAuth: () => ({
    user: { email: "synthetic@example.test" },
    signOut: vi.fn(),
    isPlatformOwner: false,
    activeCompany: { company_name: "Synthetic Company", membership_role: "company_owner" },
    activeBusinessUnit: { membership_role: "company_owner", enabled_modules: ["master", "dashboard", "sales"] },
  }),
}));
vi.mock("@/auth/FeatureAccess", () => ({ useFeatureAccess: () => ({ isFeatureEnabled: () => true }) }));
vi.mock("@/lib/platformBranding", () => ({ usePlatformBranding: () => ({ branding: { show_branding: false, show_in_sidebar: false } }) }));
vi.mock("@/components/UniversalDataTools", () => ({ default: () => null }));

beforeEach(() => localStorage.setItem("navilo-sidebar-collapsed", "true"));
afterEach(() => { cleanup(); localStorage.clear(); });

describe("collapsed navigation", () => {
  it("shows active nested links in the mobile drawer and returns focus after Escape", () => {
    render(<MemoryRouter initialEntries={["/master-data/customers"]}><Layout><div>Workspace</div></Layout></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Customers" })).toBeNull();
    const menu = screen.getByRole("button", { name: "Open navigation" });
    fireEvent.click(menu);
    expect(screen.getByRole("link", { name: "Customers" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Master Data" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("link", { name: "Customers" })).toBeNull();
    expect(document.activeElement).toBe(menu);
  });

  it("expands the desktop icon rail before revealing an active nested route", () => {
    render(<MemoryRouter initialEntries={["/master-data/customers"]}><Layout><div>Workspace</div></Layout></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Master Data" }));
    expect(screen.getByRole("link", { name: "Customers" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse navigation" })).toBeTruthy();
  });

  it("names the sales invoice editor instead of showing a generic ERP title", () => {
    render(<MemoryRouter initialEntries={["/sales/new"]}><Layout><div>Invoice editor</div></Layout></MemoryRouter>);
    expect(screen.getByText("New Sales Invoice")).toBeTruthy();
  });
});
