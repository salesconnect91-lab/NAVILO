import {useEffect,useState} from 'react';
export default function TransportPagination({page,pageSize,count,busy,onPage}:{page:number;pageSize:number;count:number;busy:boolean;onPage:(page:number)=>void}) {
 const pages=Math.max(1,Math.ceil(count/pageSize)),[jump,setJump]=useState(String(page+1));
 useEffect(()=>setJump(String(page+1)),[page]);
 return <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-slate-50 px-2 py-1 text-[11px]">
  <span>{count?`${(page*pageSize+1).toLocaleString()}–${Math.min((page+1)*pageSize,count).toLocaleString()}`:'0'} of {count.toLocaleString()} · {pageSize} per page</span>
  <fieldset disabled={busy} className="flex items-center gap-1">
   <button className="btn h-7" disabled={page===0} onClick={()=>onPage(0)}>First</button>
   <button className="btn h-7" disabled={page===0} onClick={()=>onPage(page-1)}>Previous</button>
   <form className="flex items-center gap-1" onSubmit={e=>{e.preventDefault();const n=Number(jump);if(Number.isInteger(n)&&n>=1&&n<=pages)onPage(n-1);}}>
    <label>Page <input aria-label="Go to page" className="input h-7 w-16 text-[11px]" type="number" min="1" max={pages} value={jump} onChange={e=>setJump(e.target.value)}/></label><span>/ {pages}</span><button className="btn h-7">Go</button>
   </form>
   <button className="btn h-7" disabled={page>=pages-1} onClick={()=>onPage(page+1)}>Next</button>
   <button className="btn h-7" disabled={page>=pages-1} onClick={()=>onPage(pages-1)}>Last</button>
  </fieldset>
 </div>;
}
