// @vitest-environment jsdom
import {afterEach,describe,it,expect} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import JournalDescription from './JournalDescription';
afterEach(cleanup);
describe('Saved journal description',()=>{
 it('shows JE-1051 saved narration',()=>{const text='Al Rajhi Bank-PAID TO PAK FOR CHARITY / USMAN';render(<JournalDescription text={text}/>);expect(screen.getByText(text).textContent).toBe(text)});
 it('retains spreadsheet rows and tabs',()=>{const text='07-Sep-26\tAl Rajhi Bank\tCHARITY\n24-Sep-26\tAl Rajhi Bank\tPERSONAL';const {container}=render(<JournalDescription text={text}/>);expect(container.textContent).toBe(text);expect(container.firstElementChild?.className).toContain('whitespace-pre-wrap')});
 it('shows a dash only when no description exists',()=>{render(<JournalDescription text={null}/>);expect(screen.getByText('—')).toBeTruthy()});
});
