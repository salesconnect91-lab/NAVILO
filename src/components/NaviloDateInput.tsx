import {forwardRef,useEffect,useRef,useState,type ChangeEvent,type InputHTMLAttributes} from 'react';
import {CalendarDays} from 'lucide-react';
import {formatNaviloDate,parseNaviloDate} from '@/lib/naviloDate';

// ISO remains the form/database value; text and calendar are two views of it.
const NaviloDateInput=forwardRef<HTMLInputElement,InputHTMLAttributes<HTMLInputElement>>(function NaviloDateInput({value,onChange,onBlur,className='',min,max,type:_type,...props},forwardedRef){
  const iso=String(value??'');
  const [draft,setDraft]=useState(iso?formatNaviloDate(iso):'');
  const textRef=useRef<HTMLInputElement|null>(null);
  const localValue=useRef<string|null>(null);
  useEffect(()=>{if(localValue.current===iso){localValue.current=null;return;}setDraft(iso?formatNaviloDate(iso):'');},[iso]);
  useEffect(()=>{const parsed=parseNaviloDate(draft);const invalid=parsed===null||Boolean(parsed&&((min&&parsed<String(min))||(max&&parsed>String(max))));textRef.current?.setCustomValidity(invalid?'Enter a valid date as dd-mmm-yy within the allowed range.':'');},[draft,min,max]);
  const emit=(event:ChangeEvent<HTMLInputElement>,next:string)=>{localValue.current=next;onChange?.({...event,target:{...event.target,value:next,name:event.target.name,id:event.target.id},currentTarget:{...event.currentTarget,value:next}} as ChangeEvent<HTMLInputElement>);};
  return <span className="relative inline-block w-full align-middle">
    <input {...props} ref={node=>{textRef.current=node;if(typeof forwardedRef==='function')forwardedRef(node);else if(forwardedRef)forwardedRef.current=node;}} type="text" value={draft} placeholder={props.placeholder??'dd-mmm-yy'} className={`${className} pr-8`} onChange={e=>{setDraft(e.target.value);const next=parseNaviloDate(e.target.value);emit(e,next??'');}} onBlur={e=>{const next=parseNaviloDate(draft);if(next)setDraft(formatNaviloDate(next));onBlur?.(e);}}/>
    <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-500"><CalendarDays className="h-4 w-4" /></span>
    <input type="date" aria-label={`${props['aria-label']??'Date'} calendar`} tabIndex={-1} disabled={props.disabled||props.readOnly} value={iso} min={min} max={max} className="absolute inset-y-0 right-0 w-8 cursor-pointer opacity-0" onChange={e=>{setDraft(e.target.value?formatNaviloDate(e.target.value):'');emit(e,e.target.value);}}/>
  </span>;
});
export default NaviloDateInput;
