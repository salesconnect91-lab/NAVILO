// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ConsolidatedInvoiceGuard from './ConsolidatedInvoiceGuard';

const scope = vi.hoisted(() => ({ type: 'transport' }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ activeBusinessUnit: { business_unit_type: scope.type } }) }));
afterEach(cleanup);

describe('consolidated invoice business scope', () => {
  it.each(['sales', 'purchase'] as const)('redirects a direct %s consolidated link to Transport service creation', side => {
    scope.type = 'transport';
    render(<MemoryRouter initialEntries={[`/${side}/consolidated`]}><Routes>
      <Route path={`/${side}/consolidated`} element={<ConsolidatedInvoiceGuard side={side}><div>Stock consolidated documents</div></ConsolidatedInvoiceGuard>} />
      <Route path={`/${side}/new`} element={<div>Trip service invoice</div>} />
    </Routes></MemoryRouter>);
    expect(screen.getByText('Trip service invoice')).toBeTruthy();
    expect(screen.queryByText('Stock consolidated documents')).toBeNull();
  });
  it.each(['sales', 'purchase'] as const)('preserves the existing %s consolidated screen for Steel', side => {
    scope.type = 'steel';
    render(<MemoryRouter><ConsolidatedInvoiceGuard side={side}><div>Stock consolidated documents</div></ConsolidatedInvoiceGuard></MemoryRouter>);
    expect(screen.getByText('Stock consolidated documents')).toBeTruthy();
  });
});
