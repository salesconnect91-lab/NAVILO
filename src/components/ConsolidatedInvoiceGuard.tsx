import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';

export default function ConsolidatedInvoiceGuard({ side, children }: { side: 'sales' | 'purchase'; children: ReactNode }) {
  const { activeBusinessUnit } = useAuth();
  return activeBusinessUnit?.business_unit_type === 'transport'
    ? <Navigate to={`/${side}/new`} replace />
    : <>{children}</>;
}
