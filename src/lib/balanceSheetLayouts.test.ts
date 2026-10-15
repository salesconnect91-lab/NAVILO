import {describe,expect,it} from "vitest";
import {classifiedBalanceSheetRows,classifiedBalanceSheetExport,coaBalanceSheetGroup,type StatementSection} from "./balanceSheetLayouts";
import {accountingStatementLayout} from "./accountingStatementPrint";

const sections:StatementSection[]=[
  {title:"Assets",total:430000,previousTotal:210000,groups:[
    {head:"Current Assets",total:51000,items:[
      {name:"Accounts Receivable (Total)",amount:51000,detailType:"Accounts Receivable"},
    ]},
    {head:"Non-Current Assets",total:379000,items:[
      {name:"Machinery & Equipment",amount:379000,detailType:"Machinery & Equipment"}
    ]},
  ],previousGroups:[
    {head:"Current Assets",total:10000,items:[{name:"Accounts Receivable (Total)",amount:10000,detailType:"Accounts Receivable"}]},
    {head:"Non-Current Assets",total:200000,items:[{name:"Machinery & Equipment",amount:200000,detailType:"Machinery & Equipment"}]},
  ]},
  {title:"Liabilities",total:100000,previousTotal:30000,groups:[
    {head:"Current Liabilities",total:50000,items:[{name:"Customer Advances",amount:50000,detailType:"Customer Credit Balances"}]},
    {head:"Non-Current Liabilities",total:50000,items:[{name:"Long-Term Loan",amount:50000,detailType:"long_term_loan"}]}
  ],previousGroups:[
    {head:"Current Liabilities",total:30000,items:[{name:"Customer Advances",amount:30000,detailType:"Customer Credit Balances"}]}
  ]},
  {title:"Equity",total:330000,previousTotal:180000,groups:[
    {head:"Capital & Reserves",total:330000,items:[{name:"Partner Capital",amount:330000,detailType:"owners_equity"}]}
  ],previousGroups:[
    {head:"Capital & Reserves",total:180000,items:[{name:"Partner Capital",amount:180000,detailType:"owners_equity"}]}
  ]}
];
describe("COA-driven classified balance sheet",()=>{
  it("prefers explicit current/non-current detail types over misleading names",()=>{
    expect(coaBalanceSheetGroup("asset","Nawaz Investment Principal Receivable","other_current_asset",null,["Assets"])).toBe("Current Assets");
    expect(coaBalanceSheetGroup("asset","Twakkal Profit Receivable","other_non_current_asset",null,["Assets"])).toBe("Non-Current Assets");
    expect(coaBalanceSheetGroup("liability","Twakkal Loan Payable","long_term_loan",null,["Liabilities"])).toBe("Non-Current Liabilities");
  });
  it("uses parent group for fixed assets when detail type is generic",()=>{
    expect(coaBalanceSheetGroup("asset","Equipment Holding","General",null,["Fixed Assets","Assets"])).toBe("Non-Current Assets");
    expect(coaBalanceSheetGroup("asset","Bank","General",null,["Current Assets","Assets"])).toBe("Current Assets");
    expect(coaBalanceSheetGroup("equity","Partner Capital","owners_equity",null,[])).toBe("Capital & Reserves");
  });
  it("shows current and fixed asset subtotals, preserving the accounting equation",()=>{
    const rows=classifiedBalanceSheetRows(sections,"classified");
    expect(rows.find(r=>r.account==="Subtotal Non-Current Assets")?.current).toBe(379000);
    expect(rows.find(r=>r.account==="Subtotal Current Assets")?.current).toBe(51000);
    expect(rows.find(r=>r.account==="Subtotal Non-Current Liabilities")?.current).toBe(50000);
    expect(rows.find(r=>r.account==="Total Assets")?.current).toBe(430000);
    expect(rows.find(r=>r.account==="Total Liabilities & Equity")?.current).toBe(430000);
    expect(rows.find(r=>r.kind==="check")?.current).toBe(0);
  });
  it("summary hides only details, never section/group balances",()=>{
    const rows=classifiedBalanceSheetRows(sections,"summary");
    expect(rows.filter(r=>r.kind==="detail")).toHaveLength(0);
    expect(rows.find(r=>r.account==="Subtotal Non-Current Assets")?.current).toBe(379000);
    expect(rows.find(r=>r.account==="Total Assets")?.current).toBe(430000);
  });
  it("custom mode collapses specific account detail but retains group amount",()=>{
    const rows=classifiedBalanceSheetRows(sections,"custom",{"Assets:Non-Current Assets":false});
    expect(rows.some(r=>r.account==="Machinery & Equipment")).toBe(false);
    expect(rows.find(r=>r.account==="Subtotal Non-Current Assets")?.current).toBe(379000);
    expect(rows.some(r=>r.account==="Accounts Receivable (Total)")).toBe(true);
  });
  it("detailed print/export retains category and ledger classification",()=>{
    const rows=classifiedBalanceSheetRows(sections,"detailed");
    const data=classifiedBalanceSheetExport(rows,"detailed","2026-10-15","2025-10-15");
    expect(data.columns).toEqual(["Section","Account","Classification","Amount"]);
    expect(data.rows.some(r=>r[1]==="Machinery & Equipment"&&r[2]==="Property & Equipment")).toBe(true);
    const print=accountingStatementLayout({title:"Balance Sheet",description:"As of 2026-10-15",columns:data.columns,rows:data.rows});
    expect(print.rows.some(r=>r.kind==="section"&&r.cells[0]==="Assets")).toBe(true);
    expect(print.rows.some(r=>r.cells.includes("Subtotal Non-Current Assets"))).toBe(true);
  });
  it("comparative pulls aligned prior balances into both screen and export",()=>{
    const rows=classifiedBalanceSheetRows(sections,"comparative");
    const equipment=rows.find(r=>r.account==="Machinery & Equipment");
    expect(equipment?.current).toBe(379000);
    expect(equipment?.previous).toBe(200000);
    expect(rows.find(r=>r.account==="Total Assets")?.previous).toBe(210000);
    expect(rows.find(r=>r.account==="Total Liabilities & Equity")?.previous).toBe(210000);
    const data=classifiedBalanceSheetExport(rows,"comparative","2026-10-15","2025-10-15");
    expect(data.columns).toEqual(["Section","Account","As of 2026-10-15","As of 2025-10-15"]);
    expect(data.rows.find(r=>r[1]==="Machinery & Equipment")?.slice(2)).toEqual([379000,200000]);
  });
});
