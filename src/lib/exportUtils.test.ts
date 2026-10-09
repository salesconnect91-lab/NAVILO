// @vitest-environment jsdom
import {afterEach,describe,it,expect} from 'vitest';
import {collectReportPackage} from './exportUtils';
afterEach(()=>{delete document.documentElement.dataset.naviloCurrency});
describe('financial report export sources',()=>{
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
