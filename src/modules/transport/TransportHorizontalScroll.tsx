import {useEffect,useRef,useState,type RefObject} from 'react';

export default function TransportHorizontalScroll({gridRef,revision}:{gridRef:RefObject<HTMLDivElement>;revision:string}){
 const barRef=useRef<HTMLDivElement>(null);const [width,setWidth]=useState(0);
 useEffect(()=>{
  const grid=gridRef.current,bar=barRef.current;if(!grid||!bar)return;
  const measure=()=>{setWidth(grid.scrollWidth);bar.scrollLeft=grid.scrollLeft;};
  const mirror=()=>{if(Math.abs(bar.scrollLeft-grid.scrollLeft)>0.5)bar.scrollLeft=grid.scrollLeft;};
  const wheel=(e:WheelEvent)=>{if(e.ctrlKey||grid.scrollWidth<=grid.clientWidth)return;const delta=(e.deltaX||e.deltaY)*(e.deltaMode===1?16:e.deltaMode===2?grid.clientWidth:1);if(!delta)return;e.preventDefault();e.stopPropagation();grid.scrollLeft+=delta;bar.scrollLeft=grid.scrollLeft;};
  measure();grid.addEventListener('scroll',mirror);bar.addEventListener('wheel',wheel,{passive:false});window.addEventListener('resize',measure);
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);observer?.observe(grid);const table=grid.querySelector('table');if(table)observer?.observe(table);
  return()=>{grid.removeEventListener('scroll',mirror);bar.removeEventListener('wheel',wheel);window.removeEventListener('resize',measure);observer?.disconnect();};
 },[gridRef,revision]);
 return <div ref={barRef} aria-label="Trips horizontal scrollbar" className="h-4 shrink-0 overflow-x-auto overflow-y-hidden border-t bg-slate-50" onScroll={e=>{const grid=gridRef.current;if(grid&&Math.abs(grid.scrollLeft-e.currentTarget.scrollLeft)>0.5)grid.scrollLeft=e.currentTarget.scrollLeft;}}><div style={{width,height:1}}/></div>;
}
