import {useState} from 'react';
import NaviloSearchableSelect from '@/components/SearchableSelect';
import {TRANSPORT_REASON_OPTIONS,reasonPresetValue,type TransportReasonKind} from './transportRateReasons';

type Props={
 kind:TransportReasonKind;
 value:string;
 onChange:(value:string)=>void;
 label?:string;
 disabled?:boolean;
 compact?:boolean;
 className?:string;
};
/** Reuse in all Trip Register audit/correction dialogs.
 * Selection is the literal reason saved in the existing audit RPC; "Other"
 * requires custom text and never silently manufactures a reason.
 */
export default function TransportReasonSelect({kind,value,onChange,label='Reason',disabled=false,compact=false,className=''}:Props){
 const [otherSelected,setOtherSelected]=useState(false);
 const preset=reasonPresetValue(kind,value,otherSelected);
 return <div className={`min-w-0 ${className}`}>
  <label className={`block font-semibold ${compact?'text-[10px]':'text-xs'}`}>
   {label}
   <NaviloSearchableSelect nativeCompatibility preserveLabel
    aria-label={`${label} selection`} disabled={disabled}
    className={`input mt-1 w-full ${compact?'h-7 px-1 text-[10px]':'h-8 text-xs'}`}
    value={preset}
    onChange={e=>{
     const next=e.target.value;
     setOtherSelected(next==='__other__');
     onChange(next==='__other__'?'':next);
    }}>
    <option value="">Select reason…</option>
    {TRANSPORT_REASON_OPTIONS[kind].map(option=><option key={option} value={option}>{option}</option>)}
    <option value="__other__">Other / Custom Reason</option>
   </NaviloSearchableSelect>
  </label>
  {preset==='__other__'&&<label className={`mt-1 block font-semibold ${compact?'text-[10px]':'text-xs'}`}>
    Custom reason
    <input aria-label="Custom reason" className={`input mt-1 w-full ${compact?'h-7 text-[10px]':'h-8 text-xs'}`}
     value={value} disabled={disabled} maxLength={1000}
     onChange={e=>onChange(e.target.value)} placeholder="Enter the specific reason"/>
   </label>}
 </div>;
}
