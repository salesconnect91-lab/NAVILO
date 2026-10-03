export function invoiceNumberError(values:string[]):string|null {
 const used=new Set<string>();
 for(const value of values){
  const number=value.trim();if(!number)continue;
  if(number.length>80||/[\u0000-\u001f\u007f]/.test(number)||number.endsWith('-AUTO'))return 'Invoice number must be at most 80 characters, without control characters or the reserved -AUTO suffix.';
  const key=number.toLowerCase();if(used.has(key))return `Each selected invoice needs its own number. Duplicate: ${number}`;
  used.add(key);
 }
 return null;
}
