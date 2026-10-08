// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,fireEvent,screen} from '@testing-library/react';
import DataTable from '@/components/DataTable';
import {buildReport,cleanReportTable,reportFilterSnapshot,applyReportPrintSettings} from './printReport';
import {createPrintDocument,registerPrintSource} from './printDocument';
import {paginatePrintDocument,paperCSS} from './printPagination';
import PrintPreviewController from '@/components/PrintPreviewController';
vi.mock('@/lib/documentPrintSettings',()=>({loadDocumentPrintSettings:vi.fn(async()=>({company:{},visibility:{show_company_name:true,show_signatures:false}}))}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_name:'Orbit'},activeBusinessUnit:{business_unit_name:'Head Office'}})}));
vi.mock('@/lib/platformBranding',()=>({usePlatformBranding:()=>({branding:{show_branding:false}})}));
afterEach(()=>{cleanup();document.body.innerHTML='';localStorage.clear();vi.restoreAllMocks();});
if(!globalThis.CSS)Object.defineProperty(globalThis,'CSS',{value:{escape:(s:string)=>s},configurable:true});

describe('document report data contract',()=>{
 it('prints every sorted row, not the current DataTable page, and retains header labels',async()=>{
  const rows=Array.from({length:61},(_,i)=>({id:String(i),name:`Party ${String(i).padStart(2,'0')}`,amount:i}));
  const {container}=render(<main><h1>Parties</h1><DataTable showSerialNumber columns={[{key:'name',label:'Party'},{key:'amount',label:'Amount',className:'text-right'},{key:'actions',label:'Actions',render:()=> <button>Edit</button>}]} rows={rows}/></main>);
  expect(container.querySelectorAll('tbody tr').length).toBe(25);
  fireEvent.click(screen.getByRole('button',{name:'Party'}));fireEvent.click(screen.getByRole('button',{name:/Party/}));
  const report=await buildReport(container.querySelector('main')!,{companyName:'Orbit',businessUnitName:'Head Office'});
  const doc=new DOMParser().parseFromString(report.html,'text/html');
  expect(doc.querySelectorAll('tbody tr').length).toBe(61);expect(doc.querySelector('tbody tr')?.textContent).toContain('Party 60');
  expect(report.html).toContain('<th class="">Party</th>');expect(report.html).not.toContain('Edit');expect(report.html).not.toContain('Actions');
 });
 it('keeps totals and removes action controls without deleting sortable column names',()=>{
  const root=document.createElement('div');root.innerHTML='<table><thead><tr><th><button>Date</button></th><th>Amount</th><th>Actions</th></tr></thead><tbody><tr><td>01-Oct-26</td><td class="text-right">1700</td><td><button>Edit</button></td></tr></tbody><tfoot><tr><td colspan="2">Total 1700</td><td data-no-print></td></tr></tfoot></table>';
  const clean=cleanReportTable(root.querySelector('table')!);
  expect(clean.tHead?.textContent).toBe('DateAmount');expect(clean.tFoot?.textContent).toBe('Total 1700');expect(clean.querySelector('button')).toBeNull();expect(clean.tBodies[0].rows[0].cells.length).toBe(2);
 });
 it('snapshots dates and selected compatibility dropdown values before controls disappear',()=>{
  const main=document.createElement('main');main.innerHTML='<label data-report-filter-label="Report scope" data-report-filter-value="Whole Company">Scope control</label><section data-report-filters><label>From<input type="date" value="2026-10-01"></label><label>Supplier<div data-print-control="Steel"><select class="sr-only"><option selected>Steel</option></select></div></label></section><article id="report"><table></table></article>';document.body.append(main);
  expect(reportFilterSnapshot(main.querySelector('#report')!)).toEqual([{label:'From',value:'01-Oct-26'},{label:'Supplier',value:'Steel'},{label:'Report scope',value:'Whole Company'}]);
 });
 it('honors complete async report providers and rejects printing form-only screens',async()=>{
  const root=document.createElement('main');root.innerHTML='<h1>Transport</h1><section><table><tbody><tr><td>Current page</td></tr></tbody></table></section>';
  const unregister=registerPrintSource(root.querySelector('section')!,async()=>'<table><thead><tr><th>Trip</th></tr></thead><tbody><tr><td>TR-0001</td></tr><tr><td>TR-0101</td></tr></tbody></table>');
  const result=await buildReport(root,{companyName:'Orbit',businessUnitName:''});expect(result.html).toContain('TR-0101');expect(result.html).not.toContain('Current page');unregister();
  root.innerHTML='<form><input value="Private editing field"><button>Save</button></form>';
  await expect(buildReport(root,{companyName:'Orbit',businessUnitName:''})).rejects.toThrow('no document or report data');
 });
 it('opens existing voucher builders exactly once without popups or executing their scripts',()=>{
  const listener=vi.fn();window.addEventListener('navilo:print-preview',listener);const popup=vi.spyOn(window,'open');
  const print=createPrintDocument();print.document.write('<html><head><title>Voucher A</title></head><body>Voucher evidence<script>window.print()</script></body></html>');print.document.close();print.focus();print.print();
  expect(popup).not.toHaveBeenCalled();expect(listener).toHaveBeenCalledTimes(1);expect(listener.mock.calls[0][0].detail).toMatchObject({fullDocument:true});window.removeEventListener('navilo:print-preview',listener);
 });
 it('uses the hidden canonical financial report and preserves its section totals',async()=>{
  const root=document.createElement('main');root.innerHTML='<h1>Profit and Loss</h1><details class="no-print" data-print-primary-source data-report-orientation="portrait"><section></section></details><div>Screen result</div>';
  registerPrintSource(root.querySelector('section')!,async()=>'<table><thead><tr><th>Section</th><th>Amount</th></tr></thead><tbody><tr><td>Gross Profit</td><td>1700</td></tr><tr><td>Net Profit</td><td>700</td></tr></tbody></table>');
  const report=await buildReport(root,{companyName:'Orbit',businessUnitName:''},'NAVILO');expect(report.title).toBe('Profit and Loss');expect(report.orientation).toBe('portrait');expect(report.html).toContain('Gross Profit');expect(report.html).toContain('Net Profit');expect(report.html).not.toContain('Screen result');
 });
 it('replaces a table-root provider without nesting tables or retaining current-page rows',async()=>{
  const root=document.createElement('table');root.innerHTML='<tbody><tr><td>Current page only</td></tr></tbody>';
  const unregister=registerPrintSource(root,async()=>'<table><thead><tr><th>Note</th></tr></thead><tbody><tr><td>CN-0101</td></tr></tbody></table>');
  const {clonePrintSource}=await import('./printDocument');const clone=await clonePrintSource(root);expect(clone.querySelector('thead')?.textContent).toBe('Note');expect(clone.textContent).toContain('CN-0101');expect(clone.textContent).not.toContain('Current page');expect(clone.querySelectorAll('table').length).toBe(0);unregister();
 });
 it('prints live editable table values as text and formats date cells',()=>{
  const root=document.createElement('table');root.innerHTML='<thead><tr><th>Budget</th><th>Date</th></tr></thead><tbody><tr><td><input value="1700"></td><td>2026-10-08</td></tr></tbody>';
  (root.querySelector('input') as HTMLInputElement).value='1900';const clean=cleanReportTable(root);expect(clean.querySelector('tbody')?.textContent).toContain('1900');expect(clean.textContent).toContain('08-Oct-26');expect(clean.querySelector('input')).toBeNull();
 });
 it('honors company identity and signature settings while escaping their content',()=>{
  const result=applyReportPrintSettings('<article><header class="document-heading"><div><strong>Orbit</strong></div><div><small>Printed today</small></div></header><table></table></article>',{company:{address:'Office <one>',document_footer:'Controlled document'},visibility:{show_company_name:true,show_logo:false,show_address:true,show_phone_email:false,show_tax_details:false,show_print_datetime:false,show_header:false,show_footer:true,show_signatures:true} as any});
  expect(result).toContain('Office &lt;one&gt;');expect(result).not.toContain('Printed today');expect(result).toContain('Prepared By');expect(result).toContain('Controlled document');
 });
 it('does not intercept the original Print button handler',()=>{
  const handler=vi.fn();render(<><PrintPreviewController/><button onClick={handler}>Print Work Order</button></>);fireEvent.click(screen.getByRole('button',{name:'Print Work Order'}));expect(handler).toHaveBeenCalledOnce();
 });
});

describe('measured page layout',()=>{
 function layoutDoc(rows:number){const doc=document.implementation.createHTMLDocument('Report');doc.body.innerHTML=`<div class="navilo-print-output"><article><header>Orbit</header><table><thead><tr><th>Trip</th></tr></thead><tbody>${Array.from({length:rows},(_,i)=>`<tr><td>TR-${i}</td></tr>`).join('')}</tbody><tfoot><tr><td>TOTAL 1700</td></tr></tfoot></table></article></div>`;return doc;}
 it('splits between rows, repeats headers and puts totals once on the final page',()=>{
  vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockImplementation(function(this:HTMLElement){return this.classList.contains('navilo-page-body')?100:0;});
  vi.spyOn(HTMLElement.prototype,'scrollHeight','get').mockImplementation(function(this:HTMLElement){return this.classList.contains('navilo-page-body')?20+this.querySelectorAll('tbody tr,tfoot tr').length*20:0;});
  const doc=layoutDoc(9);expect(paginatePrintDocument(doc,'Orbit')).toBe(3);
  expect(doc.querySelectorAll('tbody tr').length).toBe(9);expect(doc.querySelectorAll('thead').length).toBe(3);expect(doc.querySelectorAll('tfoot').length).toBe(1);expect(doc.querySelectorAll('.navilo-paper')[2].textContent).toContain('TOTAL 1700');expect(doc.querySelectorAll('.navilo-page-footer')[2].textContent).toContain('Page 3 of 3');
 });
 it('prints payments following a split invoice table only once',()=>{
  vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype,'scrollHeight','get').mockImplementation(function(this:HTMLElement){return this.classList.contains('navilo-page-body')?20+this.querySelectorAll('tbody tr,tfoot tr').length*20:0;});
  const doc=layoutDoc(9),table=doc.querySelector('table')!,section=doc.createElement('section');table.replaceWith(section);section.append(table);const payment=doc.createElement('div');payment.textContent='PAYMENT 700';section.append(payment);
  paginatePrintDocument(doc,'Orbit');expect(doc.body.textContent?.match(/PAYMENT 700/g)).toHaveLength(1);expect(doc.querySelectorAll('tbody tr')).toHaveLength(9);
 });
 it('blocks an oversized row instead of silently clipping it',()=>{
  vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(100);vi.spyOn(HTMLElement.prototype,'scrollHeight','get').mockImplementation(function(this:HTMLElement){return this.querySelector('tbody tr')?200:0;});
  expect(()=>paginatePrintDocument(layoutDoc(1),'Orbit')).toThrow('row is taller');
 });
 it('uses explicit matching page size and zero printer margins',()=>{expect(paperCSS('A3','landscape')).toContain('size:A3 landscape;margin:0');expect(paperCSS('A4','portrait')).toContain('height:297mm');});
});
