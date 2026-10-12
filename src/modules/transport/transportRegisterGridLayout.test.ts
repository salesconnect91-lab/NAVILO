import {describe,expect,it} from "vitest";
import {normalizeTransportRegisterGridLayout} from "./transportRegisterGridLayout";

const keys=["trip_no","driver","owner","company","profit","new_column"] as const;
describe("Transport Register cloud layout validation",()=>{
  it("preserves saved order while appending new columns",()=>{
    expect(normalizeTransportRegisterGridLayout(
      {order:["company","trip_no"],hidden:["owner"],widths:{company:155}},keys
    )).toEqual({
      order:["company","trip_no","driver","owner","profit","new_column"],
      hidden:["owner"],widths:{company:155}
    });
  });
  it("ignores deleted columns, duplicate names, invalid widths and injected keys",()=>{
    const result=normalizeTransportRegisterGridLayout({
      order:["trip_no","evil","trip_no","profit"],
      hidden:["evil","owner","owner"],
      widths:{evil:777,owner:-9,driver:1020,company:125.8,profit:"200"}
    },keys);
    expect(result.order).toEqual(["trip_no","profit","driver","owner","company","new_column"]);
    expect(result.hidden).toEqual(["owner"]);
    expect(result.widths).toEqual({company:126});
  });
  it("returns all columns visible with safe defaults for incomplete profiles",()=>{
    expect(normalizeTransportRegisterGridLayout(null,keys)).toEqual({order:[...keys],hidden:[],widths:{}});
    expect(normalizeTransportRegisterGridLayout({hidden:"all",widths:[]},keys))
      .toEqual({order:[...keys],hidden:[],widths:{}});
  });
});
