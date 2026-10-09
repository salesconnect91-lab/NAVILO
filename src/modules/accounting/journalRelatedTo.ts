/** Journal "Related To" is a presentation choice. Party and vehicle IDs stay separate. */
export type JournalRelatedToMode = 'party' | 'vehicle' | 'general';
export function journalRelatedToMode(_accountType:string|undefined,requiresParty:boolean,_isTransport:boolean):JournalRelatedToMode{
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
