const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function parseNaviloDate(value:string):string|null {
  const text=value.trim();if(!text)return '';
  let year:number,month:number,day:number;
  const iso=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const display=/^(\d{1,2})-([a-z]{3})-(\d{2}|\d{4})$/i.exec(text);
  if(iso){year=Number(iso[1]);month=Number(iso[2]);day=Number(iso[3]);}
  else if(display){day=Number(display[1]);month=MONTHS.findIndex(m=>m.toLowerCase()===display[2].toLowerCase())+1;year=Number(display[3]);if(display[3].length===2)year+=year>=70?1900:2000;}
  else return null;
  const date=new Date(Date.UTC(year,month-1,day));
  if(year<100||year>9999||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
export function formatNaviloDate(value:string|null|undefined):string {
  if(!value)return '—';
  const iso=parseNaviloDate(value.slice(0,10));if(!iso)return '—';
  const [year,month,day]=iso.split('-');return `${day}-${MONTHS[Number(month)-1]}-${year.slice(-2)}`;
}
