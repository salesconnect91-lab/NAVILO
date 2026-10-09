// @vitest-environment jsdom
import {afterEach,describe,it,expect} from 'vitest';
import {collectReportPackage} from './exportUtils';
afterEach(()=>{delete document.documentElement.dataset.naviloCurrency});
describe('financial report export sources',()=>{
 it('exports only the selected scope and one visible date filter',()=>{
 const root=document.createElement('div');root.innerHTML='<label data-report-filter-label="Report scope" data-report-filter-value="Current Branch">Report Scope<select><option>Current Branch</option><option>Whole Company</option></select></label><label>As-of Date<span><input value="09-Oct-26"><input type="date" aria-hidden="true" value="2026-10-09"></span></label><table><tr><td>Balance</td></tr></table>';
 const rows=collectReportPackage(root,'Balance Sheet').sheets[0].rows;
 expect(rows.filter(row=>row[0]==='Report scope')).toEqual([['Report scope','Current Branch']]);
 expect(rows.filter(row=>row[0]==='As-of Date')).toEqual([['As-of Date','09-Oct-26']]);
 });
 it('exports configurable financial evidence once and labels the base currency',()=>{
 document.documentElement.dataset.naviloCurrency='SAR';
 const root=document.createElement('div');root.innerHTML='<details data-print-primary-source><table><thead><tr><th>Account</th><th>Amount</th></tr></thead><tbody><tr><td>AR</td><td>521755.26</td></tr></tbody></table></details><table><tr><td>AR again</td><td>SAR 521755.26</td></tr></table>';
 const report=collectReportPackage(root,'Balance Sheet',{includeFilters:false});
 expect(report.sheets).toHaveLength(2);
 expect(report.sheets[0].rows).toContainEqual(['Company base currency','SAR']);
 expect(report.sheets[1].rows).toEqual([['Account','Amount'],['AR','521755.26']]);
 });
 it('retains distinct tables when no canonical financial source is marked',()=>{
 const root=document.createElement('div');root.innerHTML='<table><tr><td>Customer A</td></tr></table><table><tr><td>Payment 1</td></tr></table>';
 expect(collectReportPackage(root,'Statement',{includeFilters:false}).sheets).toHaveLength(2);
 });
});
