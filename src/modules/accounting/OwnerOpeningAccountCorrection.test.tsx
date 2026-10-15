// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import OwnerOpeningAccountCorrection from "./OwnerOpeningAccountCorrection";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === "owner_posted_control_access") return { data: true, error: null };
    if (name === "owner_correct_opening_only_account") return {
      data: {
        eligible: true,
        old_name: "Wrong Account",
        old_code: "1909",
        new_name: String(args?.p_new_name ?? "Wrong Account"),
        new_code: String(args?.p_new_code ?? "1909"),
        new_parent: "Accounts Receivable",
        opening_debit: 1200,
        opening_credit: 0,
        net_debit: 1200,
        original_opening_journal: "test-opening",
      },
      error: null,
    };
    return { data: null, error: new Error("Unexpected RPC") };
  }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mock.rpc } }));

afterEach(() => { cleanup(); mock.rpc.mockClear(); });

it("searches both original account and Receivables parent by code/name before opening correction preview", async () => {
  const accounts = [
    { id: "wrong-account", name: "Wrong Account", code: "1909", type: "asset", is_active: true, is_group: false },
    { id: "other-account", name: "Other Account", code: "1908", type: "asset", is_active: true, is_group: false },
    { id: "ar-group", name: "Accounts Receivable", code: "1200", type: "asset", is_active: true, is_group: true },
    { id: "cash-group", name: "Cash and Bank", code: "1100", type: "asset", is_active: true, is_group: true },
  ];
  render(<OwnerOpeningAccountCorrection accounts={accounts} onCompleted={async () => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Correct Opening Account" }));
  expect(document.querySelectorAll('select').length).toBe(0);

  fireEvent.click(screen.getByRole("button", { name: "Wrong posted Opening Account" }));
  fireEvent.change(screen.getByPlaceholderText("Search account code or name..."), { target: { value: "1909" } });
  expect(screen.getByRole("option", { name: "1909 · Wrong Account" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "1908 · Other Account" })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: "1909 · Wrong Account" }));

  fireEvent.click(screen.getByRole("button", { name: "New Parent — Asset / Receivables Group" }));
  fireEvent.change(screen.getByPlaceholderText("Search Asset or Receivables group..."), { target: { value: "Receivable" } });
  expect(screen.getByRole("option", { name: "1200 · Accounts Receivable" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "1100 · Cash and Bank" })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: "1200 · Accounts Receivable" }));

  fireEvent.click(screen.getByRole("button", { name: "Preview & Verify" }));
  await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith(
    "owner_correct_opening_only_account",
    expect.objectContaining({ p_account_id: "wrong-account", p_new_parent_id: "ar-group", p_preview: true })
  ));
});
