import {describe,it,expect} from 'vitest';
import {formatNaviloDate,parseNaviloDate} from './naviloDate';
describe('NAVILO date contract',()=>{
 it('formats dates and timestamps without timezone shifts',()=>{expect(formatNaviloDate('2026-10-02')).toBe('02-Oct-26');expect(formatNaviloDate('2026-10-02T23:59:00-07:00')).toBe('02-Oct-26')});
 it('accepts display and ISO values but returns only ISO',()=>{expect(parseNaviloDate('2-oct-26')).toBe('2026-10-02');expect(parseNaviloDate('02-Oct-2026')).toBe('2026-10-02');expect(parseNaviloDate('2026-10-02')).toBe('2026-10-02')});
 it('validates leap years and impossible dates',()=>{expect(parseNaviloDate('29-Feb-24')).toBe('2024-02-29');for(const date of ['29-Feb-26','31-Apr-26','00-Oct-26','12-Xxx-26','2026-13-01'])expect(parseNaviloDate(date)).toBeNull()});
 it('handles empty values',()=>{expect(parseNaviloDate('')).toBe('');expect(formatNaviloDate(null)).toBe('—');expect(formatNaviloDate('invalid')).toBe('—')});
});
