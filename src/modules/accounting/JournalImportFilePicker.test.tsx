// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import JournalImportFilePicker from './JournalImportFilePicker';
afterEach(()=>{cleanup();vi.restoreAllMocks()});
describe('Journal Choose File accessibility and feedback',()=>{
 it('opens native file selection from a real button and accepts .xlsx',()=>{
  const upload=vi.fn();
  const {container}=render(<JournalImportFilePicker disabled={false} processing={false} fileName="" error={null} onFile={upload}/>);
  const input=screen.getByLabelText('Select Journal Excel or CSV file') as HTMLInputElement;
  const click=vi.spyOn(input,'click').mockImplementation(()=>{});
  fireEvent.click(screen.getByRole('button',{name:'Choose File'}));
  expect(click).toHaveBeenCalledTimes(1);
  expect(input.accept).toContain('.xlsx');
  expect(input.disabled).toBe(false);
  expect(container.querySelector('input[type="file"]')).toBe(input);
  const file=new File(['dummy'],'NAVILO-Journal-Simple-Debit-Credit.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  fireEvent.change(input,{target:{files:[file]}});
  expect(upload).toHaveBeenCalledTimes(1);
 });
 it('shows the selected filename and exact validation error inside the same modal upload area',()=>{
  render(<JournalImportFilePicker disabled={false} processing={false} fileName="NAVILO-Journal-Simple-Debit-Credit.xlsx" error="Row 2: enter a valid Debit OR Credit." onFile={vi.fn()}/>);
  expect(screen.getByRole('status').textContent).toContain('NAVILO-Journal-Simple-Debit-Credit.xlsx');
  expect(screen.getByRole('alert').textContent).toContain('Row 2: enter a valid Debit OR Credit');
  expect(screen.getByRole('alert').textContent).toContain('No journal has been loaded or posted');
 });
 it('disables Choose File during another import or posting',()=>{
  const select=vi.fn();
  render(<JournalImportFilePicker disabled processing fileName="" error={null} onFile={select}/>);
  expect((screen.getByRole('button',{name:'Processing...'}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText('Select Journal Excel or CSV file') as HTMLInputElement).disabled).toBe(true);
 });
});
