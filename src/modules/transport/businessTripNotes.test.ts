import {expect,it} from 'vitest';
import {businessTripNotes} from './businessTripNotes';
it('shows source remarks and suppresses generated audit metadata',()=>{
 const raw=Array(32).fill('');raw[31]='Waiting charges agreed';const note=`Legacy CSV Trip 123; Driver ADIL; Historical CSV evidence UNPOSTED (not ledger balances); SHA256 abc; original positional values ${JSON.stringify(raw)}`;
 expect(businessTripNotes(note)).toBe('Waiting charges agreed');expect(businessTripNotes(note.replace(JSON.stringify(raw),'broken'))).toBe('');
});
it('preserves ordinary business notes and user-edited notes',()=>{expect(businessTripNotes('Delivery waiting — call customer')).toBe('Delivery waiting — call customer');expect(businessTripNotes(null)).toBe('');});

it('decodes the escaped positional JSON used by the legacy importer',()=>{const raw=Array(32).fill('');raw[31]=' local rent 1500';const payload=JSON.stringify(JSON.stringify(raw)).slice(1,-1);expect(businessTripNotes(`Legacy CSV Trip 16973; Historical CSV evidence UNPOSTED; SHA256 abc; original positional values ${payload}`)).toBe(' local rent 1500');});
