// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import SearchableSelect from "./SearchableSelect";

afterEach(cleanup);

describe("SearchableSelect global interaction contract",()=>{
 it("keeps the portal open while filtering and wheel-scrolling, then selects",()=>{
  const change=vi.fn();
  render(<SearchableSelect value="" onChange={change}><option value="">Select item</option><option value="girder">Girder</option><option value="beam">Steel Beam</option></SearchableSelect>);
  const trigger=screen.getByRole("button",{name:/select item/i});
  vi.spyOn(trigger.parentElement!,"getBoundingClientRect").mockReturnValue({left:20,top:20,right:320,bottom:52,width:300,height:32,x:20,y:20,toJSON:()=>({})});
  fireEvent.click(trigger);
  const search=screen.getByPlaceholderText("Type to search...");
  fireEvent.change(search,{target:{value:"beam"}});
  expect(screen.getByRole("option",{name:"Steel Beam"})).toBeTruthy();
  const list=screen.getByRole("listbox");
  fireEvent.wheel(list,{deltaY:120});
  fireEvent.scroll(list);
  expect(screen.getByPlaceholderText("Type to search...")).toBeTruthy();
  fireEvent.click(screen.getByRole("option",{name:"Steel Beam"}));
  expect(change).toHaveBeenCalledTimes(1);
  expect(change.mock.calls[0][0].target.value).toBe("beam");
 });
});

 it("preserves invoice numbers when requested and leaves master labels unchanged",()=>{
  const {rerender}=render(<SearchableSelect preserveLabel value="invoice"><option value="invoice">TR-000001 — Outstanding Rs. 1,500.00</option></SearchableSelect>);
  expect(screen.getByRole("button",{name:/TR-000001/})).toBeTruthy();
  rerender(<SearchableSelect value="invoice"><option value="invoice">TR-000001 — Outstanding Rs. 1,500.00</option></SearchableSelect>);
  expect(screen.getByRole("button",{name:/Outstanding Rs/}).textContent).not.toContain("TR-000001");
 });


describe("native form compatibility",()=>{
 it("retains required validation and form values while presenting searchable options",()=>{
  render(<form data-testid="form"><label htmlFor="required-party">Party</label><SearchableSelect nativeCompatibility id="required-party" name="party" required defaultValue=""><option value="">Select party</option><option value="steel">Steel Works</option></SearchableSelect></form>);
  const form=screen.getByTestId("form") as HTMLFormElement;
  expect(form.checkValidity()).toBe(false);
  fireEvent.change(form.querySelector("select")!,{target:{value:"steel"}});
  expect(form.checkValidity()).toBe(true);
  expect(new FormData(form).get("party")).toBe("steel");
 });
});
