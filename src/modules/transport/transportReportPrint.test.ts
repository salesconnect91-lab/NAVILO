// @vitest-environment jsdom
import {describe,expect,it} from 'vitest';
import {transportPrintPaper,transportPrintSections,transportPrintTotalRow,transportStandalonePrintHtml,transportRegisteredPrintMarkup} from './transportReportPrint';
import type {ReportTable} from './transportPartyExport';

const wide:ReportTable={
 title:'Transport Supplier Statement',
 description:'Orbit / Transport / active branch · Supplier 5731 · 01-Oct-26 to 31-Oct-26 · Company base currency · Totals cover the complete filter.',
 columns:['Trip','Date','Document','Supplier','Net','VAT','Gross','Paid','Outstanding','Charges','From','To','Vehicle','Driver','Notes','Credit'],
 rows:[['T-001','01-Oct-26','INV-01','ABC',1700,255,1955,1000,955,400,'Dammam','Riyadh','5731','Ali','Waiting charge as agreed',0],['TOTAL · full filter','','','',1700,255,1955,1000,955,400,'','','','','',0]],
};

describe('Transport financial print output',()=>{
 it('preserves each source field and amount, with no recalculation or omitted columns',()=>{
  const parts=transportPrintSections(wide);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts[0].columns).toContain('Outstanding');
  expect(new Set(parts.flatMap(p=>p.indexes)).size).toBe(wide.columns.length);
  expect(parts.every(part=>part.rows.length===2)).toBe(true);
  parts.forEach(part=>part.indexes.forEach((idx,pos)=>expect(part.rows[0][pos]).toBe(wide.rows[0][idx])));
 });
 it('splits ten-column statements into readable print sections without dropping data',()=>{
  const source:ReportTable={title:'Compact statement',description:'Test',
   columns:['Date','Party','Reference','Description','Debit','Credit','Balance','Trip','From','To'],
   rows:[['19-Jul-24','ACCESS','INV-27','Sale',7590,0,7590,'T-1','Dammam','Riyadh']]};
  const sections=transportPrintSections(source);
  expect(sections.length).toBeGreaterThan(1);
  expect(sections.every(section=>section.columns.length<=9)).toBe(true);
  expect(new Set(sections.flatMap(section=>section.indexes)).size).toBe(10);
 });
 it('uses A4 portrait for narrow tables, and A3 landscape for very wide source tables',()=>{
  expect(transportPrintPaper(3)).toEqual({paper:'a4',orientation:'portrait'});
  expect(transportPrintPaper(9)).toEqual({paper:'a4',orientation:'landscape'});
  expect(transportPrintPaper(20)).toEqual({paper:'a3',orientation:'landscape'});
 });
 it('prints financial totals as a footer with repeated table headers and escaped business text',()=>{
  const html=transportStandalonePrintHtml({...wide,title:'Transport <test>'},new Date('2026-10-14T10:00:00+03:00'));
  const doc=new DOMParser().parseFromString(html,'text/html');
  expect(doc.title).toBe('Transport <test>');
  expect(html).toContain('&lt;test&gt;');
  expect(doc.querySelectorAll('table').length).toBeGreaterThan(1);
  expect(doc.querySelectorAll('thead tr').length).toBe(doc.querySelectorAll('table').length);
  expect(doc.querySelectorAll('tfoot tr').length).toBe(doc.querySelectorAll('table').length);
  expect(html).toContain('1,700.00');expect(html).toContain('955.00');
  expect(html).toContain('Waiting charge as agreed');
  expect(html).not.toContain('Totals cover');
  expect(html).toContain('size:A3 landscape');
 });
 it('feeds the global print pipeline the full report rather than the visible 100-row UI page',()=>{
  const html=transportRegisteredPrintMarkup(wide);
  const doc=new DOMParser().parseFromString(html,'text/html');
  expect(doc.querySelector('[data-print-primary-source]')).not.toBeNull();
  expect(doc.querySelectorAll('tfoot tr').length).toBeGreaterThan(1);
  expect(html).toContain('INV-01');
  expect(html).toContain('data-print-report-title="Transport Supplier Statement"');
 });
 it('shows explicit company and business unit in standalone financial documents',()=>{
  const html=transportStandalonePrintHtml({...wide,description:'As of 14-Oct-26'},new Date('2026-10-14T10:00:00+03:00'),{companyName:'Orbit',businessUnitName:'Head Office'});
  expect(html).toContain('<div class="trp-brand">Orbit</div>');
  expect(html).toContain('<div class="trp-company">Head Office</div>');
 });
 it('does not treat opening balances or ordinary party names as totals',()=>{
  expect(transportPrintTotalRow(['Opening',0])).toBe(false);
  expect(transportPrintTotalRow(['Total Logistics Company',1700])).toBe(false);
  expect(transportPrintTotalRow(['TOTAL / Closing',1700])).toBe(true);
  expect(transportPrintTotalRow(['','TOTAL / Closing',1700])).toBe(true);
 });
});
