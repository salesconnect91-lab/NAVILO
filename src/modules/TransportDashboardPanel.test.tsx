// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TransportDashboardPanel from "./TransportDashboardPanel";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("shows scoped transport lifecycle and PPR metrics with posted contribution only", async () => {
  vi.mocked(supabase.rpc).mockImplementation(((name: string) => {
    const response = name === "transport_dashboard_operational_summary" ? {
      data: { currency: "SAR", total_trips: 12, draft_trips: 2, incomplete_trips: 3,
        complete_trips: 4, locked_trips: 2, settled_trips: 1, ppr_pending: 5,
        trips_without_linked_sales_invoice: 6, customer_billed: 6 }, error: null,
    } : { data: [{ ownership: "company", trips: 5, revenue: 5000, cost: 3000, profit: 2000 }], error: null };
    const pending = Promise.resolve(response);
    return Object.assign(pending, {abortSignal: () => pending}) as never;
  }) as never);
  render(<MemoryRouter><TransportDashboardPanel companyId="orbit" businessUnitId="transport" startDate="2026-10-01" endDate="2026-10-10" /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("PPR Pending")).toBeTruthy());
  expect(supabase.rpc).not.toHaveBeenCalledWith("transport_contribution_summary", { p_from: "2026-10-01", p_to: "2026-10-10" });
  fireEvent.click(screen.getByRole("button",{name:"Load posted financial contribution"}));
  await waitFor(() => expect(screen.getByText("SAR 5,000")).toBeTruthy());
  expect(screen.getByText("PPR Pending")).toBeTruthy();
  expect(screen.getByText("SAR 3,000")).toBeTruthy();
  expect(screen.getByText("SAR 2,000")).toBeTruthy();
  expect(supabase.rpc).toHaveBeenCalledWith("transport_dashboard_operational_summary", { p_from: "2026-10-01", p_to: "2026-10-10" });
  expect(supabase.rpc).toHaveBeenCalledWith("transport_contribution_summary", { p_from: "2026-10-01", p_to: "2026-10-10" });
});

it("never displays financial amounts when financial RPC denies permission", async () => {
  vi.mocked(supabase.rpc).mockImplementation(((name: string) => {
    const response = name === "transport_contribution_summary"
      ? { data: null, error: { message: "Both financial view permissions required" } }
      : { data: { total_trips: 3, ppr_pending: 1, currency: "SAR" }, error: null };
    const pending = Promise.resolve(response);
    return Object.assign(pending, {abortSignal: () => pending}) as never;
  }) as never);
  render(<MemoryRouter><TransportDashboardPanel companyId="gondal" businessUnitId="transport" startDate="2026-10-01" endDate="2026-10-10" /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("3")).toBeTruthy());
  expect(screen.queryByText("Posted trip revenue")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Load posted financial contribution"}));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Both financial view permissions required/));
  expect(screen.queryByText("Posted trip revenue")).toBeNull();
});
