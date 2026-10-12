import {describe,expect,it} from 'vitest';
import {resolveTransportDesk,workDeskColumnVisible} from './transportWorkDesks';

describe('Transport department desk projections',()=>{
  it('keeps legacy All Trips as default and respects saved column preferences',()=>{
    expect(resolveTransportDesk(null)).toBe('all');
    expect(resolveTransportDesk('unknown')).toBe('all');
    expect(workDeskColumnVisible('all','company_rate',['company_rate'])).toBe(false);
  });
  it('shows role-specific columns without mutating the saved All Trips layout',()=>{
    const saved=['company_rate','plate'];
    expect(workDeskColumnVisible('billing','company_rate',saved)).toBe(true);
    expect(workDeskColumnVisible('operations','plate',saved)).toBe(true);
    expect(workDeskColumnVisible('operations','supplier_paid',saved)).toBe(false);
    expect(saved).toEqual(['company_rate','plate']);
  });
  it('separates PPR and payment fields from unrelated working desks',()=>{
    expect(workDeskColumnVisible('ppr','paper_received_by',[])).toBe(true);
    expect(workDeskColumnVisible('ppr','rent_driver',[])).toBe(false);
    expect(workDeskColumnVisible('payments','supplier_balance',[])).toBe(true);
    expect(workDeskColumnVisible('payments','remaining_company',[])).toBe(true);
  });
});
