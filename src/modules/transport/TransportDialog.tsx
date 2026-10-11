import {useEffect,useRef,type HTMLAttributes} from 'react';
import {createPortal} from 'react-dom';
import './transportDialog.css';

let openDialogs=0;
let savedOverflow='';
const dialogStack:number[]=[];
let dialogSequence=0;
// Portals keep dialogs centered even inside scrolled or transformed workspace panels.
export default function TransportDialog({children,className='',onKeyDown,onClose,restoreFocusTarget,...props}:HTMLAttributes<HTMLDivElement>&{onClose?:()=>void;restoreFocusTarget?:HTMLElement|null}){
 const root=useRef<HTMLDivElement>(null);
 const identity=useRef(0);if(!identity.current)identity.current=++dialogSequence;
 const previousFocus=useRef(document.activeElement as HTMLElement|null);
 useEffect(()=>{
  const previous=restoreFocusTarget??previousFocus.current;
  const id=identity.current;dialogStack.push(id);dialogStack.sort((a,b)=>a-b);
  if(openDialogs++===0){savedOverflow=document.body.style.overflow;document.body.style.overflow='hidden';}
  if(!root.current?.contains(document.activeElement))root.current?.querySelector<HTMLElement>('input,button,select,textarea,[tabindex="0"]')?.focus();
  return()=>{dialogStack.splice(dialogStack.indexOf(id),1);if(--openDialogs===0)document.body.style.overflow=savedOverflow;if(previous?.isConnected)previous.focus();};
 },[]);
 return createPortal(<div {...props} style={{...props.style,zIndex:10000+identity.current}} ref={root} className={`navilo-transport-dialog ${className}`} onKeyDown={e=>{
  if(dialogStack[dialogStack.length-1]!==identity.current)return;
  onKeyDown?.(e);
  if(e.key==='Escape'){e.stopPropagation();onClose?.();}
  if(e.key!=='Tab'||e.defaultPrevented)return;
  const items=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')??[]).filter(el=>!el.hidden&&el.getAttribute('aria-hidden')!=='true');
  const first=items[0],last=items[items.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
 }}>{children}</div>,document.body);
}
