import {describe,it,expect} from "vitest";
import {canReversePostedManualJournal as mayReverse} from "./journalPostedActionPolicy";

describe("posted journal manual reversal action",()=>{
  it("only exposes supported original manual journal types",()=>{
    expect(mayReverse({status:"posted",trans_type:"Manual Journal",entry_no:"JE-10"})).toBe(true);
    expect(mayReverse({status:"posted",trans_type:"Journal Entry",entry_no:"JE-12"})).toBe(true);
    expect(mayReverse({status:"posted",trans_type:null,entry_no:"JE-13"})).toBe(true);
    expect(mayReverse({status:"posted",trans_type:"General",entry_no:"JE-20"})).toBe(false);
    expect(mayReverse({status:"posted",trans_type:"Supplier Payment",entry_no:"SP-20"})).toBe(false);
  });
  it("never proposes reversal for generated, already reversed or closed documents",()=>{
    const base={status:"posted",trans_type:"Manual Journal",entry_no:"JE-10"};
    expect(mayReverse({...base,source_module:"transport"})).toBe(false);
    expect(mayReverse({...base,source_document_type:"invoice"})).toBe(false);
    expect(mayReverse({...base,source_document_id:"doc-1"})).toBe(false);
    expect(mayReverse({...base,reversal_of_entry_id:"original"})).toBe(false);
    expect(mayReverse({...base,fiscal_year_closure_id:"closure"})).toBe(false);
    expect(mayReverse({...base,monthly_profit_closure_id:"month"})).toBe(false);
    expect(mayReverse({...base,entry_no:"COB-10"})).toBe(false);
    expect(mayReverse({...base,entry_no:"REV-JE-10"})).toBe(fal¶»§q«^