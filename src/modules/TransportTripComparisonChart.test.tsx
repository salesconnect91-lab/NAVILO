// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { supabase } from "@/lib/supabase";
import TransportTripComparisonChart from "./TransportTripComparisonChart";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children, data }: { children: ReactNode; data: unknown[] }) => <div data-testid="trip-chart" data-points={data.length}>{children}</div>,
  Bar: ({ name }: { name: string }) => <span>{name}</span>,
  CartesianGrid: () => null, XAxis: () => null, YAxis: () => null,
  Tooltip: () => null, Legend: () => null,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("shows monthly current-versus-prior trips and switches to five-year view", async () => {
  const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, current: i < 10 ? 10 : 0, previous: i < 10 ? 5 : 0 }));
  vi.mocked(supabase.rpc).mockImplementation((async () => ({
    data: { as_of: "2026-10-10", current_year: 2026, previous_year: 2025, monthly,
      yearly: [2022,2023,2024,2025,2026].map(year => ({ year, trips: year === 2026 ? 100 : 50 })) },
    error: null,
  })) as never);
  render(<TransportTripComparisonChart companyId="orbit" businessUnitId="transport" asOf="2026-10-10" />);
  await waitFor(() => expect(screen.getByText("100 trips")).toBeTruthy());
  expect(screen.getByText("50 trips")).toBeTruthy();
  expect(screen.getByText("+100.0%")).toBeTruthy();
  expect(screen.getByTestId("trip-chart").getAttribute("data-points")).toBe("12");
  fireEvent.click(screen.getByRole("button", { name: "Yearly" }));
  expect(screen.getByTestId("trip-chart").getAttribute("data-points")).toBe("5");
  expect(screen.getByRole("button", { name: "Yearly" }).getAttribute("aria-pressed")).toBe("true");
  expect(supabase.rpc).toHaveBeenCalledWith("transport_trip_volume_comparison", { p_as_of: "2026-10-10" });
});

it("does not invent trips when the server returns an empty series", async () => {
  vi.mocked(supabase.rpc).mockImplementation((async () => ({
    data: { as_of: "2026-10-10", current_year: 2026, previous_year: 2025,
      monthly: Array.from({length:12},(_,i)=>({month:i+1,current:0,previous:0})),
      yearly: [2022,2023,2024,2025,2026].map(year=>({year,trips:0})) }, error: null,
  })) as never);
  render(<TransportTripComparisonChart companyId="gondal" businessUnitId="transport" asOf="2026-10-10" />);
  await waitFor(() => expect(screen.getByText("No trips recorded in the comparison period.")).toBeTruthy());
});
