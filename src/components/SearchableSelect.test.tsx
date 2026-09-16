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
