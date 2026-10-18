// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {financialMatrixPrint} from './financialMatrixPrint';
describe('shared invoice and aging financial print',()=>{
 it('splits wide source into readable sections and retains original amounts and fields',()=>{
  const cols=['Customer','Invoice No','Invoice Date','Document Type','Payment Mode','Salesperson','Due Date','Invoice Amount','Received','Balance Due','Payment Status','Invoice Age Days','Overdue Days','Aging Bucket','Aging Status'];
  const values=['ACCESS','INV-100','2024-07-19','Sales','Credit','Agent','2024-08-19',7590,1200,6390,'Partial',10,0,'0-30','Current'];
  const html=financialMatrixPrint('Customer invoice aging','ACCESS',[{title:'Invoices',matrix:[cols,values]}]);
  const doc=new DOMParser().parseFromString(html,'text/html');
  const tables=[...doc.querySelectorAll('table')];
  expect(tables.length).toBeGreaterThan(1);
  expect(tables.every(t=>t.querySelectorAll('thead th').length<=9)).toBe(true);
  const headings=tables.flatMap(t=>[...t.querySelectorAll('thead th')].map(c=>c.textContent));
  expect(new Set(headings).size).toBe(cols.length);
  expect(html).toContain('7,590.00');
  expect(html).toContain('1,200.00');
  expect(html).toContain('ACCESS');
 });
 it('prints empty aging reports with meaningful no-record statement without guessing missing values',()=>{
  const html=financialMatrixPrint('Supplier Aging','All dates',[{title:'Details',matrix:[['Supplier','Debit','Credit']]}]);
  expect(html).toContain('No records for the selected filters.');
 });
 it('escapes filter labels, names and any untrusted invoice descriptions',()=>{
  const html=financialMatrixPrint('Aging <test>','<script>evil</script>',[
   {title:'Detail',matrix:[['Reference','Amount'],['<img src=x>',100]]}
  ]);
  expect(html).toContain('&lt;img src=x&gt;');
  expect(html).not.toContain('<script>');
 });
});
