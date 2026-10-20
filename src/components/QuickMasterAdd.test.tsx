// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import QuickMasterAdd from "./QuickMasterAdd";
const state=vi.hoisted(()=>({company:"company-A",bu:"bu-A",masterSaves:0}));
vi.mock("@/auth/AuthContext",()=>({useAuth:()=>({
 activeCompany:{company_id:state.company},activeBusinessUnit:{business_unit_id:state.bu}
})}));
vi.mock("@/modules/transport/TransportQuickAdd",()=>({
 default:({kind,onCreated,onClose}:any)=><div role="dialog" aria-label={"Create "+kind}>
  <button onClick={async()=>{state.masterSaves++;await onCreated({id:"new-party",name:"New Counter Party"});onClose()}}>Save canonical master</button>
  <button onClick={onClose}>Cancel create</button>
 </div>
}));
vi.mock("@/modules/master-data/TransportFoundationMaster",()=>({
 default:({onCreated,quickCreate}:any)=><div role="dialog" aria-label="Create expense type">
  <button onClick={()=>void quickCreate.onCreated({id:"new-type",name:"Tyres"})}>Save</button>
 </div>
}));
beforeEach(()=>{state.company="company-A";state.bu="bu-A";state.masterSaves=0});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
describe("NAVILO reusable + New Master shortcut",()=>{
 it("uses original canonical customer editor and selects the newly created record once",async()=>{
  const selected=vi.fn();
  render(<><input aria-label="Current invoice number" defaultValue="ORIGINAL-55"/>
   <QuickMasterAdd kind="customer" onCreated={selected}/></>);
  fireEvent.click(screen.getByRole("button",{name:"Add new Customer"}));
  fireEvent.click(await screen.findByRole("button",{name:"Save canonical master"}));
  await waitFor(()=>expect(selected).toHaveBeenCalledWith({id:"new-party",name:"New Counter Party"}));
  expect(state.masterSaves).toBe(1);
  expect((screen.getByRole("textbox",{name:"Current invoice number"}) as HTMLInputElement).value).toBe("ORIGINAL-55");
 });
 it("opens complex account master separately and refreshes options without leaving the invoice",async()=>{
  const opener=vi.fn(()=>({opener:null}));
  vi.stubGlobal("open",opener);
  const refresh=vi.fn(async()=>{});
  render(<><input defaultValue="P-2026-01" aria-label="Supplier invoice number"/>
   <QuickMasterAdd kind="account" onRefresh={refresh}/></>);
  fireEvent.click(screen.getByRole("button",{name:"Add new Account"}));
  expect(opener).toHaveBeenCalledWith("/accounting/accounts","_blank");
  fireEvent.click(screen.getByRole("button",{name:"Refresh Account options"}));
  await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));
  expect((screen.getByRole("textbox",{name:"Supplier invoice number"}) as HTMLInputElement).value).toBe("P-2026-01");
 });
 it("blocks + New on posted or locked forms",()=>{
  const selected=vi.fn();
  render(<QuickMasterAdd kind="supplier" disabled onCreated={selected}/>);
  expect((screen.getByRole("button",{name:"Add new Supplier"}) as HTMLButtonElement).disabled).toBe(true);
 });
 it("rejects stale scope selection when company switches during an open popup",async()=>{
  const selected=vi.fn();
  const view=render(<QuickMasterAdd kind="supplier" onCreated={selected}/>);
  fireEvent.click(screen.getByRole("button",{name:"Add new Supplier"}));
  await screen.findByRole("dialog",{name:"Create supplier"});
  state.company="company-B";
  view.rerender(<QuickMasterAdd kind="supplier" onCreated={selected}/>);
  expect(screen.queryByRole("dialog",{name:"Create supplier"})).toBeNull();
  expect(selected).not.toHaveBeenCalled();
 });
});
