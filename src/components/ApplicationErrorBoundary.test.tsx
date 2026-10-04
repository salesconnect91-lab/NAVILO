// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import ApplicationErrorBoundary,{isChunkLoadError} from './ApplicationErrorBoundary';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('shows a user-controlled recovery instead of a blank screen for a missing deployment chunk',()=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});
 const reload=vi.fn();
 const FailedScreen=()=>{throw new TypeError('Failed to fetch dynamically imported module: /assets/Dashboard-old.js');};
 render(<ApplicationErrorBoundary onReload={reload}><FailedScreen/></ApplicationErrorBoundary>);
 expect(screen.getByRole('alert').textContent).toContain('This screen needs a refresh');
 expect(reload).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Reload page'}));expect(reload).toHaveBeenCalledTimes(1);
});
it('does not misclassify a business validation error as a deployment chunk failure',()=>{
 expect(isChunkLoadError(new Error('Supplier/AP mapping mismatch'))).toBe(false);
 expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
});
it('renders a healthy screen normally',()=>{
 render(<ApplicationErrorBoundary><p>Trips ready</p></ApplicationErrorBoundary>);
 expect(screen.getByText('Trips ready')).toBeTruthy();expect(screen.queryByRole('alert')).toBeNull();
});
