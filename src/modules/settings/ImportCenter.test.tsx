// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { MemoryRouter } from "react-router-dom";
import ImportCenter from "./ImportCenter";

vi.mock('@/modules/purchase/GeneralExpenseBillImport',()=>({default:()=> <div>Expense Invoice Bulk Import</div>}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock("@/modules/transport/TransportNormalInvoiceImport", () => ({
 default: ({side}:{side:string}) => <section aria-label={side==="customer"?"Normal Sales Import":"Normal Purchase Import"}><h3>Normal {side==="customer"?"Sales":"Purchase"} Invoice Bulk Import — No Trips</h3></section>
}));


vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({
  activeCompany: { company_id: "gondal-company", membership_role: "company_owner", enabled_modules: ["master", "sales", "purchase", "accounting", "transport"] },
  activeBusinessUnit: { business_unit_id: "gondal-bu", business_unit_type: "transport", membership_role: "company_owner", enabled_modules: ["master", "sales", "purchase", "accounting", "transport"] },
  isPlatformOwner: true,
}) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("import center workflow routing", () => {
 it("renders only the selected service invoice workflow",()=>{
  render(<MemoryRouter initialEntries={["/settings/imports?section=service"]}><ImportCenter/></MemoryRouter>);
  expect(screen.getByText(/Import service invoices against existing trips/)).toBeTruthy();
  expect(screen.getByRole("option",{name:"Ready invoices from external source"})).toBeTruthy();
  expect(screen.getByRole("link",{name:/Customer Cash\/Credit settings/}).getAttribute("href")).toBe("/master-data/customers?tab=billing");
  expect(screen.getByLabelText("Invoice import workflow")).toBeTruthy();
  expect(screen.queryByRole("heading",{name:"Transport Master Imports"})).toBeNull();
  expect(screen.queryByRole("heading",{name:"Customers"})).toBeNull();
  expect(screen.queryByRole("heading",{name:"Bulk Journal Entries"})).toBeNull();
 });
 it("shows only customer and supplier master imports on the masters screen",()=>{
  render(<MemoryRouter initialEntries={["/settings/imports?section=masters"]}><ImportCenter/></MemoryRouter>);
  expect(screen.getByRole("heading",{name:"Customers"})).toBeTruthy();
  expect(screen.getByRole("heading",{name:"Suppliers"})).toBeTruthy();
  expect(screen.getByRole("link",{name:/View Customers/}).getAttribute("href")).toBe("/master-data/customers");
  expect(screen.getByRole("link",{name:/View Suppliers/}).getAttribute("href")).toBe("/master-data/suppliers");
  expect(screen.queryByRole("heading",{name:"Transport Master Imports"})).toBeNull();
 });
 it("shows transport master and rate imports on their own screen",()=>{
  render(<MemoryRouter initialEntries={["/settings/imports?section=rates"]}><ImportCenter/></MemoryRouter>);
  expect(screen.getByRole("heading",{name:"Transport Master Imports"})).toBeTruthy();
  expect(screen.getByRole("heading",{name:"Transport Rate Imports"})).toBeTruthy();
  for(const name of ["Vehicles","Drivers","Truck Types","Locations","Vehicle Ownership History","Customer Route Rates","Supplier Route Rates","Customer Additional Charges"]){
   expect(screen.getByRole("option",{name})).toBeTruthy();
  }
  expect(screen.queryByRole("heading",{name:"Customers"})).toBeNull();
  expect(screen.queryByRole("heading",{name:"Transport Sales Invoice Import"})).toBeNull();
 });
 it("keeps receipts and journals separate from invoices",()=>{
  render(<MemoryRouter initialEntries={["/settings/imports?section=accounting"]}><ImportCenter/></MemoryRouter>);
  expect(screen.getByRole("heading",{name:"Transport Receipts / Payments Import"})).toBeTruthy();
  expect(screen.getByRole("heading",{name:"Bulk Journal Entries"})).toBeTruthy();
  expect(screen.getByRole("link",{name:"Open Journal Import"}).getAttribute("href")).toBe("/accounting?import=journal");
  expect(screen.queryByRole("heading",{name:"Transport Sales Invoice Import"})).toBeNull();
 });
 it("shows only the one-time import/transfer options on the history screen",()=>{
  render(<MemoryRouter initialEntries={["/settings/imports?section=history"]}><ImportCenter/></MemoryRouter>);
  expect(screen.getByRole("link",{name:"Open One-time Import"}).getAttribute("href")).toBe("/settings/imports?transportUpload=historical");
  expect(screen.queryByRole("heading",{name:"Customers"})).toBeNull();
 });
 it("shows only the selected workflow and one return link, without extra section tabs",()=>{
  for(const section of ["masters","rates","service","normal","vehicle-expenses","expense","accounting","history"]){
   const {unmount}=render(<MemoryRouter initialEntries={[`/settings/imports?section=${section}`]}><ImportCenter/></MemoryRouter>);
   expect(screen.queryByRole("navigation",{name:"Import workflows"})).toBeNull();
   const back=screen.getByRole("link",{name:/All import workflows/});
   expect(back.getAttribute("href")).toBe("/workspace/imports");
   expect(document.querySelector('[data-import-section]')?.getAttribute("data-import-section")).toBe(section);
   unmount();
  }
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
 Object.defineProperty(file,"arrayBuffer",{value:async()=>buffer,configurable:true});
 return file;
}

describe("Import Center Customer Master upload",()=>{
 it("previews names, skips an existing master and creates only new customers after confirmation",async()=>{
  mockExisting([{name:"Existing Customer"}]);
  vi.mocked(supabase.rpc).mockResolvedValue({data:{id:"created-id"},error:null} as never);
  vi.spyOn(window,"confirm").mockReturnValue(true);

  render(<MemoryRouter initialEntries={["/settings/imports?section=masters"]}><ImportCenter /></MemoryRouter>);
  expect(screen.getAllByRole("button",{name:"Download Template"}).length).toBeGreaterThan(0);
  expect(within(screen.getByRole("heading",{name:"Customers"}).closest("section")!).getByRole("button",{name:"Choose File"})).toBeTruthy();
  expect(within(screen.getByRole("heading",{name:"Suppliers"}).closest("section")!).getByRole("button",{name:"Choose File"})).toBeTruthy();
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
  mockExisting([]);
  render(<MemoryRouter initialEntries={["/settings/imports?section=masters"]}><ImportCenter /></MemoryRouter>);
  const file=customerFile([["Name"],["Customer A"],["customer   a"]]);
  fireEvent.change(screen.getByLabelText("Select customer import file"),{target:{files:[file]}});
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("Duplicate customer"));
  expect(vi.mocked(supabase.rpc)).not.toHaveBeenCalled();
 });
});

function mockExisting(names:{name:string}[]){
 const range=vi.fn().mockResolvedValue({data:names,error:null});
 const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),range};
 vi.mocked(supabase.from).mockReturnValue(query as never);
 return query;
}

describe("Import Center supplier upload",()=>{
 it("previews supplier names and uses the supplier/AP engine only after review",async()=>{
  const query=mockExisting([{name:"Existing Supplier"}]);
  vi.mocked(supabase.rpc).mockResolvedValue({data:{id:"new-supplier"},error:null} as never);
  vi.spyOn(window,"confirm").mockReturnValue(true);
  render(<MemoryRouter initialEntries={["/settings/imports?section=masters"]}><ImportCenter/></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Select supplier import file"),{target:{files:[customerFile([["Supplier Name","Phone"],["Existing Supplier",""],["New Supplier","050123"]])]}});
  await waitFor(()=>expect(screen.getByText("New Supplier")).toBeTruthy());
  expect(supabase.rpc).not.toHaveBeenCalled();
  expect(query.eq).toHaveBeenCalledWith("company_id","gondal-company");
  fireEvent.click(screen.getByRole("button",{name:"Import 1 Suppliers"}));
  await waitFor(()=>expect(screen.getByRole("status").textContent).toContain("1 supplier(s) imported"));
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.rpc).toHaveBeenCalledWith("create_supplier_with_ap",{p_name:"New Supplier",p_email:null,p_phone:"050123",p_address:null});
 });
 it("blocks duplicate supplier names before writing",async()=>{
  mockExisting([]);
  render(<MemoryRouter initialEntries={["/settings/imports?section=masters"]}><ImportCenter/></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Select supplier import file"),{target:{files:[customerFile([["Name"],["Supplier A"],["supplier   a"]])]}});
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("Duplicate supplier"));
  expect(supabase.rpc).not.toHaveBeenCalled();
 });
 it("checks every existing page so a supplier after the first 1000 is skipped",async()=>{
  const query=mockExisting([]);
  query.range.mockResolvedValueOnce({data:Array.from({length:1000},(_,i)=>({name:`Supplier ${i}`})),error:null}).mockResolvedValueOnce({data:[{name:"Last Supplier"}],error:null});
  render(<MemoryRouter initialEntries={["/settings/imports?section=masters"]}><ImportCenter/></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Select supplier import file"),{target:{files:[customerFile([["Name"],["Last Supplier"]])]}});
  await waitFor(()=>expect(screen.getByText("Already exists · skip")).toBeTruthy());
  expect(query.range).toHaveBeenNthCalledWith(2,1000,1999);
  expect(screen.getByRole("button",{name:"Import 0 Suppliers"}).hasAttribute("disabled")).toBe(true);
  expect(supabase.rpc).not.toHaveBeenCalled();
 });
});

describe("Import Center financial review",()=>{
 it("does not expose driver earnings or vehicle expense uploads",()=>{render(<MemoryRouter initialEntries={["/settings/imports?section=rates"]}><ImportCenter/></MemoryRouter>);expect(screen.queryByRole("heading",{name:"Driver Trip Earnings Import"})).toBeNull();expect(screen.queryByRole("heading",{name:"Transport Trip Expense Import"})).toBeNull();expect(screen.queryByRole("option",{name:"Vehicle Expense Types"})).toBeNull()});
 it("disables invoice import when the server preview rejects a row",async()=>{
  vi.mocked(supabase.rpc).mockResolvedValue({data:{rows:[{amount:100,import_status:"Error",import_reason:"Vehicle mismatch"}]},error:null} as never);
  render(<MemoryRouter initialEntries={["/settings/imports?section=service"]}><ImportCenter/></MemoryRouter>);
  const card=screen.getByRole("heading",{name:"Transport Sales Invoice Import"}).closest("section")!;
  fireEvent.change(card.querySelector('input[type="file"]')!,{target:{files:[customerFile([["Source Company","Source Invoice ID","Invoice No","Invoice Date","Customer","Trip No","Vehicle No","Amount"],["Source","SRC1","INV1","2026-10-09","Customer A","TRIP1","ABC",100]])]}});
  await waitFor(()=>expect(within(card).getByText("Vehicle mismatch")).toBeTruthy());
  expect(within(card).getByRole("button",{name:"Import 1 Rows"}).hasAttribute("disabled")).toBe(true);
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.rpc).toHaveBeenCalledWith("transport_preview_customer_invoice_batch",expect.anything());
 });
 it("blocks unlinked company-driver master imports before any write",async()=>{
  render(<MemoryRouter initialEntries={["/settings/imports?section=rates"]}><ImportCenter/></MemoryRouter>);
  const card=screen.getByRole("heading",{name:"Transport Master Imports"}).closest("section")!;
  fireEvent.change(card.querySelector("select")!,{target:{value:"drivers"}});
  fireEvent.change(card.querySelector('input[type="file"]')!,{target:{files:[customerFile([["Driver Name","Driver Type","Supplier"],["Company Driver","Company",""]])]}});
  await waitFor(()=>expect(within(card).getByRole("alert").textContent).toContain("Company drivers must be linked to an Employee"));
  expect(supabase.rpc).not.toHaveBeenCalled();
 });
 it("allows supplier-driver previews without creating an Employee",async()=>{
  render(<MemoryRouter initialEntries={["/settings/imports?section=rates"]}><ImportCenter/></MemoryRouter>);
  const card=screen.getByRole("heading",{name:"Transport Master Imports"}).closest("section")!;
  fireEvent.change(card.querySelector("select")!,{target:{value:"drivers"}});
  fireEvent.change(card.querySelector('input[type="file"]')!,{target:{files:[customerFile([["Driver Name","Driver Type","Supplier"],["External Driver","Supplier","Supplier A"]])]}});
  await waitFor(()=>expect(within(card).getByText("External Driver")).toBeTruthy());
  expect(within(card).queryByRole("alert")).toBeNull();expect(supabase.rpc).not.toHaveBeenCalled();
 });
});
