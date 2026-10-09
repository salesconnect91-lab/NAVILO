export type PrintOrientation = 'portrait' | 'landscape';
export type PrintPaper = 'A4' | 'A3' | 'Letter';
export type PrintRequest = {html?: string; title?: string; selector?: string; orientation?: PrintOrientation; paper?: PrintPaper; fullDocument?: boolean};
type PrintSource = () => string | Promise<string>;
const sources = new WeakMap<HTMLElement, PrintSource>();

/** Generate the complete report only when requested, without rendering a second live grid. */
export function registerPrintSource(node: HTMLElement, source: PrintSource) {
  sources.set(node, source);
  node.setAttribute('data-navilo-print-source', 'true');
  return () => { sources.delete(node); node.removeAttribute('data-navilo-print-source'); };
}
export async function clonePrintSource(target: HTMLElement): Promise<HTMLElement> {
  let clone = target.cloneNode(true) as HTMLElement;
  const liveControls=target.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea');
  const clonedControls=clone.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea');
  liveControls.forEach((control,index)=>{const copy=clonedControls[index];if(copy){copy.value=control.value;if(control instanceof HTMLInputElement && copy instanceof HTMLInputElement)copy.checked=control.checked;}});
  const originals = [target, ...Array.from(target.querySelectorAll<HTMLElement>('[data-navilo-print-source]'))];
  const copies = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('[data-navilo-print-source]'))];
  for (let i = 0; i < originals.length; i++) {
    const provider = sources.get(originals[i]);
    if (provider) {
      const html=await provider();
      if(copies[i].tagName==='TABLE') {
        const wrapper=document.createElement('div');wrapper.innerHTML=html;
        const replacement=wrapper.querySelector('table');
        if(replacement){if(copies[i]===clone)clone=replacement;else copies[i].replaceWith(replacement);}else throw new Error('Report source did not produce a table.');
      }else copies[i].innerHTML=html;
    }
  }
  return clone;
}
export function showPrintDocument(detail: PrintRequest) {
  window.dispatchEvent(new CustomEvent<PrintRequest>('navilo:print-preview', {detail}));
}

/** Adapter for existing document builders; never opens a popup or executes their scripts. */
export function createPrintDocument() {
  let html = '', opened = false;
  const preview = () => {
    if (opened || !html.trim()) return;
    opened = true;
    showPrintDocument({html, fullDocument: true});
  };
  return {
    document: {open: () => {html = ''; opened = false;}, write: (...parts: string[]) => {html += parts.join('');}, close: preview},
    focus: () => undefined,
    print: preview,
  };
}
export function escapePrintHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}

/** Only report metadata is shortened; transaction notes and company terms are never passed here. */
export function printReportDescription(description: string) {
  return description.split(/ · |(?<=\.)\s+/).filter(part => !/canonical|totals cover|unposted agreed rates|vehicle and driver are current|allocations deleted|historical allocations|manual historical reconciliation|complete filter|trip filter is not applied|includes other modules|supplier positive balance|customer positive balance|not automatically a transport error|live document reconciliation uses|voucher totals are|reversals carry|full voucher opens|export includes|complete posted history|complete audit history|all posted vouchers in the active|current-state balances shown|historical snapshots are not fabricated/i.test(part)).map(part => part.trim()).filter(Boolean).join(' · ');
}

export function printTableMarkup(title: string, columns: string[], rows: unknown[][], description = '') {
  return `<h2>${escapePrintHtml(title)}</h2>${description?`<p data-print-description>${escapePrintHtml(printReportDescription(description))}</p>`:''}<table><caption>${escapePrintHtml(title)}</caption><thead><tr>${columns.map(column=>`<th>${escapePrintHtml(column)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${row.map(value=>`<td${typeof value==='number'?' class="text-right"':''}>${escapePrintHtml(typeof value==='number'?value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):value==='TOTAL · full filter'?'TOTAL':value)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${columns.length}">No records for the selected filters.</td></tr>`}</tbody></table>`;
}
