// @vitest-environment jsdom
import {afterEach,describe,expect,it} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {createRef} from 'react';
import TransportHorizontalScroll from './TransportHorizontalScroll';
afterEach(cleanup);
describe('Trips bottom scrollbar',()=>{
 it('converts wheel to horizontal motion, mirrors both directions and preserves Ctrl zoom',()=>{
  const grid=document.createElement('div');Object.defineProperties(grid,{scrollWidth:{value:2000},clientWidth:{value:500}});
  const ref=createRef<HTMLDivElement>();Object.defineProperty(ref,'current',{value:grid});
  render(<TransportHorizontalScroll gridRef={ref} revision="test"/>);const bar=screen.getByLabelText('Trips horizontal scrollbar');
  const event=new WheelEvent('wheel',{deltaY:40,bubbles:true,cancelable:true});act(()=>bar.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);expect(grid.scrollLeft).toBe(40);expect(bar.scrollLeft).toBe(40);
  grid.scrollLeft=90;fireEvent.scroll(grid);expect(bar.scrollLeft).toBe(90);
  bar.scrollLeft=120;fireEvent.scroll(bar);expect(grid.scrollLeft).toBe(120);
  const zoom=new WheelEvent('wheel',{deltaY:10,ctrlKey:true,cancelable:true});act(()=>bar.dispatchEvent(zoom));
  expect(zoom.defaultPrevented).toBe(false);expect(grid.scrollLeft).toBe(120);
 });
});
