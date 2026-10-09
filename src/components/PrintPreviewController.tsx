import {loadDocumentPrintSettings} from "@/lib/documentPrintSettings";
import SearchableSelect from "@/components/SearchableSelect";
import {useEffect, useRef, useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {usePlatformBranding} from '@/lib/platformBranding';
import {buildReport, applyReportPrintSettings, REPORT_DOCUMENT_CSS, PRINT_COMPACT_CSS} from '@/lib/printReport';
import {clonePrintSource, escapePrintHtml, type PrintRequest, type PrintPaper, type PrintOrientation} from '@/lib/printDocument';
import {paginatePrintDocument, paperCSS, paperDimensions} from '@/lib/printPagination';

type Preview = {id:number; html:string; styles:string; title:string; paper:PrintPaper; orientation:PrintOrientation; footer:string};
function printTarget(selector?:string) {
  if (selector) return document.querySelector<HTMLElement>(selector);
  const candidates=Array.from(document.querySelectorAll<HTMLElement>('.print-document'));
  if(candidates.length===1)return candidates[0];
  return document.querySelector<HTMLElement>('[data-print-root]') || document.querySelector<HTMLElement>('.print-report') || document.querySelector<HTMLElement>('main');
}
function sanitize(root:HTMLElement) {
  root.querySelectorAll('script,iframe,object,embed,button,input,select,textarea,[data-no-print],.no-print,.print\\:hidden,nav,aside').forEach(n=>n.remove());
  [root,...Array.from(root.querySelectorAll<HTMLElement>('*'))].forEach(el=>{
    Array.from(el.attributes).forEach(a=>{if(/^on/i.test(a.name)||((a.name==='src'||a.name==='href')&&/^javascript:/i.test(a.value)))el.removeAttribute(a.name);});
  });
}
export function brandStandaloneDocument(root: HTMLElement, companyName: string, businessUnitName: string) {
  const brand=root.querySelector<HTMLElement>('.brand');
  if(brand && /^NAVILO(?: ERP)?$/i.test(brand.textContent?.trim()||'')) {
    brand.textContent=companyName;
    if(businessUnitName){const unit=document.createElement('div');unit.className='sub';unit.textContent=businessUnitName;brand.after(unit);}
  }
  if(root.querySelector('.print-company,.brand,.logo'))return;
  const identity=document.createElement('div');identity.className='document-identity';identity.style.cssText='font:10pt Arial;margin-bottom:3mm';identity.textContent=[companyName,businessUnitName].filter(Boolean).join(' · ');
  (root.querySelector('.sheet,.gp-doc')||root).prepend(identity);
}
export function collectDocumentPrintStyles() {
  return Array.from(document.styleSheets).map(sheet=>{
    try {return `<style>${Array.from(sheet.cssRules).map(rule=>rule.cssText).join('\n')}</style>`;}
    catch {return sheet.ownerNode instanceof Element?sheet.ownerNode.outerHTML:'';}
  }).join('');
}
function printableStyles(markup:string) {
  // The preview and final print both use these rules, rather than screen CSS in one and print CSS in the other.
  return markup.replace(/@media\s+print\b/gi,'@media all');
}
export async function waitForDocumentAssets(doc:Document) {
  await Promise.all(Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')).map(link=>link.sheet?Promise.resolve():new Promise<void>(resolve=>{
    const done=()=>resolve();link.addEventListener('load',done,{once:true});link.addEventListener('error',done,{once:true});window.setTimeout(done,4000);
  })));
  await Promise.all(Array.from(doc.images).map(img=>img.complete?Promise.resolve():new Promise<void>(resolve=>{
    const done=()=>resolve();img.addEventListener('load',done,{once:true});img.addEventListener('error',done,{once:true});window.setTimeout(done,4000);
  })));
  if(doc.fonts?.ready)await Promise.race([doc.fonts.ready,new Promise(resolve=>window.setTimeout(resolve,4000))]);
  await new Promise<void>(resolve=>window.setTimeout(resolve,50));
}
function documentMarkup(preview:Preview) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><base href="${escapePrintHtml(document.baseURI)}"><title>${escapePrintHtml(preview.title)}</title>${printableStyles(preview.styles)}<style>${PRINT_COMPACT_CSS}
${paperCSS(preview.paper,preview.orientation)}</style></head><body><div class="navilo-print-output navilo-${preview.orientation}">${preview.html}</div></body></html>`;
}
export default function PrintPreviewController() {
  const {activeCompany,activeBusinessUnit}=useAuth();const {branding}=usePlatformBranding();
  const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pageCount,setPageCount]=useState(0),[page,setPage]=useState(1);
  const [readyHtml,setReadyHtml]=useState('');
  const frameRef=useRef<HTMLIFrameElement>(null),requestRef=useRef(0),printFrames=useRef(new Set<HTMLIFrameElement>());
  const companyName=activeCompany?.company_name||'ERP',businessUnitName=activeBusinessUnit?.business_unit_name||'';
  const platformName=branding.show_branding&&branding.show_on_prints?branding.erp_name||'NAVILO':'';

  useEffect(()=>{
    const nativePrint=window.print;
    const open=async(detail:PrintRequest={})=>{
      const request=++requestRef.current;setBusy(true);setError('');setReadyHtml('');setPageCount(0);setPage(1);
      try {
        let result:Preview;
        if(detail.html){
          const parsed=new DOMParser().parseFromString(detail.html,'text/html');
          const wrapper=document.createElement('div');wrapper.innerHTML=detail.fullDocument?parsed.body.innerHTML:detail.html;sanitize(wrapper);
          const embeddedStyles=Array.from(parsed.querySelectorAll('style')).map(n=>n.outerHTML).join('');
          wrapper.querySelectorAll('style,link').forEach(n=>n.remove());
          const styles=detail.fullDocument?embeddedStyles:`<style>${REPORT_DOCUMENT_CSS}</style>${embeddedStyles}`;
          const pageRule=styles.match(/@page\s*\{[^}]*size\s*:\s*(A3|A4|Letter)\s*(portrait|landscape)?/i);
          const title=detail.title||parsed.title||'Document';
          result={id:request,html:wrapper.innerHTML,styles,title,paper:detail.paper||(pageRule?.[1]?.toLowerCase()==='letter'?'Letter':pageRule?.[1]?.toUpperCase()==='A3'?'A3':'A4'),orientation:detail.orientation||(pageRule?.[2]?.toLowerCase()==='landscape'?'landscape':'portrait'),footer:title};
          if(detail.fullDocument){brandStandaloneDocument(wrapper,companyName,businessUnitName);result.html=wrapper.innerHTML;}
        }else{
          const target=printTarget(detail.selector);if(!target)throw new Error('Open a document or report to print.');
          // Take the source snapshot before React hides a temporary invoice print root.
          const isDocument=target.matches('.print-document')||Boolean(target.querySelector('.print-document'));
          if(isDocument){
            const [clone,settings]=await Promise.all([clonePrintSource(target.matches('.print-document')?target:target.querySelector<HTMLElement>('.print-document')!),loadDocumentPrintSettings(target.textContent?.toLowerCase().includes('purchase')?'purchase':'sales_invoice')]);sanitize(clone);
            const styles=collectDocumentPrintStyles();
            const title=[clone.querySelector('.print-voucher-title,h2')?.textContent?.trim(),clone.querySelector('.print-meta-value')?.textContent?.trim()].filter(Boolean).join(' · ')||detail.title||'Document';
            result={id:request,html:clone.outerHTML,styles,title,paper:detail.paper||(settings.company.page_size==='Letter'?'Letter':settings.company.page_size==='A3'?'A3':'A4'),orientation:detail.orientation||(settings.company.page_orientation==='landscape'?'landscape':'portrait'),footer:title};
          }else{
            const [report,settings]=await Promise.all([buildReport(target,{companyName,businessUnitName,platformName},detail.title),loadDocumentPrintSettings('reports')]);
            report.html=applyReportPrintSettings(report.html,settings);
            result={id:request,...report,styles:`<style>${REPORT_DOCUMENT_CSS}</style>`,paper:detail.paper||(settings.company.page_size==='Letter'?'Letter':settings.company.page_size==='A3'?'A3':'A4'),orientation:detail.orientation||report.orientation,footer:[companyName,businessUnitName,platformName?`Powered by ${platformName}`:''].filter(Boolean).join(' · ')};
          }
        }
        if(request===requestRef.current)setPreview(result);
      }catch(e){if(request===requestRef.current){setPreview(null);setBusy(false);setError(e instanceof Error?e.message:'Unable to prepare print document.');}}
    };
    const openNative=()=>{void open();};
    const onRequest=(event:Event)=>{void open((event as CustomEvent<PrintRequest>).detail||{});};
    window.print=openNative;window.addEventListener('navilo:print-preview',onRequest);
    return()=>{requestRef.current++;window.removeEventListener('navilo:print-preview',onRequest);if(window.print===openNative)window.print=nativePrint;};
  },[companyName,businessUnitName,platformName]);
  const close=()=>{requestRef.current++;setPreview(null);setBusy(false);setError('');setReadyHtml('');};
  useEffect(()=>{if(!preview&&!busy&&!error)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')close();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[preview,busy,error]);
  useEffect(()=>()=>{printFrames.current.forEach(frame=>frame.remove());printFrames.current.clear();},[]);

  const layout=async()=>{
    const frame=frameRef.current,doc=frame?.contentDocument,request=requestRef.current;
    if(!doc||!preview)return;
    try{
      await waitForDocumentAssets(doc);if(request!==requestRef.current||frame!==frameRef.current)return;
      const count=paginatePrintDocument(doc,preview.footer);
      // Never silently clip an over-wide invoice/report.
      if(Array.from(doc.querySelectorAll<HTMLElement>('.navilo-page-body')).some(body=>body.scrollWidth>body.clientWidth+3))throw new Error('The document is too wide for this paper. Select landscape or A3 and preview again.');
      setPageCount(count);setReadyHtml(`<!doctype html>${doc.documentElement.outerHTML}`);setBusy(false);
    }catch(e){if(request===requestRef.current){setError(e instanceof Error?e.message:'Unable to lay out document pages.');setBusy(false);setReadyHtml('');}}
  };
  const changeLayout=(paper:PrintPaper,orientation:PrintOrientation)=>{if(!preview)return;requestRef.current++;setBusy(true);setError('');setReadyHtml('');setPageCount(0);setPage(1);setPreview({...preview,id:requestRef.current,paper,orientation});};
  const printNow=()=>{
    if(!readyHtml||busy)return;
    const frame=document.createElement('iframe');frame.setAttribute('aria-hidden','true');frame.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;border:0';printFrames.current.add(frame);
    const cleanup=()=>{frame.remove();printFrames.current.delete(frame);};
    frame.onload=async()=>{const doc=frame.contentDocument;if(!doc){cleanup();return;}await waitForDocumentAssets(doc);const view=frame.contentWindow;if(!view){cleanup();return;}view.addEventListener('afterprint',cleanup,{once:true});view.focus();view.print();window.setTimeout(cleanup,120000);};
    frame.srcdoc=readyHtml;document.body.appendChild(frame);
  };
  if(!preview&&!busy&&!error)return null;
  const [width]=paperDimensions(preview?.paper||'A4',preview?.orientation||'portrait');
  return <div className="fixed inset-0 z-[100000] flex flex-col bg-slate-950/80 p-3 md:p-5" data-no-bilingual data-navilo-print-preview role="dialog" aria-modal="true" aria-label="Print Preview">
    <div className="mx-auto mb-2 flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 rounded-lg border bg-white px-4 py-2">
      <div><div className="text-sm font-bold">Print Preview · {preview?.title||(error?'Document unavailable':'Preparing document')}</div><div className="text-[11px] text-slate-500">{error?'Preview could not be prepared':pageCount?`${pageCount} page(s) · Preview and print use the same document`: 'Preparing page layout…'}</div></div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs">Paper <SearchableSelect preserveLabel wrapperClassName="inline-block w-20" aria-label="Print paper size" className="rounded border p-1" disabled={!preview||busy} value={preview?.paper||'A4'} onChange={e=>changeLayout(e.target.value as PrintPaper,preview!.orientation)}><option>A4</option><option>A3</option><option>Letter</option></SearchableSelect></label>
        <label className="text-xs">Layout <SearchableSelect preserveLabel wrapperClassName="inline-block w-28" aria-label="Print orientation" className="rounded border p-1" disabled={!preview||busy} value={preview?.orientation||'portrait'} onChange={e=>changeLayout(preview!.paper,e.target.value as PrintOrientation)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></SearchableSelect></label>
        <button className="btn-primary" disabled={!readyHtml||busy||!!error} onClick={printNow}>Print / Save PDF</button><button className="btn-secondary" onClick={close} aria-label="Close print preview">✕</button>
      </div>
    </div>
    {error&&<div role="alert" className="mx-auto mb-2 w-full max-w-7xl rounded border border-red-300 bg-white p-3 text-sm text-red-700">{error}</div>}
    {busy&&<div role="status" className="mx-auto mb-2 rounded bg-white px-4 py-2 text-sm">Preparing complete document and page breaks…</div>}
    {preview&&<div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-auto rounded-lg bg-slate-300 p-3">
      {pageCount>1&&<div className="mb-2 flex items-center justify-center gap-3 text-xs"><button className="btn-secondary" disabled={page<=1} onClick={()=>{const next=page-1;setPage(next);frameRef.current?.contentDocument?.querySelectorAll('.navilo-paper')[next-1]?.scrollIntoView();}}>Previous page</button><span>Page {page} / {pageCount}</span><button className="btn-secondary" disabled={page>=pageCount} onClick={()=>{const next=page+1;setPage(next);frameRef.current?.contentDocument?.querySelectorAll('.navilo-paper')[next-1]?.scrollIntoView();}}>Next page</button></div>}
      <iframe key={preview.id} ref={frameRef} title="Document pages" sandbox="allow-same-origin" srcDoc={documentMarkup(preview)} onLoad={()=>void layout()} className="mx-auto min-h-0 flex-1 border-0 bg-white shadow-lg" style={{width:`${width}mm`,minWidth:`${width}mm`}}/>
    </div>}
  </div>;
}
