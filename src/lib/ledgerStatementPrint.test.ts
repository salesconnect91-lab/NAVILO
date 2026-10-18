import {describe,expect,it} from 'vitest';
import {ledgerStatementPrintMarkup} from './ledgerStatementPrint';
const row={date:'19-Jul-24',party:'ACCESS',reference:'2024-02747',description:'Sales Invoice 2024-02747',debit:7590,credit:0,balance:'7,590.00 Dr'};
describe('professional ledger print and PDF presentation',()=>{
 it('keeps financial columns legible instead of printing 20 mostly empty Trip columns',()=>{
  const html=ledgerStatementPrintMarkup([row],{title:'Party Statement',period:'01-Jan-24 to 18-Oct-26',companyName:'Test Transport',partySelected:true,totalDebit:7590,totalCredit:0,openingBalance:'0.00',closingBalance:'7,590.00 Dr'});
  const financial=html.match(/class="accounting-statement-table navilo-ledger-financial-table"[\s\S]*?<\/table>/)?.[0]||'';
  expect(financial.match(/<th scope="col">/g)?.length).toBe(6);
  expect(financial).toContain('7,590.00');
  expect(financial).toContain('Opening Balance');
  expect(financial).toContain('Period Total');
  expect(financial).not.toContain('<th scope="col">Vehicle');
  expect(html).not.toContain('Trip / Invoice Details');
 });
 it('prints Trip context in supporting section without multiplying posted debit/credit',()=>{
  const html=ledgerStatementPrintMarkup([{...row,trip:'T-100',vehicle:'7979',from:'Dammam',to:'Riyadh',invoice:'INV-1'}],{title:'Party Statement',period:'2026',partySelected:false,totalDebit:7590,totalCredit:0});
  expect(html).toContain('Trip / Invoice Details');
  expect(html).toContain('T-100');
  expect(html).toContain('posted ledger evidence');
 });
 it('never injects company, party or description HTML into printed markup',()=>{
  const html=ledgerStatementPrintMarkup([{...row,description:'<script>evil</script>',party:'<bad>'}],{title:'Party',companyName:'<img>',period:'2026',partySelected:false,totalDebit:7590,totalCredit:0});
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img>');
 });
 it('labels General Ledger Account correctly and hides empty reference column',()=>{
  const html=ledgerStatementPrintMarkup([{...row,reference:'',party:'Cash'}],{title:'General Ledger',period:'2026',partySelected:false,groupLabel:'Account',totalDebit:7590,totalCredit:0});
  const fin=html.match(/class="accounting-statement-table navilo-ledger-financial-table"[\s\S]*?<\/table>/)?.[0]||'';
  expect(fin).toContain('<th scope="col">Account</th>');
  expect(fin).not.toContain('<th scope="col">Reference</th>');
  expect(fin.match(/<th scope="col">/g)?.length).toBe(6);
 });
});
