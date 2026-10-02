// @vitest-environment jsdom
import {useState} from 'react';
import {afterEach,describe,it,expect} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import NaviloDateInput from './NaviloDateInput';
afterEach(cleanup);
function View(){const [date,setDate]=useState('2026-10-02');return <form><NaviloDateInput aria-label="Trip Date" value={date} required min="2026-01-01" onChange={e=>setDate(e.target.value)}/><output>{date}</output></form>}
describe('ISO-backed date entry',()=>{
 it('displays dd-mmm-yy and emits ISO from text and calendar',()=>{render(<View/>);const input=screen.getByLabelText('Trip Date') as HTMLInputElement;expect(input.value).toBe('02-Oct-26');fireEvent.change(input,{target:{value:'3-Nov-26'}});expect(screen.getByRole('status').textContent).toBe('2026-11-03');fireEvent.blur(input);expect(input.value).toBe('03-Nov-26');fireEvent.change(screen.getByLabelText('Trip Date calendar'),{target:{value:'2026-12-04'}});expect(input.value).toBe('04-Dec-26');expect(screen.getByRole('status').textContent).toBe('2026-12-04')});
 it('blocks invalid or out-of-range dates and clears the stale stored date',()=>{render(<View/>);const input=screen.getByLabelText('Trip Date') as HTMLInputElement;fireEvent.change(input,{target:{value:'31-Feb-26'}});expect(input.checkValidity()).toBe(false);expect(screen.getByRole('status').textContent).toBe('');expect(input.value).toBe('31-Feb-26');fireEvent.change(input,{target:{value:'31-Dec-25'}});expect(input.checkValidity()).toBe(false);fireEvent.change(input,{target:{value:''}});expect(input.checkValidity()).toBe(false)});
});
