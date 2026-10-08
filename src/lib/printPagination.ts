import type {PrintOrientation, PrintPaper} from './printDocument';
export const paperDimensions = (paper: PrintPaper, orientation: PrintOrientation) => {
  const dimensions = paper === 'A3' ? [297,420] : paper === 'Letter' ? [215.9,279.4] : [210,297];
  return orientation === 'landscape' ? [dimensions[1],dimensions[0]] : dimensions;
};
export function paperCSS(paper: PrintPaper, orientation: PrintOrientation) {
  const [width,height] = paperDimensions(paper,orientation);
  return `@page{size:${paper} ${orientation};margin:0}html,body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;margin:0!important;padding:0!important;background:white!important;color:#172033}*{box-sizing:border-box}body{width:${width}mm!important}.navilo-paper{position:relative!important;width:${width}mm!important;height:${height}mm!important;min-height:0!important;padding:10mm!important;margin:0!important;background:white!important;break-after:page!important;page-break-after:always!important;overflow:visible!important}.navilo-paper:last-child{break-after:auto!important;page-break-after:auto!important}.navilo-page-body{height:${height-27}mm!important;overflow:visible!important}.navilo-page-footer{height:5mm!important;margin-top:2mm!important;border-top:1px solid #cbd5e1!important;font:7pt Arial!important;color:#536477!important;display:flex!important;justify-content:space-between!important;align-items:center!important}.navilo-paper .navilo-print-output,.navilo-paper .print-document,.navilo-paper .print-page,.navilo-paper .sheet,.navilo-paper .navilo-report-document{position:static!important;width:100%!important;max-width:none!important;min-width:0!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;overflow:visible!important;box-shadow:none!important;visibility:visible!important}.navilo-paper *{visibility:visible!important}.navilo-paper table{width:100%!important;min-width:0!important;max-width:100%!important;table-layout:auto!important}.navilo-paper th,.navilo-paper td{overflow-wrap:anywhere!important;white-space:normal!important}.navilo-paper .print-number,.navilo-paper .invoice-num{white-space:nowrap!important;overflow-wrap:normal!important}.navilo-paper tr{break-inside:avoid!important}.navilo-paper .print-page-number,.navilo-paper .page-number,.navilo-paper .navilo-page-number{display:none!important}.navilo-paper [data-no-print],.navilo-paper .no-print,.navilo-paper button,.navilo-paper input,.navilo-paper select,.navilo-paper textarea,.navilo-paper nav,.navilo-paper aside{display:none!important}`;
}

/** Measure with the same styles and dimensions used by print, then freeze the page content. */
export function paginatePrintDocument(doc: Document, footerLabel: string) {
  const output = doc.querySelector<HTMLElement>('.navilo-print-output');
  if (!output) throw new Error('Printable document was not found.');
  let source = output;
  // Unwrap document shells, preserving each ancestor on every page.
  const shells: HTMLElement[] = [];
  while (source.children.length === 1 && !source.firstElementChild?.matches('table,.invoice-items-wrap')) {
    shells.push(source);
    source = source.firstElementChild as HTMLElement;
  }
  const template = source.cloneNode(false) as HTMLElement;
  const blocks = Array.from(source.children).filter(n=>!n.matches('script,style,.print-page-number,.page-number,.navilo-page-number'));
  const header = blocks.find(n=>n.matches('header,.print-header,.top,.head'));
  const pages: HTMLElement[] = [];
  let body: HTMLElement, container: HTMLElement;
  const newPage = (repeatHeader: boolean) => {
    const page = doc.createElement('section');page.className='navilo-paper';
    body=doc.createElement('div');body.className='navilo-page-body';page.appendChild(body);
    let parent: HTMLElement = body;
    shells.forEach(shell=>{const copy=shell.cloneNode(false) as HTMLElement;copy.removeAttribute('id');parent.appendChild(copy);parent=copy;});
    container=template.cloneNode(false) as HTMLElement;container.removeAttribute('id');parent.appendChild(container);
    if (repeatHeader && header) container.appendChild(header.cloneNode(true));
    doc.body.appendChild(page);pages.push(page);
  };
  output.remove();
  newPage(false);
  const fits = () => body.scrollHeight <= body.clientHeight + 1;
  const addBlock = (block: Element) => {
    let copy = block.cloneNode(true) as HTMLElement;
    container.appendChild(copy);
    if (!fits()) {
      copy.remove();
      const occupied = Array.from(container.children).some(n=>!header || n.outerHTML!==header.outerHTML);
      if (occupied) newPage(true);
      container.appendChild(copy);
      if (!fits()) throw new Error('A document section is taller than one page. Choose a larger paper size or reduce the section before printing.');
    }
  };
  for (const block of blocks) {
    const table = block.matches('table') ? block as HTMLTableElement : block.querySelector<HTMLTableElement>('table');
    const grid = block.matches('.invoice-items-wrap') ? block : null;
    if ((!table?.tBodies.length || block.querySelectorAll('table').length > 1) && !grid) {addBlock(block);continue;}
    // Tables and invoice item grids split only between rows. Repeat the original column headers.
    const rows = grid ? Array.from(grid.querySelectorAll(':scope > .invoice-items-row')) : Array.from(table!.tBodies).flatMap(b=>Array.from(b.rows));
    if (!rows.length || rows.some(row=>Array.from(row.children).some(cell=>(cell.tagName==='TD'||cell.tagName==='TH') && (cell as HTMLTableCellElement).rowSpan>1))) {addBlock(block);continue;}
    const trailing: Element[] = [];
    if (table && block !== table) {
      let branch: Element = table;
      while (branch !== block) {
        let sibling = branch.nextElementSibling;
        while (sibling) {trailing.push(sibling);sibling=sibling.nextElementSibling;}
        branch=branch.parentElement!;
      }
    }
    let chunk: HTMLElement, rowParent: HTMLElement;
    const makeChunk = () => {
      chunk=block.cloneNode(true) as HTMLElement;
      if (grid) {chunk.querySelectorAll(':scope > .invoice-items-row').forEach(n=>n.remove());rowParent=chunk;}
      else {
        const t = chunk.matches('table') ? chunk as HTMLTableElement : chunk.querySelector<HTMLTableElement>('table')!;
        if (chunk !== t) {
          let branch: Element = t;
          while (branch !== chunk) {
            while (branch.nextElementSibling) branch.nextElementSibling.remove();
            branch=branch.parentElement!;
          }
        }
        t.querySelectorAll('tbody tr,tfoot').forEach(n=>n.remove());
        rowParent=t.tBodies[0] || t.createTBody();
      }
      container.appendChild(chunk);
    };
    makeChunk();
    for (const row of rows) {
      let copy=row.cloneNode(true);rowParent.appendChild(copy);
      if (!fits()) {
        copy.parentNode?.removeChild(copy);
        if (!rowParent.children.length) chunk.remove();
        newPage(true);makeChunk();rowParent.appendChild(copy);
        if (!fits()) throw new Error('A report row is taller than one page. Shorten its description or select a larger paper size.');
      }
    }
    if (!grid && table?.tFoot) {
      const t = chunk!.matches('table') ? chunk! as HTMLTableElement : chunk!.querySelector<HTMLTableElement>('table')!;
      const foot=table.tFoot.cloneNode(true);t.appendChild(foot);
      if (!fits()) {
        foot.parentNode?.removeChild(foot);
        // Keep the final data row with its totals instead of creating a totals-only page.
        const finalRow=rowParent!.lastElementChild;
        finalRow?.remove();
        if (!rowParent!.children.length) chunk!.remove();
        newPage(true);makeChunk();
        if (finalRow) rowParent!.appendChild(finalRow);
        const lastTable = chunk!.matches('table') ? chunk! as HTMLTableElement : chunk!.querySelector<HTMLTableElement>('table')!;
        lastTable.appendChild(foot);
        if (!fits()) throw new Error('Report totals do not fit on one page.');
      }
    }
    trailing.forEach(addBlock);
  }
  pages.forEach((page,index)=>{
    const footer=doc.createElement('footer');footer.className='navilo-page-footer';
    const label=doc.createElement('span');label.textContent=footerLabel;
    const number=doc.createElement('span');number.textContent=`Page ${index+1} of ${pages.length}`;
    footer.append(label,number);page.appendChild(footer);
  });
  return pages.length;
}
