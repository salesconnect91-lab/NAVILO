import {describe,it,expect} from 'vitest';
import {salarySheetPosition} from './salaryBalanceSheet';
describe('Salary-linked Balance Sheet presentation',()=>{
  it('keeps a COA salary running liability with debit balance in Liabilities as a negative',()=>{
    expect(salarySheetPosition('liability',3241,0)).toEqual({bucket:'liability',signedAmount:-3241});
  });
  it('shows a salary payable as a positive liability',()=>{
    expect(salarySheetPosition('liability',0,417)).toEqual({bucket:'liability',signedAmount:417});
  });
  it('keeps an explicitly mapped asset in Assets',()=>{
    expect(salarySheetPosition('asset',760.42,0)).toEqual({bucket:'asset',signedAmount:760.42});
  });
  it('does not put salary expenses in either Balance Sheet category',()=>{
    expect(salarySheetPosition('expense',1000,0)).toBeNull();
  });
  it('sums debit and credit of mixed salary-ledger activity by net movement',()=>{
    expect(salarySheetPosition('liability',1000,700)).toEqual({bucket:'liability',signedAmount:-300});
  });
});
