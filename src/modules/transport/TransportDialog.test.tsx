// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import TransportDialog from './TransportDialog';
afterEach(cleanup);
it('escapes transformed hosts and restores focus and page scrolling after closing',()=>{
 const host=document.createElement('div');host.style.transform='translateX(20px)';document.body.append(host);
 const trigger=document.createElement('button');document.body.append(trigger);trigger.focus();
 const {unmount}=render(<TransportDialog><section role="dialog"><button>Close test</button><input aria-label="Test search"/></section></TransportDialog>,{container:host});
 expect(host.querySelector('[role="dialog"]')).toBeNull();
 expect(document.body.style.overflow).toBe('hidden');
 const first=screen.getByRole('button',{name:'Close test'}),last=screen.getByLabelText('Test search');last.focus();fireEvent.keyDown(last,{key:'Tab'});expect(document.activeElement).toBe(first);
 unmount();expect(document.body.style.overflow).toBe('');expect(document.activeElement).toBe(trigger);host.remove();trigger.remove();
});
it('closes only the top dialog on Escape and retains the outer scroll lock',()=>{
 const outer=vi.fn(),inner=vi.fn();
 const {rerender}=render(<TransportDialog onClose={outer}><section><button>Outer</button><TransportDialog onClose={inner}><section><button>Inner</button></section></TransportDialog></section></TransportDialog>);
 fireEvent.keyDown(screen.getByRole('button',{name:'Inner'}),{key:'Escape'});expect(inner).toHaveBeenCalledTimes(1);expect(outer).not.toHaveBeenCalled();
 rerender(<TransportDialog onClose={outer}><section><button>Outer</button></section></TransportDialog>);expect(document.body.style.overflow).toBe('hidden');
});
