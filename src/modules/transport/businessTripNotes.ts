/** Generated import provenance stays in the immutable audit record, not business Remarks. */
export function businessTripNotes(notes:unknown):string{
 const text=typeof notes==='string'?notes:'';
 if(!/^Legacy CSV Trip \d+;/.test(text)||!text.includes('Historical CSV evidence UNPOSTED')||!text.includes('SHA256'))return text;
 const marker='original positional values ';const start=text.indexOf(marker);
 if(start>=0){try{const payload=text.slice(start+marker.length);
   const decoded=payload.startsWith('[\\"')?JSON.parse(`"${payload}"`):payload;
   const raw=JSON.parse(decoded);if(Array.isArray(raw)&&typeof raw[31]==='string')return raw[31];}catch{/* Malformed audit payload is never a business remark. */}}
 return '';
}
