// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DataTable from "./DataTable";

const columns = [{ key: "customer", label: "Customer" }, { key: "amount", label: "Amount" }];
const rows = [{ id: "synthetic-1", customer: "Synthetic Company", amount: 125 }];

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("shared ERP table", () => {
  it("uses one English loading source and an announced status", () => {
    render(<DataTable columns={columns} rows={[]} loading />);
    expect(screen.getByRole("status").textContent).toBe("Loading records…");
  });

  it("keeps the final data column visible after customization", () => {
    render(<DataTable columns={columns} rows={rows} />);
    fireEvent(window, new Event("navilo:report-customize"));
    expect(screen.getByRole("dialog", { name: "Customize table columns" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Amount" }));
    expect(screen.queryByRole("columnheader", { name: "Amount" })).toBeNull();
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Customer" }).disabled).toBe(true);
    expect(screen.getByRole("columnheader", { name: "Customer" })).toBeTruthy();
  });

  it("repairs a saved preference that hides every data column", () => {
    localStorage.setItem(`navilo:table-columns:${location.pathname}:customer|amount`, '["customer","amount"]');
    render(<DataTable columns={columns} rows={rows} />);
    expect(screen.getByRole("columnheader", { name: "Customer" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Amount" })).toBeNull();
  });
});
