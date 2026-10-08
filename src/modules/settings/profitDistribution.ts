/**
 * Profit distribution core. Exact cents arithmetic, no financial writes.
 * Does not read provisional trip-profit estimates or post journals.
 */
export type DistributionMethod = 'fixed_percentage' | 'custom_excel';
export type DistributionPartner = { key: string; name: string; percentage: number };
export type ProfitPool = { key: 'own_fleet' | 'twakkal'; label: string; amount: number };
export type DistributionLine = { key: string; name: string; own_fleet: number; twakkal: number; total: number };
function moneyCents(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0 || amount > 999999999999) throw new Error('Profit must be a non-negative, finite amount. Loss sharing requires a separate approved policy.');
  return Math.round((amount + Number.EPSILON) * 100);
}
function boundedPercentage(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('Each partner percentage must be between 0 and 100.');
  const bps=Math.round(value * 100);
  if (Math.abs(value * 100-bps)>0.0000001) throw new Error('Percentages support up to two decimal places.');
  return bps;
}
export function validateDistributionPartners(partners: DistributionPartner[]): DistributionPartner[] {
  if (!Array.isArray(partners) || partners.length<2 || partners.length>20) throw new Error('Add 2–20 partners.');
  const seen=new Set<string>();
  const clean=partners.map((p)=>{
    const key=p.key.trim().toLowerCase();
    const name=p.name.trim();
    if (!key || !/^[a-z0-9_-]{1,40}$/.test(key)) throw new Error('Each partner needs a stable alphanumeric key.');
    if (!name || name.length>120) throw new Error('Each partner requires a name (maximum 120 characters).');
    if (seen.has(key)) throw new Error('Duplicate partner key: '+key);
    seen.add(key);
    return {key,name,percentage:boundedPercentage(p.percentage)/100};
  });
  const sum=clean.reduce((n,p)=>n+boundedPercentage(p.percentage),0);
  if(sum!==10000) throw new Error('Partner percentages must total exactly 100%.');
  return clean;
}
/** Assign remainder cents deterministically to largest fractional shares. */
function splitCents(totalCents: number, partners: DistributionPartner[]): number[] {
  const shares=partners.map((p,index)=>{
    const exact=totalCents*boundedPercentage(p.percentage)/10000;
    const cents=Math.floor(exact);
    return {index,cents,frac:exact-cents};
  });
  let remainder=totalCents-shares.reduce((sum,v)=>sum+v.cents,0);
  const order=[...shares].sort((a,b)=>b.frac-a.frac || a.index-b.index);
  for(let i=0;i<remainder;i++) order[i].cents++;
  return shares.map(s=>s.cents);
}
export function calculateFixedDistribution(partnersInput:DistributionPartner[],pools:ProfitPool[]):{lines:DistributionLine[];poolTotals:{own_fleet:number;twakkal:number};total:number} {
  const partners=validateDistributionPartners(partnersInput);
  if(pools.length!==2 || new Set(pools.map(p=>p.key)).size!==2 || !pools.some(p=>p.key==='own_fleet') || !pools.some(p=>p.key==='twakkal')) throw new Error('Both own-fleet and Twakkal profit sources are required.');
  const ownCents=moneyCents(pools.find(p=>p.key==='own_fleet')!.amount);
  const twakkalCents=moneyCents(pools.find(p=>p.key==='twakkal')!.amount);
  const ownShares=splitCents(ownCents,partners),twakkalShares=splitCents(twakkalCents,partners);
  const lines=partners.map((partner,i)=>({key:partner.key,name:partner.name,own_fleet:ownShares[i]/100,twakkal:twakkalShares[i]/100,total:(ownShares[i]+twakkalShares[i])/100}));
  return {lines,poolTotals:{own_fleet:ownCents/100,twakkal:twakkalCents/100},total:(ownCents+twakkalCents)/100};
}
export function effectiveRule<T extends {effective_from:string}>(rules:T[],month:string):T|null {
  if(!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month)) throw new Error('Choose the first day of a closing month.');
  return [...rules].filter(r=>r.effective_from<=month).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0]??null;
}
export function previewForMethod(method:DistributionMethod,partners:DistributionPartner[],pools:ProfitPool[]) {
  if(method==='custom_excel') throw new Error('Custom Excel method is pending approved formula mapping and cannot calculate or post.');
  if(method!=='fixed_percentage') throw new Error('Unknown profit distribution method.');
  return calculateFixedDistribution(partners,pools);
}
