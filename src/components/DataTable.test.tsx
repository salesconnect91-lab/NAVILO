// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  it("migrates old density to compact while preserving column order", () => {
    const key = `navilo:table-columns:${location.pathname}:customer|amount:neus-v3`;
    localStorage.setItem(key, JSON.stringify({ density: "spacious", order: ["amount", "customer"], widths: { amount: 180 }, pageSize: 50 }));
    const {container} = render(<DataTable columns={columns} rows={rows} />);
    expect(container.querySelector("[data-navilo-data-table]")?.getAttribute("data-density")).toBe("compact");
    expect(screen.getAllByRole("columnheader").filter(header => header.textContent?.includes("Amount") || header.textContent?.includes("Customer"))[0].textContent).toContain("Amount");
  });

  it("retains a density chosen after the compact update", () => {
    const key = `navilo:table-columns:${location.pathname}:customer|amount:neus-v3`;
    localStorage.setItem(key, JSON.stringify({ density: "comfortable", densityVersion: 1 }));
    const {container} = render(<DataTable columns={columns} rows={rows} />);
    expect(container.querySelector("[data-navilo-data-table]")?.getAttribute("data-density")).toBe("comfortable");
  });

  it("uses server result totals, paging and sorting without client re-pagination", () => {
    const onPageChange=vi.fn();
    const onSortChange=vi.fn();
    const remoteRows=Array.from({length:25},(_,i)=>({
      id:`remote-${i}`, customer:`Remote ${i}`, amount:i+1,
    }));
    render(<DataTable columns={columns} rows={remoteRows} remote={{
      total:8970,page:2,pageSize:25,onPageChange,
      sort:null,onSortChange,
    }}/>);
    expect(screen.getByText(/Showing 26–50 of 8970/)).toBeTruthy();
    expect(screen.getByText("Remote 0")).toBeTruthy();
    expect(screen.getByText("Remote 24")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Next"}));
    expect(onPageChange).toHaveBeenCalledWith(3,25);
    fireEvent.click(screen.getByRole("button",{name:"Customer"}));
    expect(onSortChange).toHaveBeenCalledWith({key:"customer",dir:"asc"});
  });

});
