import type { ReactNode } from 'react';
import TransportInvoiceCreate from '@/modules/transport/TransportInvoiceCreate';
import { useAuth } from '@/auth/AuthContext';

export default function ConsolidatedInvoiceGuard({ side, children }: { side: 'sales' | 'purchase'; children: ReactNode }) {
  const { activeBusinessUnit } = useAuth();
  return activeBusinessUnit?.business_unit_type === 'transport'
    ? <TransportInvoiceCreate side={side === 'sales' ? 'customer' : 'supplier'} consolidated />
    : <>{children}</>;
}
