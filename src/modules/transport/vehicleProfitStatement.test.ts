import {expect,it} from 'vitest';
import {vehicleProfitStatement} from './vehicleProfitStatement';
const historic=[{vehicle_id:'v',month:'2026-08-01',net_profit:-7856.28,entry_no:'COB'}];
const movement={event_id:'manual',account_id:'v',event_date:'2026-09-02',entry_no:'JE-1',revenue:0,cost:100};
it('shows historical opening as net result rather than new income, including pre-trip vehicles',()=>{
 const r=vehicleProfitStatement('v','2026-08-01','2026-10-09',[],historic);
 expect(r.revenue).toBe(0);expect(r.cost).toBe(0);expect(r.historical).toBe(-7856.28);expect(r.closing).toBe(-7856.28);expect(r.rows[0].entry_no).toBe('COB');
});
it('carries historical opening into a later period and includes manual vehicle cost once',()=>{
 const r=vehicleProfitStatement('v','2026-09-01','2026-09-30',[movement],historic);
 expect(r.opening).toBe(-7856.28);expect(r.historical).toBe(0);expect(r.cost).toBe(100);expect(r.closing).toBe(-7956.28);
});
it('suppresses reconstructed activity for the authoritative historical month and excludes other vehicles',()=>{
 const r=vehicleProfitStatement('v','','2026-09-30',[{...movement,event_date:'2026-08-10',cost:999},{...movement,account_id:'other',cost:500},movement],historic);
 expect(r.cost).toBe(100);expect(r.rows).toHaveLength(2);
});
it('reversal offsets cost without erasing the original voucher and future dates stay excluded',()=>{
 const r=vehicleProfitStatement('v','2026-09-01','2026-09-30',[movement,{...movement,event_id:'reverse',entry_no:'REV',event_date:'2026-09-03',cost:-100},{...movement,event_date:'2026-10-01',cost:999}],historic);
 expect(r.cost).toBe(0);expect(r.rows).toHaveLength(2);expect(r.closing).toBe(-7856.28);
});

it('keeps additional manual journal corrections in a historical month',()=>{const r=vehicleProfitStatement('v','','2026-09-30',[{...movement,category:'Manual journal',event_date:'2026-08-15'}],historic);expect(r.cost).toBe(100);expect(r.closing).toBe(-7956.28);});
