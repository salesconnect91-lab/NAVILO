import {beforeEach,describe,expect,it,vi} from 'vitest';
import {readExternalVehicleIncomeFast} from './externalVehicleIncomeFast';
import {externalVehicleIncome,reconcileNormalVehicleIncome} from './transportIncomeBreakdown';

type Row=Record<string,unknown>;
const mock=vi.hoisted(()=>({
 tables:{} as Record<string,Row[]>,
 queries:[] as string[],
 errorTable:'',
}));
vi.mock('@/lib/supabase',()=>({supabase:{
 from:(table:string)=>{
  mock.queries.push(table);
  const tests:Array<(row:Row)=>boolean>=[];
  const q={
   select:(_fields:string)=>q,
   eq:(field:string,value:string)=>{tests.push(row=>row[field]===value);return q;},
   in:(field:string,values:string[])=>{tests.push(row=>values.includes(String(row[field])));return q;},
   order:(_field:string,_dir?:unknown)=>q,
   range:async(start:number,end:number)=>({
    data:mock.errorTable===table?null:(mock.tables[table]||[]).filter(row=>tests.every(f=>f(row))).slice(start,end+1),
    error:mock.errorTable===table?{message:'Read blocked'}:null,
   }),
  };
  return q;
 }
}}));
const company='orbit', unit='transport', branch='head';
const src=(id:string,order:string,vehicle:string)=>({
 id,sales_line_id:'line-'+id,sales_order_id:order,vehicle_id:'v'+vehicle,vehicle_no:vehicle,
 company_id:company,business_unit_id:unit,operating_location_id:branch,
});
const base={companyId:company,businessUnitId:unit,locationId:branch,scope:'branch' as const,fromDate:'2026-01-01',toDate:'2026-10-20'};

beforeEach(()=>{
 mock.queries=[];mock.errorTable='';
 mock.tables={
  transport_external_invoice_lines:[
   src('e1','sale1','7979'),src('e2','sale2','2512'),src('e3','unposted','5731'),
   {...src('foreign','else','9999'),company_id:'other'},
  ],
  sales_service_lines:[
   {id:'line-e1',amount:'1000.00',revenue_account_id:'sales',company_id:company},
   {id:'line-e2',amount:'2500.00',revenue_account_id:'sales',company_id:company},
   {id:'line-e3',amount:'400.00',revenue_account_id:'sales',company_id:company},
  ],
  transport_customer_documents:[
   {sales_order_id:'sale1',journal_entry_id:'j1',company_id:company},
   {sales_order_id:'sale2',journal_entry_id:'j2',company_id:company},
  ],
  transport_external_credit_allocations:[],
  return_notes:[],
  journal_entries:[
   {id:'j1',entry_date:'2026-08-31',status:'posted',reversal_of_entry_id:null,company_id:company},
   {id:'j2',entry_date:'2026-09-01',status:'posted',reversal_of_entry_id:null,company_id:company},
  ],
 };
});

describe('fast external vehicle P&L via indexed, scoped source tables',()=>{
 it('attributes only posted original invoices; no heavy view query or draft/other company leakage',async()=>{
  const rows=await readExternalVehicleIncomeFast(base);
  const result=reconcileNormalVehicleIncome(3500,externalVehicleIncome(rows));
  expect(result).toMatchObject({
   vehicles:[
    {vehicle_id:'v2512',vehicle_no:'2512',amount:2500},
    {vehicle_id:'v7979',vehicle_no:'7979',amount:1000},
   ],allocated:3500,residual:0,
  });
  expect(mock.queries).not.toContain('transport_external_vehicle_contributions');
  expect(mock.queries).not.toContain('transport_vehicle_contributions');
 });
 it('keeps credit note and its reversal on the actual journal dates',async()=>{
  mock.tables.transport_external_credit_allocations=[
   {external_line_id:'e1',note_id:'note1',net_amount:'200.25',company_id:company}
  ];
  mock.tables.return_notes=[{id:'note1',journal_entry_id:'jn',status:'posted',company_id:company}];
  mock.tables.journal_entries.push(
   {id:'jn',entry_date:'2026-09-20',status:'posted',reversal_of_entry_id:null,company_id:company},
   {id:'jr',entry_date:'2026-10-01',status:'posted',reversal_of_entry_id:'jn',company_id:company},
   {id:'reverse2',entry_date:'2026-11-01',status:'posted',reversal_of_entry_id:'j2',company_id:company},
  );
  const rows=await readExternalVehicleIncomeFast(base);
  expect(rows.map(x=>Number(x.revenue))).toEqual([1000,2500,-200.25,200.25]);
  const result=reconcileNormalVehicleIncome(3500,externalVehicleIncome(rows));
  expect(result.residual).toBe(0);
  expect(rows.some(x=>x.event_id.includes('reverse2'))).toBe(false);
 });
 it('respects branch isolation and date-scoped posted journals',async()=>{
  mock.tables.journal_entries[1].entry_date='2025-12-01';
  const rows=await readExternalVehicleIncomeFast(base);
  expect(rows).toHaveLength(1);
  expect(Number(rows[0].revenue)).toBe(1000);
 });
 it('does not turn missing journal permissions into false zero income',async()=>{
  mock.errorTable='journal_entries';
  await expect(readExternalVehicleIncomeFast(base)).rejects.toThrow('Read blocked');
 });
});
