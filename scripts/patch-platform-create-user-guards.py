"""Apply the reviewed fail-closed Platform Owner create_user guard patch.

Run from repository root. The script refuses unexpected source changes and never
modifies production, database records, or user accounts.
"""
from pathlib import Path

path = Path('supabase/functions/platform-admin/index.ts')
source = path.read_text(encoding='utf-8')
old = '''      const [{ data: company }, { count }] = await Promise.all([
        admin.from("companies").select("max_users").eq("id", companyId).single(),
        admin
          .from("company_memberships")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("is_active", true),
      ]);

      if (company && (count || 0) >= company.max_users) {
        return json({ error: "Company user limit reached" }, 409);
      }
'''
new = '''      const [companyResult, membershipResult] = await Promise.all([
        admin.from("companies").select("max_users").eq("id", companyId).single(),
        admin
          .from("company_memberships")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("is_active", true),
      ]);

      // Never create an Auth user if its company or membership limit cannot be verified.
      if (companyResult.error || !companyResult.data) {
        return json({ error: "Company could not be verified" }, companyResult.error ? 503 : 404);
      }
      if (membershipResult.error || membershipResult.count === null) {
        return json({ error: "Company user count could not be verified" }, 503);
      }
      const maxUsers = Number(companyResult.data.max_users);
      if (!Number.isSafeInteger(maxUsers) || maxUsers < 1) {
        return json({ error: "Company user limit is invalid" }, 503);
      }
      if (membershipResult.count >= maxUsers) {
        return json({ error: "Company user limit reached" }, 409);
      }
'''
if source.count(old) != 1:
    raise SystemExit('Refusing patch: expected create_user guard occurs other than once')
if source.count(new) != 0:
    raise SystemExit('Refusing patch: guard is already present')
updated = source.replace(old, new, 1)
if updated.count('admin.auth.admin.createUser({') != source.count('admin.auth.admin.createUser({'):
    raise SystemExit('Refusing patch: unexpected Auth user creation change')
path.write_text(updated, encoding='utf-8')
print('Applied create_user company and membership fail-closed checks')
