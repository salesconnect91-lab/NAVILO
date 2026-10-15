import {describe,expect,it} from 'vitest';
import {accountingStatementLayout,accountingStatementMarkup,accountingStandalonePrintHtml} from './accountingStatementPrint';

describe('professional accounting statement print layout',()=>{
 it('groups Balance Sheet headings without changing account balances or equation difference',()=>{
  const source={
   title:'Balance Sheet',description:'As of 2026-10-15 · Canonical posted ledger',
   columns:['Section','Account','Amount'],
   rows:[['Assets','Cash',1500],['Assets','Bank',800],['Liabilities','Payables',700],['Equity','Capital',1600],['Total','Assets',2300],['Total','Liabilities',700],['Total','Equity',1600],['Total','Liabilities and Equity',2300],['Check','Equation difference',0]],
  };
  const layout=accountingStatementLayout(source);
  expect(layout.orientation).toBe('portrait');
  expect(layout.columns).toEqual(['Account','Amount']);
  expect(layout.rows.filter(r=>r.kind==='section').map(r=>r.cells[0])).toEqual(['Assets','Liabilities','Equity']);
  expect(layout.rows.filter(r=>r.kind!=='section').map(r=>r.cells[1])).toEqual(source.rows.map(r=>r[2]));
  expect(layout.rows.find(r=>r.kind==='check')?.cells).toEqual(['Equation difference',0]);
  const markup=accountingStatementMarkup(source);
  expect(markup).toContain('acct-total');expect(markup).toContain('acct-section');
  expect(markup).toContain('2,300.00');expect(markup).not.toContain('Canonical posted ledger');
 });
 it('renders P&L section subtotals and profit results as financial statement rows',()=>{
  const layout=accountingStatementLayout({
   title:'Profit and Loss',description:'01-Oct-26 to 15-Oct-26',
   columns:['Section','Account','Amount'],
   rows:[['Operating Revenue','Sales',900],['Operating Revenue','Section total',900],['Result','Gross Profit / Loss',700],['Operating Expenses','Rent',200],['Operating Expenses','Section total',200],['Result','Net Profit / Loss',500]],
  });
  expect(layout.rows.filter(r=>r.kind==='subtotal').map(r=>r.cells)).toEqual([
   ['Total Operating Revenue',900],['Total Operating Expenses',200]]);
  expect(layout.rows.filter(r=>r.kind==='total').map(r=>r.cells[1])).toEqual([700,500]);
  expect(layout.rows.filter(r=>r.kind==='section').map(r=>r.cells[0])).toEqual(['Operating Revenue','Operating Expenses']);
 });
 it('keeps Trial Balance every debit/credit column and switches to landscape',()=>{
  const layout=accountingStatementLayout({
   title:'Trial Balance',description:'01-Oct-26 to 15-Oct-26',
   columns:['Account','Opening debit','Opening credit','Period debit','Period credit','Closing debit','Closing credit'],
   rows:[['Cash',100,0,50,0,150,0],['TOTAL',100,0,50,0,150,0]],
  });
  expect(layout.orientation).toBe('landscape');
  expect(layout.columns).toHaveLength(7);
  expect(layout.rows[1]).toMatchObject({kind:'total',cells:['TOTAL',100,0,50,0,150,0]});
 });
 it('uses the active company and escapes unsafe text in standalone print',()=>{
  const html=accountingStandalonePrintHtml({
   title:'Cash Flow Statement',description:'2026-10-01 to 2026-10-15',
   columns:['Activity','Posted vouchers','Cash movement'],
   rows:[['Closing cash and bank','',2300]],
  },{companyName:'Orbit <unsafe>',businessUnitName:'Head Office'},new Date('2026-10-15T09:00:00Z'));
  expect(html).toContain('Orbit &lt;unsafe&gt;');
  expect(html).toContain('accounting-statement-table');
  expect(html).toContain('acct-total');
  expect(html).toContain('2,300.00');
 });
});