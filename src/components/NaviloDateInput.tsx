import {forwardRef,useEffect,useRef,useState,type ChangeEvent,type InputHTMLAttributes} from 'react';
import {CalendarDays} from 'lucide-react';
import {formatNaviloDate,parseNaviloDate} from '@/lib/naviloDate';

// ISO remains the form/database value; text and calendar are two views of it.
const NaviloDateInput=forwardRef<HTMLInputElement,InputHTMLAttributes<HTMLInputElement>>(function NaviloDateInput({value,onChange,onBlur,className='',min,max,type:_type,...props},forwardedRef){
  const iso=String(value??'');
  const [draft,setDraft]=useState(iso?formatNaviloDate(iso):'');
  const textRef=useRef<HTMLInputElement|null>(null);
  const nativeRef=useRef<HTMLInputElement|null>(null);
  const localValue=useRef<string|null>(null);
  useEffect(()=>{if(localValue.current===iso){localValue.current=null;return;}setDraft(iso?formatNaviloDate(iso):'');},[iso]);
  useEffect(()=>{const parsed=parseNaviloDate(draft);const invalid=parsed===null||Boolean(parsed&&((min&&parsed<String(min))||(max&&parsed>String(max))));textRef.current?.setCustomValidity(invalid?'Enter a valid date as dd-mmm-yy within the allowed range.':'');},[draft,min,max]);
  const emit=(event:ChangeEvent<HTMLInputElement>,next:string)=>{localValue.current=next;onChange?.({...event,target:{...event.target,value:next,name:event.target.name,id:event.target.id},currentTarget:{...event.currentTarget,value:next}} as ChangeEvent<HTMLInputElement>);};
  const openCalendar=()=>{
    const input=nativeRef.current;
    if(!input||input.disabled)return;
    try{
      const picker=(input as HTMLInputElement&{showPicker?:()=>void}).showPicker;
      if(typeof picker==="function"){picker.call(input);return;}
    }catch{/* fall through to native click */}
    input.focus({preventScroll:true});
    input.click();
  };
  return <span className="relative inline-block w-full align-middle">
    <input {...props} ref={node=>{textRef.current=node;if(typeof forwardedRef==='function')forwardedRef(node);else if(forwardedRef)forwardedRef.current=node;}} type="text" value={draft} placeholder={props.placeholder??'dd-mmm-yy'} className={`${className} pr-12`} onChange={e=>{setDraft(e.target.value);const next=parseNaviloDate(e.target.value);emit(e,next??'');}} onBlur={e=>{const next=parseNaviloDate(draft);if(next)setDraft(formatNaviloDate(next));onBlur?.(e);}}/>
    <button type="button" aria-label={`${props['aria-label']??'Date'} calendar`} disabled={props.disabled||props.readOnly} onClick={openCalendar} className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r text-slate-500 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-40">
      <CalendarDays className="h-5 w-5" />
    </button>
    <input ref={nativeRef} type="date" aria-hidden="true" tabIndex={-1} disabled={props.disabled||props.readOnly} value={iso} min={min} max={max} className="pointer-events-none absolute right-0 top-0 h-px w-px opacity-0" onChange={e=>{setDraft(e.target.value?formatNaviloDate(e.target.value):'');emit(e,e.target.value);}}/>
  </span>;
});
export default NaviloDateInput;
