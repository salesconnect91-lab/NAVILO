// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import JournalImportFilePicker from './JournalImportFilePicker';
afterEach(()=>{cleanup();vi.restoreAllMocks()});
describe('Journal import visible native file picker',()=>{
 it('renders a physically visible keyboard-accessible native file input (never sr-only or hidden)',()=>{
  const upload=vi.fn();
  const view=render(<JournalImportFilePicker disabled={false} processing={false} fileName="" error={null} onFile={upload}/>);
  const input=screen.getByLabelText('Choose Journal File') as HTMLInputElement;
  expect(input.type).toBe('file');
  expect(input.accept).toContain('.xlsx');
  expect(input.className).toContain('block');
  expect(input.className).not.toMatch(/(?:^|\s)(sr-only|hidden|invisible)(?:\s|$)/);
  expect(input.getAttribute('tabindex')).toBeNull();
  expect(input.disabled).toBe(false);
  expect(view.container.querySelector('label[for="journal-bulk-upload-file"]')).not.toBeNull();
  expect(screen.getByText(/No file selected yet/)).toBeTruthy();
  fireEvent.change(input,{target:{files:[new File(['dummy'],'NAVILO-Journal-Simple-Debit-Credit.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})]}});
  expect(upload).toHaveBeenCalledTimes(1);
 });
 it('shows filename and explicit reason with row/column details next to the actual file input',()=>{
  render(<JournalImportFilePicker disabled={false} processing={false} fileName="NAVILO-Journal-Simple-Debit-Credit.xlsx" error="Row 7: Debit and Credit cannot both contain values. Use either one." onFile={vi.fn()}/>);
  expect(screen.getByLabelText('Choose Journal File')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('NAVILO-Journal-Simple-Debit-Credit.xlsx');
  expect(screen.getByRole('alert').textContent).toContain('Row 7: Debit and Credit cannot both contain values');
  expect(screen.getByRole('alert').textContent).toContain('rejected file does not create or post');
 });
 it('disables actual picker only during processing or posting',()=>{
  render(<JournalImportFilePicker disabled processing fileName="test.xlsx" error={null} onFile={vi.fn()}/>);
  expect((screen.getByLabelText('Choose Journal File') as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByRole('status').textContent).toContain('Reading and checking');
 });
});
