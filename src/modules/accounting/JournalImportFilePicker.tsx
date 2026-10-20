import type {ChangeEvent} from 'react';

export default function JournalImportFilePicker({disabled,processing,fileName,error,onFile}:{
 disabled:boolean;processing:boolean;fileName:string;error:string|null;
 onFile:(event:ChangeEvent<HTMLInputElement>)=>void|Promise<void>;
}){
 return <section className="rounded-xl border-2 border-dashed border-blue-300 bg-blue-50 p-5" aria-label="Upload Journal File">
  <h3 className="text-sm font-bold text-slate-900">Upload Journal File</h3>
  <p className="mt-1 text-xs text-slate-600">
   Select your Excel or CSV file below. The real file input is always visible. You can reselect the same file after correcting it.
  </p>
  <label htmlFor="journal-bulk-upload-file" className="mt-4 block text-sm font-semibold text-slate-900">
   Choose File (.xlsx, .xls, .csv)
  </label>
  <input id="journal-bulk-upload-file" aria-label="Choose Journal File" type="file"
   accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
   onChange={event=>{void onFile(event)}}
   disabled={disabled}
   aria-describedby="journal-upload-feedback"
   className="mt-2 block w-full min-w-0 cursor-pointer rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-800 shadow-sm file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"/>
  <div id="journal-upload-feedback" className="mt-2" aria-live="polite">
   {processing&&<p role="status" className="text-xs font-medium text-blue-700">Reading and checking the Excel file…</p>}
   {fileName&&!processing&&<p role="status" className="text-xs font-medium text-blue-900">Selected: {fileName}</p>}
   {!fileName&&!processing&&<p className="text-xs text-slate-500">No file selected yet. After selection, you will see its name or the exact error below.</p>}
  </div>
  {error&&<div role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-left text-sm text-red-800">
   <strong>Why this file was not accepted:</strong>
   <p className="mt-1 whitespace-pre-wrap break-words">{error}</p>
   <p className="mt-2 text-xs">Fix the indicated Excel column/row and choose the file again. A rejected file does not create or post any journal.</p>
  </div>}
 </section>;
}
