import {useRef,type ChangeEvent} from 'react';

export default function JournalImportFilePicker({disabled,processing,fileName,error,onFile}:{
 disabled:boolean;processing:boolean;fileName:string;error:string|null;
 onFile:(event:ChangeEvent<HTMLInputElement>)=>void|Promise<void>;
}){
 const input=useRef<HTMLInputElement|null>(null);
 return <section className="border-2 border-dashed border-blue-300 bg-blue-50 rounded-xl p-5 text-center" aria-label="Upload Journal File">
  <h3 className="font-bold">Upload Journal File</h3>
  <p className="text-xs text-slate-600 mt-1 mb-4">Choose a CSV, XLS or XLSX Journal file. The filename and validation result appear here.</p>
  <button type="button" disabled={disabled} onClick={()=>input.current?.click()}
   className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
   {processing?'Processing...':'Choose File'}
  </button>
  <input ref={input} aria-label="Select Journal Excel or CSV file" type="file"
   accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
   onChange={event=>{void onFile(event)}}
   className="sr-only" tabIndex={-1} disabled={disabled}/>
  {fileName&&<p role="status" className="mt-3 text-xs font-semibold text-blue-900">Selected: {fileName}</p>}
  {error&&<div role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-left text-sm text-red-800">
   <strong>Upload needs correction:</strong> {error}
   <p className="mt-1 text-xs">No journal has been loaded or posted from this failed upload. Correct the Excel and choose the file again.</p>
  </div>}
 </section>;
}
