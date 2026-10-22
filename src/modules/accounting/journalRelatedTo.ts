/** Journal "Related To" is a presentation choice. Party and vehicle IDs stay separate. */
export type JournalRelatedToMode = 'party' | 'vehicle' | 'general';
export function journalRelatedToMode(accountType:string|undefined,requiresParty:boolean,isTransport:boolean):JournalRelatedToMode{
  // Expense/income lines never open customer/supplier identity simply because a GL is linked to a party.
  // The party selector belongs only to genuine AR/AP control accounts.
  const type=String(accountType??'').toLowerCase();
  // Transport expenses are posted to their expense GL directly. Do not ask for
  // a second vehicle allocation; vehicle expense tagging is not part of this workflow.
  if(type==='expense')return 'general';
  if(['revenue','income'].includes(type))return isTransport?'vehicle':'general';
  if(requiresParty)return 'party';
  return 'general';
}
export type OwnedPeriod={vehicle_id:string;owner_type:string;effective_from:string;effective_to:string|null};
export function vehicleOwnedOnDate(vehicleId:string,date:string|undefined,periods:OwnedPeriod[]):boolean{
  if(!vehicleId||!date)return false;
  return periods.some(p=>p.vehicle_id===vehicleId&&p.owner_type==='company'&&p.effective_from<=date&&(!p.effective_to||p.effective_to>=date));
}
export function normalizedJournalVehicleNo(value:string):string{
  return value.split('·')[0].trim().toLocaleUpperCase();
}
