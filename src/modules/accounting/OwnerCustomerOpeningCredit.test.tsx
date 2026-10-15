// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import OwnerOpeningAccountCorrection from "./OwnerOpeningAccountCorrection";
const mocks = vi.hoisted(() => ({
  isOwner: true,
  rpc: vi.fn(),
  completed: vi.fn(async () => {}),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));
afterEach(() => { cleanup(); mocks.rpc.mockReset(); mocks.completed.mockReset(); mocks.isOwner = true; vi.restoreAllMocks(); });
const accounts = [
  { id:"old-2007",code:"2007",name:"Cash Customer",type:"asset",is_active:true,is_group:false,is_system_account:false },
  { id:"ar-1130",code:"1130",name:"Accounts Receivable",type:"asset",is_active:true,is_group:false,is_system_account:true },
];
function setupRpc() {
  mocks.rpc.mockImplementation(async (name:string, args?:Record<string,unknown>) => {
    if(name==="owner_posted_control_access") return { data:mocks.isOwner, error:null };
    if(name==="owner_correct_customer_opening_credit") {
      return {data:args?.p_preview ? {
        eligible:true,old_account:"2007 - Cash Customer",customer:"Cash Customer",opening_credit:11200,
        ar_account:"1130 - Accounts Receivable",original_opening_journal:"opening-entry",
        note:"Correct with compensating journal."
      } : { success:true,opening_credit:11200 },error:null};
    }
    throw new Error("Unexpected RPC "+name);
  });
}
it("keeps the customer opening credit correction owner-only",async()=>{
  mocks.isOwner=false; setupRpc();
  render(<OwnerOpeningAccountCorrection accounts={accounts} onCompleted={mocks.completed}/>);
  await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledWith("owner_posted_control_access"));
  expect(screen.queryByRole("button",{name:"Correct Opening Account"})).toBeNull();
});
it("searches original opening account, previews credit, and only changes after owner confirmation",async()=>{
  setupRpc();vi.spyOn(window,"confirm").mockReturnValue(true);
  render(<OwnerOpeningAccountCorrection accounts={accounts} onCompleted={mocks.completed}/>);
  fireEvent.click(await screen.findByRole("button",{name:"Correct Opening Account"}));
  expect(screen.getByRole("button",{name:"Customer Opening Credit"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Wrong Opening Credit Account"}));
  fireEvent.change(screen.getByPlaceholderText("Search account name or code..."),{target:{value:"2007"}});
  fireEvent.click(screen.getByRole("option",{name:"2007 · Cash Customer"}));
  const customer=screen.getByPlaceholderText("Cash Customer") as HTMLInputElement;
  expect(customer.value).toBe("Cash Customer");
  const reason=screen.getByPlaceholderText("Credit opening belongs to customer, mistakenly created as an Asset ledger.") as HTMLTextAreaElement;
  fireEvent.change(reason,{target:{value:"Correct the customer opening advance credit."}});
  expect(screen.getByRole("button",{name:"Confirm Owner Credit Correction"}).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Preview Credit Correction"}));
  expect(await screen.findByText("Eligibility verified")).toBeTruthy();
  await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledWith("owner_correct_customer_opening_credit",expect.objectContaining({
    p_account_id:"old-2007",p_customer_name:"Cash Customer",p_preview:true
  })));
  fireEvent.click(screen.getByRole("button",{name:"Confirm Owner Credit Correction"}));
  await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledWith("owner_correct_customer_opening_credit",expect.objectContaining({
    p_account_id:"old-2007",p_preview:false
  })));
  await waitFor(()=>expect(mocks.completed).toHaveBeenCalledTimes(1));
});
