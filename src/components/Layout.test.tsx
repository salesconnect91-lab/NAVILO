// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import Layout from "./Layout";

vi.mock("@/auth/AuthContext", () => ({
  useAuth: () => ({
    user: { email: "synthetic@example.test" },
    signOut: vi.fn(),
    isPlatformOwner: false,
    activeCompany: { company_name: "Synthetic Company", membership_role: "company_owner" },
    activeBusinessUnit: { membership_role: "company_owner", business_unit_type: "transport", enabled_modules: ["master", "dashboard", "sales", "purchase", "transport"] },
  }),
}));
vi.mock("@/auth/FeatureAccess", () => ({ useFeatureAccess: () => ({ isFeatureEnabled: () => true }) }));
vi.mock("@/lib/platformBranding", () => ({ usePlatformBranding: () => ({ branding: { show_branding: false, show_in_sidebar: false } }) }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) },
}));
vi.mock("@/components/UniversalDataTools", () => ({ default: () => null }));

beforeEach(() => localStorage.setItem("navilo-sidebar-collapsed", "true"));
afterEach(() => { cleanup(); localStorage.clear(); });

describe("collapsed navigation", () => {
  it("places Transport destinations and reports in the sidebar with only one active query link", () => {
    render(<MemoryRouter initialEntries={["/transport?view=audit"]}><Layout><div>Audit workspace</div></Layout></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    for(const name of ["Trips","Trip Audit"])
      expect(screen.getByRole("link",{name})).toBeTruthy();
    expect(screen.queryByRole("link",{name:"Company Vehicle Ledger"})).toBeNull();
    expect(screen.queryByRole("link",{name:"Trip / Vehicle Expense Upload"})).toBeNull();
    expect(screen.queryByRole("link",{name:"Driver Ledger"})).toBeNull();
    expect(screen.queryByRole("link",{name:"Driver Account / Hisaab"})).toBeNull();
    expect(screen.queryByRole("link",{name:"Vehicle Account / Gari Hisaab"})).toBeNull();
    expect(screen.queryByRole("link",{name:"New Trip"})).toBeNull();
    expect(screen.getByRole("link",{name:"Trip Audit"}).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link",{name:"Trips"}).getAttribute("aria-current")).toBe("false");
    fireEvent.click(screen.getByRole("button",{name:"Reports & Allocation"}));
    for(const name of ["Customer Reports","Supplier Reports","Bulk Allocation"])
      expect(screen.getByRole("link",{name})).toBeTruthy();
    const content=document.querySelector('#navilo-main-content')?.parentElement;
    expect(content?.classList.contains('z-0')).toBe(true);
  });

  it("opens the requested party report as the single active Transport destination", () => {
    render(<MemoryRouter initialEntries={["/transport?panel=supplier-reports"]}><Layout><div>Report</div></Layout></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("link",{name:"Supplier Reports"}).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link",{name:"Customer Reports"}).getAttribute("aria-current")).toBe("false");
    expect(screen.getByRole("link",{name:"Trips"}).getAttribute("aria-current")).toBe("false");
  });
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

  it("opens distinct Sales and Purchase invoice lists through their sidebar links", async () => {
    function RouteView() {
      const route=useLocation();
      return <output data-testid="current-invoice-path">{route.pathname+route.search}</output>;
    }
    render(<MemoryRouter initialEntries={["/sales"]}><Layout><RouteView/></Layout></MemoryRouter>);
    fireEvent.click(screen.getByRole("button",{name:"Open navigation"}));
    const sales=screen.getByRole("link",{name:"Sales Invoices"});
    expect(sales.getAttribute("href")).toBe("/sales");
    fireEvent.click(screen.getByRole("button",{name:"Purchase"}));
    fireEvent.click(screen.getAllByRole("button",{name:"Invoices"})[1]);
    const purchase=screen.getByRole("link",{name:"Purchase Invoices"});
    expect(purchase.getAttribute("href")).toBe("/purchase");
    fireEvent.click(purchase);
    await waitFor(()=>expect(screen.getByTestId("current-invoice-path").textContent).toBe("/purchase"));
    fireEvent.click(screen.getByRole("button",{name:"Open navigation"}));
    fireEvent.click(screen.getByRole("button",{name:"Sales"}));
    fireEvent.click(screen.getAllByRole("button",{name:"Invoices"})[0]);
    fireEvent.click(screen.getByRole("link",{name:"Sales Invoices"}));
    await waitFor(()=>expect(screen.getByTestId("current-invoice-path").textContent).toBe("/sales"));
  });

  it("names the sales invoice editor instead of showing a generic ERP title", () => {
    render(<MemoryRouter initialEntries={["/sales/new"]}><Layout><div>Invoice editor</div></Layout></MemoryRouter>);
    expect(screen.getByText("New Sales Invoice")).toBeTruthy();
  });
  it("keeps Transport within the remaining desktop width across sidebar toggles", () => {
    render(<MemoryRouter initialEntries={["/transport"]}><Layout><button>Transport action</button></Layout></MemoryRouter>);
    const content=document.querySelector('#navilo-main-content')?.parentElement as HTMLElement;
    expect(content.style.width).toBe("auto");
    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    expect(content.classList.contains("lg:ml-[216px]")).toBe(true);
    expect(content.style.width).toBe("auto");
    expect(screen.getByRole("button", { name: "Transport action" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    expect(content.classList.contains("lg:ml-[56px]")).toBe(true);
    expect(content.style.width).toBe("auto");
  });

});
