import {describe,expect,it,vi} from 'vitest';
import * as XLSX from 'xlsx';
import {importDate,parseTripWorkbook,makeImportJob,runImportJob,type ImportRow} from './transportTripImport';
import fs from 'node:fs';
const headers=['DATE','TRUCK TYPE','PO/DO/JOB NO.','INVOICED','COMPANY NAME','DRIVER NAME','OWNER','PLATE #','FROM','TO','PAPER RECEIVED BY','DATE','PAY TO DRIVER','RENT WITH DRIVER','REMAINING WITH US','PAYMENT DATE','AMOUNT','rate with company','received from company','remaining with company','PROFIT','paid commissin for trip','Sale Type \r\n( Cash / Credit)'];
function workbook(rows:unknown[][]){const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([headers,...rows]),'Trips');return XLSX.write(w,{type:'array',bookType:'xlsx'});}
const example=['2026-10-01','FLATBED','JOB-1','','Customer','Driver','Owner','0012','From','To','PPR PENDING','','50','100','','','',200,0,200,0,'','Credit'];
describe('BuKu Trip import',()=>{
 it('reads duplicate Date headers, multiline Sale Type, rates and numeric zero without inferring payment posting',()=>{
  const row=[...example];row[10]='Receiver';row[11]='02-Oct-26';row[13]=0;row[17]=0;
  const result=parseTripWorkbook(workbook([row]))[0];expect(result.trip_date).toBe('2026-10-01');expect(result.ppr_date).toBe('2026-10-02');
  expect(result.sale_type).toBe('credit');expect(result.supplier_rent).toBe('0');expect(result.customer_rate).toBe('0');expect(result.driver_pay).toBe('');
 });
 it('skips template formula-only rows and keeps Excel row numbers',()=>{
  const blank=Array(23).fill('');blank[16]=0;blank[20]=0;
  const parsed=parseTripWorkbook(workbook([example,blank,example]));expect(parsed.map(r=>r.rowNo)).toEqual([2,4]);
 });
 it('parses 20,000 rows and enforces the limit',()=>{
  const rows=Array.from({length:20000},(_,i)=>{const row=[...example];row[2]=`JOB-${i}`;return row;});
  expect(parseTripWorkbook(workbook(rows))).toHaveLength(20000);
  expect(()=>parseTripWorkbook(workbook([...rows,example]))).toThrow('20,000');
 });
 it('supports dd-mmm-yy, Excel serial and dd/mm/yyyy without ambiguous browser date parsing',()=>{
  expect(importDate('03-Oct-26')).toBe('2026-10-03');expect(importDate(46265)).toBe('2026-08-31');expect(importDate('03/10/2026')).toBe('2026-10-03');
  expect(importDate('31/02/2026')).toBe('');expect(importDate('2026-02-31')).toBe('');
 });
 it('reuses uncertain batch after lost response and resumes without resending confirmed batches',async()=>{
  const rows=Array.from({length:250},(_,i)=>({rowNo:i+2,payload:{po_do_job_no:`JOB-${i}`},errors:[]} as unknown as ImportRow));
  const job=makeImportJob('scope','file',rows),save=vi.fn(async()=>{});let lost=true;const calls:string[]=[];
  const send=async(batch:any)=>{calls.push(batch.requestId);if(calls.length===2&&lost){lost=false;throw new Error('Response lost');}return batch.rows.map(()=>({id:'trip'}));};
  await expect(runImportJob(job,send,save,()=>{},()=>false)).rejects.toThrow('Response lost');expect(job.completed).toBe(1);
  await runImportJob(job,send,save,()=>{},()=>false);expect(job.completed).toBe(3);expect(calls[1]).toBe(calls[2]);expect(calls.filter(id=>id===calls[0])).toHaveLength(1);
 });
 it('saves before sending and stops on persistence failure or explicit pause',async()=>{
  const job=makeImportJob('scope','file',[{rowNo:2,errors:[],payload:{}} as unknown as ImportRow]),send=vi.fn();
  await expect(runImportJob(job,send,async()=>{throw new Error('Storage full');},()=>{},()=>false)).rejects.toThrow('Storage full');expect(send).not.toHaveBeenCalled();
  await runImportJob(job,send,async()=>{},()=>{},()=>true);expect(send).not.toHaveBeenCalled();
 });
 it('reconciles uncertain batch if saving confirmed progress fails',async()=>{
  const job=makeImportJob('scope','file',[{rowNo:2,errors:[],payload:{}} as unknown as ImportRow]);let saves=0;const send=vi.fn(async()=>[{id:'trip'}]);
  await expect(runImportJob(job,send,async()=>{if(++saves===2)throw new Error('Disk full');},()=>{},()=>false)).rejects.toThrow('Disk full');expect(job.completed).toBe(0);
  await runImportJob(job,send,async()=>{},()=>{},()=>false);expect(send.mock.calls).toHaveLength(2);expect(job.completed).toBe(1);
 });
 // Run when the supplied reference is available; the product tests above remain portable.
 const reference='/workspace/scratch/3db196d2383a/upload/BuKu_Trip_Excel_Upload_template-USE (1)(3).xlsm';
 it.skipIf(!fs.existsSync(reference))('accepts the supplied XLSM reference as exactly five operational Trips',()=>{
  const bytes=fs.readFileSync(reference);const rows=parseTripWorkbook(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  expect(rows).toHaveLength(5);expect(rows.map(r=>r.sale_type)).toEqual(['cash','credit','credit','credit','credit']);expect(rows.map(r=>r.rowNo)).toEqual([2,3,4,5,6]);
 });
});
