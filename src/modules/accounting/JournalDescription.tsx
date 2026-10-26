export default function JournalDescription({text}:{text?:string|null}){
 return <div className="whitespace-pre-wrap break-words text-sm text-slate-800" style={{tabSize:4}}>{text?.trim()?text:'—'}</div>;
}
