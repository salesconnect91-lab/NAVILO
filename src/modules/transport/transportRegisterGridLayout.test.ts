import {describe,expect,it} from "vitest";
import {fitTransportRegisterColumnWidths,normalizeTransportRegisterGridLayout} from "./transportRegisterGridLayout";

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

describe("Transport Register full width with custom visible columns",()=>{
  const keys=["trip_no","driver","company"] as const;
  const natural:Record<string,number>={trip_no:90,driver:110,company:100};
  const base=(key:string)=>natural[key];
  it("expands visible columns to the viewport while preserving minimum widths",()=>{
    const result=fitTransportRegisterColumnWidths(keys,base,{},600);
    expect(Object.values(result).reduce((a,b)=>a+b,0)).toBe(600);
    expect(result.trip_no).toBeGreaterThanOrEqual(90);
    expect(result.driver).toBeGreaterThanOrEqual(110);
  });
  it("keeps user-resized columns fixed and grows the remaining visible columns",()=>{
    const result=fitTransportRegisterColumnWidths(keys,base,{driver:110},600);
    expect(result.driver).toBe(110);
    expect(result.trip_no+result.driver+result.company).toBe(600);
  });
  it("preserves horizontal overflow when columns do not fit",()=>{
    expect(fitTransportRegisterColumnWidths(keys,base,{},220)).toEqual(natural);
  });
  it("uses only the selected visible columns and remains deterministic",()=>{
    const result=fitTransportRegisterColumnWidths(["trip_no","company"],base,{},400);
    expect(Object.keys(result)).toEqual(["trip_no","company"]);
    expect(result.trip_no+result.company).toBe(400);
    expect(fitTransportRegisterColumnWidths(["trip_no","company"],base,{},400)).toEqual(result);
  });
  it("still fills the viewport when all columns have custom widths",()=>{
    const result=fitTransportRegisterColumnWidths(["trip_no","company"],base,{trip_no:90,company:100},290);
    expect(result.trip_no+result.company).toBe(290);
  });
});
