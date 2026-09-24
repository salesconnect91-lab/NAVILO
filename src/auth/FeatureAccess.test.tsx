// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeatureAccessProvider, useFeatureAccess } from "./FeatureAccess";

const state = vi.hoisted(() => ({ companyId: "tenant-a", fail: false }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({
  isPlatformOwner: false,
  activeCompany: { company_id: state.companyId, enabled_modules: ["dashboard", "reports"] },
  activeBusinessUnit: null,
}) }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: () => {
  const query = { select: () => query, eq: async () => state.fail
    ? { data: null, error: { message: "Entitlements unavailable" } }
    : { data: [], error: null } };
  return query;
} } }));

function Probe() {
  const { loading, isFeatureEnabled } = useFeatureAccess();
  return <output>{loading ? "loading" : isFeatureEnabled("dashboard", "view") ? "allowed" : "denied"}</output>;
}

afterEach(() => { cleanup(); state.companyId = "tenant-a"; state.fail = false; });
describe("tenant feature access", () => {
  it("denies access while loading and when the entitlement read fails", async () => {
    state.fail = true;
    render(<MemoryRouter><FeatureAccessProvider><Probe /></FeatureAccessProvider></MemoryRouter>);
    expect(screen.getByRole("status").textContent).not.toBe("allowed");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("denied"));
  });
  it("does not reuse rules from a previous company", async () => {
    const view = render(<MemoryRouter><FeatureAccessProvider><Probe /></FeatureAccessProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("allowed"));
    state.companyId = "tenant-b";
    state.fail = true;
    view.rerender(<MemoryRouter><FeatureAccessProvider><Probe /></FeatureAccessProvider></MemoryRouter>);
    expect(screen.getByRole("status").textContent).not.toBe("allowed");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("denied"));
  });
});
