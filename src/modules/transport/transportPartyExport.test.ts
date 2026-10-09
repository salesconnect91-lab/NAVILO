// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {exportPartyReport} from './transportPartyExport';
async function capture(columns:string[]){
 let html='';const listener=(event:Event)=>{html=(event as CustomEvent).detail.html};
 window.addEventListener('navilo:print-preview',listener);
 try {await exportPartyReport({title:'Customer Statement',description:'Orbit · 01-Oct-26 to 31-Oct-26 · Canonical posted ledger · Totals cover the complete filter.',columns,rows:[['Waiting charge as agreed',400,400]]},'print');return html}finally{window.removeEventListener('navilo:print-preview',listener)}
}
it('uses A4 portrait for short reports and excludes technical metadata without losing transaction remarks',async()=>{
 const html=await capture(['Description','Debit','Balance']);
 expect(html).toContain('size:A4 portrait');expect(html).toContain('01-Oct-26 to 31-Oct-26');
 expect(html).not.toContain('Canonical posted');expect(html).not.toContain('Totals cover');
 expect(html).toContain('Waiting charge as agreed');expect(html).toContain('400.00');
});
it('uses A3 landscape only for wide reports',async()=>{expect(await capture(Array.from({length:20},(_,i)=>'Column '+i))).toContain('size:A3 landscape')});
