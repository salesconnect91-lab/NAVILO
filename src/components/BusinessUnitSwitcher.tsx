import SearchableSelect from "@/components/SearchableSelect";
import { useEffect, useRef, useState } from "react";
import { BriefcaseBusiness, ChevronDown, GripVertical, Loader2, LockKeyhole, MapPin, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";

type OperatingLocation = {
  operating_location_id: string;
  location_code: string;
  location_name: string;
  location_type: string;
  business_unit_id: string | null;
  is_locked: boolean;
};

type StickerPosition = { x: number; y: number };
const POSITION_KEY = "navilo-workspace-sticker-position";
const DEFAULT_POSITION: StickerPosition = { x: -1, y: 7 };

function clampPosition(position: StickerPosition, width = 430, height = 44): StickerPosition {
  if (typeof window === "undefined") return position;
  const maxX = Math.max(8, window.innerWidth - width - 8);
  const maxY = Math.max(8, window.innerHeight - height - 8);
  return {
    x: Math.min(Math.max(8, position.x), maxX),
    y: Math.min(Math.max(8, position.y), maxY),
  };
}

function defaultPosition(): StickerPosition {
  if (typeof window === "undefined") return DEFAULT_POSITION;
  return clampPosition({ x: Math.max(8, window.innerWidth - 820), y: 7 });
}

export default function BusinessUnitSwitcher(){
  const{activeBusinessUnit,availableBusinessUnits,switchBusinessUnit,switchingBusinessUnit,accessContext}=useAuth();
  const navigate=useNavigate();
  const[error,setError]=useState("");
  const[position,setPosition]=useState<StickerPosition>(()=>defaultPosition());
  const[dragging,setDragging]=useState(false);
  const dragRef=useRef<{pointerId:number;offsetX:number;offsetY:number}|null>(null);
  if(!activeBusinessUnit)return null;

  const canSwitch=availableBusinessUnits.length>1;
  const branch=((accessContext as unknown as {current_operating_location?:OperatingLocation|null})?.current_operating_location)??null;

  useEffect(()=>{
    try{
      const saved=window.localStorage.getItem(POSITION_KEY);
      if(saved){
        const parsed=JSON.parse(saved) as Partial<StickerPosition>;
        if(Number.isFinite(parsed.x)&&Number.isFinite(parsed.y))setPosition(clampPosition({x:Number(parsed.x),y:Number(parsed.y)}));
      }
    }catch{/* keep default */}
    const onResize=()=>setPosition(current=>clampPosition(current));
    window.addEventListener("resize",onResize);
    return()=>window.removeEventListener("resize",onResize);
  },[]);

  const persist=(next:StickerPosition)=>{
    const safe=clampPosition(next);
    setPosition(safe);
    try{window.localStorage.setItem(POSITION_KEY,JSON.stringify(safe));}catch{/* storage unavailable */}
  };

  const resetPosition=()=>{
    const next=defaultPosition();
    setPosition(next);
    try{window.localStorage.removeItem(POSITION_KEY);}catch{/* storage unavailable */}
  };

  const startDrag=(event:React.PointerEvent<HTMLButtonElement>)=>{
    if(event.button!==0)return;
    const rect=event.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
    if(!rect)return;
    dragRef.current={pointerId:event.pointerId,offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top};
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const moveDrag=(event:React.PointerEvent<HTMLButtonElement>)=>{
    const drag=dragRef.current;
    if(!drag||drag.pointerId!==event.pointerId)return;
    event.preventDefault();
    setPosition(clampPosition({x:event.clientX-drag.offsetX,y:event.clientY-drag.offsetY}));
  };
  const endDrag=(event:React.PointerEvent<HTMLButtonElement>)=>{
    const drag=dragRef.current;
    if(!drag||drag.pointerId!==event.pointerId)return;
    dragRef.current=null;
    setDragging(false);
    try{window.localStorage.setItem(POSITION_KEY,JSON.stringify(clampPosition(position)));}catch{/* storage unavailable */}
    try{event.currentTarget.releasePointerCapture(event.pointerId);}catch{/* already released */}
  };

  return <div className="fixed z-40 hidden md:block" style={{left:position.x,top:position.y}} data-no-bilingual data-no-print data-no-print-overlay>
    <div className={`flex h-9 max-w-[430px] items-center gap-2 rounded-lg border border-slate-200 bg-white/95 px-2 shadow-sm backdrop-blur-xl ${dragging?"shadow-lg ring-2 ring-blue-200":""}`} title={branch?`${activeBusinessUnit.business_unit_name} • ${branch.location_name}${branch.is_locked?" • Locked workspace":""}`:activeBusinessUnit.business_unit_name}>
      <button type="button" className="flex h-7 w-6 shrink-0 touch-none cursor-grab items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing" title="Drag to move workspace sticker" aria-label="Move workspace sticker" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><GripVertical size={14}/></button>
      <BriefcaseBusiness size={14} className="shrink-0 text-blue-600"/>
      {canSwitch?<div className="relative min-w-[125px] max-w-[210px]"><SearchableSelect aria-label="Active business unit" className="h-7 w-full appearance-none truncate border-0 bg-transparent pl-0 pr-6 text-[12px] font-bold text-slate-800 outline-none focus:ring-0" value={activeBusinessUnit.business_unit_id} disabled={switchingBusinessUnit} onChange={e=>{const id=e.target.value;if(!id)return;setError("");void switchBusinessUnit(id).then(({error:x})=>{if(x){setError(x);return}navigate("/")})}}>{availableBusinessUnits.map(u=><option key={u.business_unit_id} value={u.business_unit_id}>{u.business_unit_name}</option>)}</SearchableSelect><span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-slate-400">{switchingBusinessUnit?<Loader2 size={12} className="animate-spin"/>:<ChevronDown size={12}/>}</span></div>:<span className="max-w-[180px] truncate text-[12px] font-bold text-slate-800">{activeBusinessUnit.business_unit_name}</span>}
      {branch&&<><span className="h-4 w-px shrink-0 bg-slate-200"/><MapPin size={12} className="shrink-0 text-slate-400"/><span className="max-w-[150px] truncate text-[11px] font-semibold text-slate-600">{branch.location_name}</span>{branch.is_locked&&<LockKeyhole size={12} className="shrink-0 text-blue-600" aria-label="Locked workspace"/>}</>}
      <button type="button" onClick={resetPosition} className="ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Reset sticker position" aria-label="Reset workspace sticker position"><RotateCcw size={12}/></button>
    </div>
    {error&&<div className="mt-1 max-w-[430px] rounded-lg border border-red-100 bg-red-50 px-2.5 py-1.5 text-[12px] font-medium text-red-600 shadow-sm">{error}</div>}
  </div>
}
