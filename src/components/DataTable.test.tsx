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


  it("filters the entire loaded dataset using preloaded Excel-style column values", () => {
    const records=[
      {id:"local-1",customer:"Alpha Co",amount:10},
      {id:"local-2",customer:"Beta Co",amount:20},
      {id:"local-3",customer:"Alpha Co",amount:30},
    ];
    render(<DataTable columns={columns} rows={records} />);
    fireEvent.click(screen.getByRole("button",{name:"Filter Customer"}));
    const menu=screen.getByRole("dialog",{name:"Filter Customer"});
    expect(menu).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox",{name:"Search column values"}),{target:{value:"Alpha"}});
    expect(screen.queryByText("Beta Co",{selector:"span.break-all"})).toBeNull();
    fireEvent.click(screen.getByRole("checkbox",{name:"Alpha Co"}));
    fireEvent.click(screen.getByRole("button",{name:"Apply"}));
    expect(screen.getAllByText("Alpha Co")).toHaveLength(2);
    expect(screen.queryByText("Beta Co")).toBeNull();
    expect(screen.getByText("Showing 1–2 of 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Filter Customer"}));
    fireEvent.click(screen.getByRole("button",{name:"Clear"}));
    fireEvent.click(screen.getByRole("button",{name:"Apply"}));
    expect(screen.getByText("Beta Co")).toBeTruthy();
    expect(screen.getByText("Showing 1–3 of 3")).toBeTruthy();
  });

  it("preserves the selected Smart Table filter in the saved local view", () => {
    const records=[{id:"row-a",customer:"Alpha Co",amount:10},{id:"row-b",customer:"Beta Co",amount:20}];
    const {unmount}=render(<DataTable columns={columns} rows={records}/>);
    fireEvent.click(screen.getByRole("button",{name:"Filter Customer"}));
    fireEvent.click(screen.getByRole("checkbox",{name:"Beta Co"}));
    fireEvent.click(screen.getByRole("button",{name:"Apply"}));
    const key=`navilo:table-columns:${location.pathname}:customer|amount:neus-v3`;
    expect(JSON.parse(localStorage.getItem(key)||"{}").filters.customer).toEqual(["Beta Co"]);
    unmount();
    render(<DataTable columns={columns} rows={records}/>);
    expect(screen.getByText("Beta Co")).toBeTruthy();
    expect(screen.queryByText("Alpha Co")).toBeNull();
  });

  it("never offers current-page-only filtering on a remote table without server filter support",()=>{
    render(<DataTable columns={columns} rows={rows} remote={{
      total:1000,page:1,pageSize:25,sort:null,
      onSortChange:vi.fn(),onPageChange:vi.fn(),
    }}/>);
    expect(screen.queryByRole("button",{name:"Filter Customer"})).toBeNull();
  });

  it("keeps full matching report rows visible and available to export without a 25-row page cut", () => {
    const reportRows=Array.from({length:61},(_,i)=>({id:"synthetic-"+i,customer:i%2?"Beta Co":"Alpha Co",amount:i}));
    render(<DataTable columns={columns} rows={reportRows} unpaginated scopeKey="synthetic-company"/>);
    expect(screen.getByText("Showing 1–61 of 61")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(62);
    expect(screen.queryByRole("button",{name:"Next"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Filter Customer"}));
    fireEvent.click(screen.getByRole("checkbox",{name:"Beta Co"}));
    fireEvent.click(screen.getByRole("button",{name:"Apply"}));
    expect(screen.getByText("Showing 1–30 of 30")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(31);
  });

  it("isolates saved filter preferences by tenant scope",()=>{
    const localRows=[{id:"scope-1",customer:"Alpha Co",amount:1},{id:"scope-2",customer:"Beta Co",amount:2}];
    const first=render(<DataTable columns={columns} rows={localRows} scopeKey="company-A"/>);
    fireEvent.click(screen.getByRole("button",{name:"Filter Customer"}));
    fireEvent.click(screen.getByRole("checkbox",{name:"Alpha Co"}));
    fireEvent.click(screen.getByRole("button",{name:"Apply"}));
    expect(screen.queryByText("Beta Co")).toBeNull();
    first.unmount();
    render(<DataTable columns={columns} rows={localRows} scopeKey="company-B"/>);
    expect(screen.getByText("Beta Co")).toBeTruthy();
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
