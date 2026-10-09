import {describe,it,expect} from 'vitest';
import {balanceSheetClassification,compareBalanceSheetPresentation} from './balanceSheetPresentation';
describe('Balance Sheet readable classification and account grouping',()=>{
  it('converts raw technical detail types into professional report labels',()=>{
    expect(balanceSheetClassification('liability','other_current_liability','Other Account').label).toBe('Other Current Liability');
    expect(balanceSheetClassification('liability','current_liabilities','Other Account').label).toBe('Other Current Liability');
    expect(balanceSheetClassification('liability','long_term_loan','Twakkal Loan Payable').label).toBe('Long-Term Loan');
    expect(balanceSheetClassification('equity','retained_earnings','Retained Earnings').label).toBe('Retained Earnings');
    expect(balanceSheetClassification('equity','owners_equity','Pakistan Capital').label).toBe('Partner Capital');
    expect(balanceSheetClassification('asset','other_current_asset','Misc').label).toBe('Other Current Asset');
  });
  it('shows salary khata balances together without calling them advances',()=>{
    expect(balanceSheetClassification('liability','other_current_liability','Yasir Salary Running Account').label).toBe('Salary Running Account');
    expect(balanceSheetClassification('liability','other_current_liability','Asif Salary Balance').label).toBe('Salary Running Account');
  });
  it('sorts partner equity by capital, current, pending profit, retained earnings',()=>{
    const names=['August 2026 Undistributed Profit','PK Partner Current Account','Retained Earnings','Usman Personal Capital','Pakistan Capital'];
    const sorted=names.map(name=>({name,detailType:'owners_equity',amount:0})).sort((a,b)=>compareBalanceSheetPresentation(a,b,'equity')).map(x=>x.name);
    expect(sorted).toEqual(['Pakistan Capital','Usman Personal Capital','PK Partner Current Account','August 2026 Undistributed Profit','Retained Earnings']);
  });
  it('keeps salary running accounts adjacent, sorted by name, with totals intact',()=>{
    const balances=[
      {name:'Yasir Salary Running Account',detailType:'other_current_liability',amount:-3241},
      {name:'Twakkal Running Payable',detailType:'current_liabilities',amount:26634.05},
      {name:'Saeed Salary Running Account',detailType:'other_current_liability',amount:-760.42},
      {name:'Unallocated Customer Advances',detailType:'other_current_liability',amount:11200},
      {name:'Waqas Salary Running Account',detailType:'other_current_liability',amount:-2012},
    ];
    const sum=balances.reduce((n,x)=>n+x.amount,0);
    const sorted=balances.sort((a,b)=>compareBalanceSheetPresentation(a,b,'liability'));
    expect(sorted.map(x=>x.name)).toEqual([
      'Unallocated Customer Advances','Twakkal Running Payable',
      'Saeed Salary Running Account','Waqas Salary Running Account','Yasir Salary Running Account',
    ]);
    expect(sorted.reduce((n,x)=>n+x.amount,0)).toBeCloseTo(sum,2);
  });
});
