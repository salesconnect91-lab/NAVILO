import {useEffect,useRef,useState} from 'react';
import {TRANSPORT_REASON_OPTIONS,reasonPresetValue,defaultTransportReason,type TransportReasonKind} from './transportRateReasons';

type Props={kind:TransportReasonKind;value:string;onChange:(value:string)=>void;label?:string;disabled?:boolean;compact?:boolean;className?:string;};
/** Predefined reasons auto-fill an editable audit reason, without bypassing server validation. */
export default function TransportReasonSelect({kind,value,onChange,label='Reason',disabled=false,compact=false,className=''}:Props){
 const [otherSelected,setOtherSelected]=useState(false);
 const previousKind=useRef(kind);
 useEffect(()=>{
  if(disabled)return;
  const previous=previousKind.current;previousKind.current=kind;
  if(previous!==kind&&TRANSPORT_REASON_OPTIONS[previous].includes(value)){setOtherSelected(false);onChange(defaultTransportReason(kind));}
  else if(!value.trim()&&!otherSelected)onChange(defaultTransportReason(kind));
 },[kind,value,disabled,otherSelected,onChange]);
 const preset=reasonPresetValue(kind,value,otherSelected);
 return <div className={`min-w-0 ${className}`}>
  <label className={`block font-semibold ${compact?'text-[10px]':'text-xs'}`}>
   Select reason
   <select
    aria-label={`${label} selection`} disabled={disabled}
    className={`input mt-1 w-full ${compact?'h-7 px-1 text-[10px]':'h-8 text-xs'}`}
    value={preset}
    onChange={e=>{const next=e.target.value;setOtherSelected(next==='__other__');onChange(next==='__other__'?'':next);}}>
    
    {TRANSPORT_REASON_OPTIONS[kind].map(option=><option key={option} value={option}>{option}</option>)}
    <option value="__other__">Other / Custom Reason</option>
   </select>
  </label>
  <label className={`mt-1 block font-semibold ${compact?'text-[10px]':'text-xs'}`}>
   {label}
   <input aria-label={label} className={`input mt-1 w-full ${compact?'h-7 text-[10px]':'h-8 text-xs'}`}
    value={value||(!otherSelected?defaultTransportReason(kind):'')} disabled={disabled} maxLength={1000}
    onChange={e=>onChange(e.target.value)} placeholder="Selected reason (editable) / type your own"/>
  </label>
 </div>;
}
