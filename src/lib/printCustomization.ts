export type PrintTableSelection = {index:number; title:string; columns:{label:string; selected:boolean}[]};

/** Logical positions, including grouped headings and row/column spans. */
function cellsInGrid(rows:HTMLTableRowElement[]) {
  const occupied:number[]=[];
  return rows.flatMap(row=>{
    let column=0;
    const cells=Array.from(row.cells).map(cell=>{
      while(occupied[column]>0)column++;
      const start=column,span=cell.colSpan;
      for(let i=start;i<start+span;i++)occupied[i]=Math.max(occupied[i]||0,cell.rowSpan===0?rows.length:cell.rowSpan);
      column+=span;
      return {cell,start,span};
    });
    for(let i=0;i<occupied.length;i++)occupied[i]=Math.max(0,occupied[i]-1);
    return cells;
  });
}

export function printTableSelections(html:string):PrintTableSelection[] {
  const doc=new DOMParser().parseFromString(html,'text/html');
  return Array.from(doc.querySelectorAll('table')).flatMap((table,index)=>{
    if(!table.tHead?.rows.length)return [];
    const cells=cellsInGrid(Array.from(table.tHead.rows));
    const width=Math.max(0,...cells.map(({start,span})=>start+span));
    if(width<2)return [];
    const columns=Array.from({length:width},(_,column)=>{
      const covering=cells.filter(({start,span})=>column>=start&&column<start+span);
      const labels=covering.map(({cell})=>cell.textContent?.trim()||'').filter(Boolean);
      return {label:Array.from(new Set(labels)).join(' / ')||`Column ${column+1}`,selected:!covering.some(({cell})=>cell.style.display==='none'||cell.hidden)};
    });
    if(!columns.some(c=>c.selected))return [];
    return [{index,title:table.caption?.textContent?.trim()||`Table ${index+1}`,columns}];
  });
}

/** Always project the original snapshot, never the previous customized output. */
export function customizePrintHtml(html:string,selections:PrintTableSelection[]) {
  const doc=new DOMParser().parseFromString(html,'text/html');
  const tables=Array.from(doc.querySelectorAll('table'));
  selections.forEach(selection=>{
    const table=tables[selection.index];
    if(!table||!selection.columns.some(c=>c.selected))return;
    const kept=new Set(selection.columns.flatMap((c,i)=>c.selected?[i]:[]));
    const sections=[table.tHead,...Array.from(table.tBodies),table.tFoot].filter((s):s is HTMLTableSectionElement=>!!s);
    sections.forEach(section=>cellsInGrid(Array.from(section.rows)).forEach(({cell,start,span})=>{
      const count=Array.from({length:span},(_,i)=>start+i).filter(i=>kept.has(i)).length;
      if(!count){cell.remove();return;}
      cell.colSpan=count;cell.hidden=false;cell.style.removeProperty('display');
      if(kept.size!==selection.columns.length){cell.removeAttribute('width');cell.style.removeProperty('width');cell.style.removeProperty('min-width');}
    }));
    if(kept.size!==selection.columns.length)table.querySelectorAll(':scope > colgroup,:scope > col').forEach(col=>col.remove());
  });
  return doc.body.innerHTML;
}
