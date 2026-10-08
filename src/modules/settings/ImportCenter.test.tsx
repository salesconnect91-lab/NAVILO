// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { MemoryRouter } from "react-router-dom";
import ImportCenter from "./ImportCenter";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({
  activeCompany: { company_id: "gondal-company", membership_role: "company_owner", enabled_modules: ["master", "sales", "purchase", "accounting", "transport"] },
  activeBusinessUnit: { business_unit_id: "gondal-bu", membership_role: "company_owner", enabled_modules: ["master", "sales", "purchase", "accounting", "transport"] },
  isPlatformOwner: true,
}) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("import center", () => {
  it("shows centralized Transport rate imports and implemented destinations", () => {
    render(<MemoryRouter><ImportCenter /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Transport Master Imports" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Transport Rate Imports" })).toBeTruthy();
    for (const name of ["Vehicles","Drivers","Truck Types","Locations","Vehicle Expense Types","Vehicle Ownership History"]) expect(screen.getByRole("option", { name })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map(node => node.textContent)).toEqual(["NAVILO → NAVILO Transport Transfer","Transport Master Imports","Transport Rate Imports","Transport Driver Pay Import","Transport Trip Expense Import","Transport Receipts / Payments Import","Transport Sales Invoice Import","Receipts / Payments","Customers","Suppliers","Invoices"]);
    expect(screen.getByRole("option", { name: "Customer Route Rates" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Supplier Route Rates" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Customer Additional Charges" })).toBeTruthy();
    expect(screen.getByText("No import permission")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open customer import/ }).getAttribute("href")).toBe("/master-data/customers");
    expect(screen.getByRole("link", { name: /Open supplier import/ }).getAttribute("href")).toBe("/master-data/suppliers");
  });
});
function customerFile(rows:(string|number)[][]) {
 const wb = XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),"Customers");
 const raw = XLSX.write(wb,{type:"array",bookType:"xlsx"}) as ArrayBuffer | Uint8Array;
 const bytes = new Uint8Array(raw);
 const buffer = new ArrayBuffer(bytes.byteLength);
 new Uint8Array(buffer).set(bytes);
 const file = new File([buffer],"customers.xlsx",{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
 Object.defineProperty(file,"arrayBuffer",{value:async()=>buffer});
 return file;
}

describe("Import Center Customer Master upload",()=>{
 it("previews names, skips an existing master and creates only new customers after confirmation",async()=>{
  const select=vi.fn().mockResolvedValue({data:[{name:"Existing Customer"}],error:null});
  vi.mocked(supabase.from).mockReturnValue({select} as never);
  vi.mocked(supabase.rpc).mockResolvedValue({data:{id:"created-id"},error:null} as never);
  vi.spyOn(window,"confirm").mockReturnValue(true);

  render(<MemoryRouter><ImportCenter /></MemoryRouter>);
  expect(screen.getAllByRole("button",{name:"Download Template"}).length).toBeGreaterThan(0);
  expect(screen.getByRole("button",{name:"Upload Excel / CSV"})).toBeTruthy();
  const file=customerFile([
   ["Name","Urdu Name","Email","Phone","Address","Tax Status","NTN","STRN","CNIC"],
   ["Existing Customer","","","","","unregistered","","",""],
   ["Gondal New Customer","","","","","unregistered","","",""]
  ]);
  fireEvent.change(screen.getByLabelText("Select customer import file"),{target:{files:[file]}});
  await waitFor(()=>expect(screen.getByText("Gondal New Customer")).toBeTruthy());
  expect(screen.getByText(/2 row\(s\).*1 already exist/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Import 1 Customers"}));
  await waitFor(()=>expect(supabase.rpc).toHaveBeenCalledWith("create_customer_with_ar",{
   p_name:"Gondal New Customer",p_email:null,p_phone:null,p_address:null
  }));
  await waitFor(()=>expect(screen.getByText(/1 customer\(s\) imported/)).toBeTruthy());
  expect(vi.mocked(supabase.rpc)).toHaveBeenCalledTimes(1);
 });

 it("blocks duplicate customer rows before any RPC writes",async()=>{
  const select=vi.fn().mockResolvedValue({data:[],error:null});
  vi.mocked(supabase.from).mockReturnValue({select} as never);
  render(<MemoryRouter><ImportCenter /></MemoryRouter>);
  const file=customerFile([["Name"],["Customer A"],["customer   a"]]);
  fireEvent.change(screen.getByLabelText("Select customer import file"),{target:{files:[file]}});
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("Duplicate customer"));
  expect(vi.mocked(supabase.rpc)).not.toHaveBeenCalled();
 });
});
