import {describe,it,expect} from 'vitest';
import {isManualJournalAccountEligible,isManualJournalAccountVisible,manualJournalAccountRestriction} from './manualJournalAccountPolicy';

const base = {is_active:true,is_group:false,allow_manual_entries:true,type:'asset',code:'1110',name:'Cash'};
describe('Manual Journal account policy',()=>{
  it('allows ordinary balance sheet accounts',()=>{
    expect(isManualJournalAccountEligible(base)).toBe(true);
    expect(isManualJournalAccountEligible({...base,type:'liability',code:'2200',name:'Accrued Liabilities'})).toBe(true);
  });
  it('excludes income and expense posting from manual billing',()=>{
    for(const type of ['revenue','income','expense','REVENUE']){
      expect(isManualJournalAccountEligible({...base,type})).toBe(false);
    }
  });
  it('keeps invoice-only accounts discoverable while blocking manual posting',()=>{
    const vehicleIncome={...base,type:'revenue',code:'4001',name:'Vehicle 7979 Income'};
    expect(isManualJournalAccountVisible(vehicleIncome)).toBe(true);
    expect(isManualJournalAccountEligible(vehicleIncome)).toBe(false);
    expect(manualJournalAccountRestriction(vehicleIncome)).toBe('Invoice-only account');
  });
  it('excludes VAT control accounts regardless of account type',()=>{
    expect(isManualJournalAccountEligible({...base,code:'1150',name:'Input VAT'})).toBe(false);
    expect(isManualJournalAccountEligible({...base,code:'2120',name:'Output VAT',type:'liability'})).toBe(false);
    expect(isManualJournalAccountEligible({...base,code:'9999',name:'Input VAT Recoverable'})).toBe(false);
  });
  it('respects group and manual-entry restrictions',()=>{
    expect(isManualJournalAccountEligible({...base,is_group:true})).toBe(false);
    expect(isManualJournalAccountEligible({...base,allow_manual_entries:false})).toBe(false);
    expect(isManualJournalAccountEligible({...base,is_active:false})).toBe(false);
  });
  it('does not show inactive, group, or manually disabled accounts in the selector',()=>{
    expect(isManualJournalAccountVisible({...base,is_group:true})).toBe(false);
    expect(isManualJournalAccountVisible({...base,is_active:false})).toBe(false);
    expect(isManualJournalAccountVisible({...base,allow_manual_entries:false})).toBe(false);
  });
});
