export type PostedJournalActionCandidate = {
  status?:string|null;
  trans_type?:string|null;
  entry_no?:string|null;
  reversal_of_entry_id?:string|null;
  source_module?:string|null;
  source_document_type?:string|null;
  source_document_id?:string|null;
  fiscal_year_closure_id?:string|null;
  monthly_profit_closure_id?:string|null;
};

/**
 * Match the server's manual-only reversal rules. General is used for thousands
 * of generated journals and must not expose a manual reversal action.
 * The server remains the final authority for all permissions and posting gates.
 */
export function canReversePostedManualJournal(entry:PostedJournalActionCandidate):boolean{
  if(entry.status!=="posted"||entry.reversal_of_entry_id)return false;
  if(!["","Journal Entry","Manual Journal"].includes(entry.trans_type??""))return false;
  if(entry.source_module||entry.source_document_type||entry.source_document_id)return false;
  if(entry.fiscal_year_closure_id||entry.monthly_profit_closure_id)return false;
  if((entry.entry_no??"").startsWith("COB-")||(entry.entry_no??"").startsWith("REV-"))return false;
  return true;
}
