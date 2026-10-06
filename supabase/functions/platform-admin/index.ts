import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { checkOnboardingLookups } from "./onboardingPreflight.ts";
import { onboardingFiscalSettings, onboardingModules } from "./onboardingModules.ts";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...HEADERS, "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: HEADERS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: userData } = await admin.auth.getUser(token);
  if (!userData.user) return json({ error: "Invalid session" }, 401);

  const actor = userData.user;
  const { data: profile } = await admin
    .from("user_profiles")
    .select("is_active,platform_role")
    .eq("id", actor.id)
    .single();

  if (!profile?.is_active || profile.platform_role !== "super_admin") {
    return json({ error: "Super Admin access required" }, 403);
  }

  const body = await request.json();
  const action = String(body.action || "");

  try {
    if (action === "onboard_company") {
      const name = String(body.name || "").trim();
      const code = String(body.code || "").trim().toUpperCase();
      const ownerEmail = String(body.owner_email || "").trim().toLowerCase();
      const ownerName = String(body.owner_name || "").trim();
      const countryCode = String(body.country_code || "PK").trim().toUpperCase();
      const password = String(body.password || "");
      const planId = String(body.plan_id || "");
      const unitName = String(body.business_unit_name || name).trim();
      const unitCode = String(body.business_unit_code || code).trim().toUpperCase();
      const branchName = String(body.branch_name || "Head Office").trim();
      const branchCode = String(body.branch_code || "HO").trim().toUpperCase();
      const status = body.status === "active" ? "active" : "trial";
      const businessType = String(body.business_unit_type || "custom");
      if (!name || !code || !ownerName || !ownerEmail || !planId || !unitName || !unitCode || !branchName || !branchCode || !/^[A-Z]{2}$/.test(countryCode)) {
        return json({ error: "Company, owner, plan, business unit and branch details are required." }, 400);
      }
      if (unitName.length < 2 || !/[A-Za-z]/.test(unitName)) return json({ error: "Workspace name must be at least 2 characters and include a letter." }, 400);
      if (!/^[A-Z][A-Z0-9_-]{1,9}$/.test(unitCode)) return json({ error: "Workspace code must be 2-10 characters, start with a letter, and use only A-Z, 0-9, _ or -." }, 400);
      if (password.length < 8) return json({ error: "Temporary password must be at least 8 characters." }, 400);

      const [codeLookup, nameLookup, planLookup] = await Promise.all([
        admin.from("companies").select("id").eq("code",code).limit(1).maybeSingle(),
        admin.from("companies").select("id").ilike("name",name).limit(1).maybeSingle(),
        admin.from("subscription_plans").select("*").eq("id", planId).eq("is_active", true).maybeSingle(),
      ]);
      const preflight = checkOnboardingLookups(codeLookup, nameLookup, planLookup);
      if (!preflight.ok) return json({ error: preflight.error }, preflight.status);
      const plan = planLookup.data!;
      if (status === "trial" && Number(plan.trial_days || 0) <= 0) return json({ error: "Selected plan does not include a trial period." }, 400);
      let modules: string[];
      let fiscalSettings: ReturnType<typeof onboardingFiscalSettings>;
      try {
        modules = onboardingModules(body.modules, plan.module_defaults, businessType);
        fiscalSettings = onboardingFiscalSettings(body.base_currency_code, body.tax_mode, body.tax_effective_from, body.tax_authority_code);
      }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid modules" }, 400); }

      const startsAt = new Date();
      const requestedExpiry = body.expires_at ? new Date(String(body.expires_at)) : null;
      const expiresAt = requestedExpiry && !Number.isNaN(requestedExpiry.getTime())
        ? requestedExpiry
        : new Date(startsAt.getTime() + (status === "trial" ? Number(plan.trial_days || 14) : (plan.billing_cycle === "yearly" ? 365 : 30)) * 86400000);
      let companyId = "";
      let userId = "";
      let createdNewUser = false;
      try {
        const { data: createdCompany, error: companyError } = await admin.from("companies").insert({
          name, code, status, contact_email: ownerEmail, contact_phone: body.contact_phone || null,
          address: body.address || null, notes: body.notes || null, is_test_company: body.is_test_company === true, created_by: actor.id,
          subscription_expires_at: expiresAt.toISOString(), max_users: Number(plan.max_users || 10),
          max_business_units: Number(plan.max_business_units || 1), max_branches: Number(plan.max_branches || 1),
          max_godowns: Number(plan.max_godowns || 1),
        }).select("id").single();
        if (companyError || !createdCompany) throw companyError || new Error("Company creation failed");
        companyId = createdCompany.id;

        const { data: defaultUnit, error: defaultUnitError } = await admin.from("business_units")
          .select("id").eq("company_id", companyId).eq("is_default", true).maybeSingle();
        if (defaultUnitError) throw defaultUnitError;
        const { data: unit, error: unitError } = defaultUnit
          ? await admin.from("business_units").update({ name: unitName, code: unitCode, unit_type: businessType })
              .eq("id", defaultUnit.id).eq("company_id", companyId).select("id").single()
          : await admin.from("business_units").insert({
              company_id: companyId, name: unitName, code: unitCode, unit_type: businessType, is_default: true,
            }).select("id").single();
        if (unitError || !unit) throw unitError || new Error("Business unit creation failed");
        const { data: branch, error: branchError } = await admin.from("operating_locations").insert({
          company_id: companyId, business_unit_id: unit.id, name: branchName, code: branchCode, location_type: "branch", is_active: true,
        }).select("id").single();
        if (branchError || !branch) throw branchError || new Error("Branch creation failed");

        // Reuse an existing Auth login when the owner email is already registered.
        // This supports one person owning multiple NAVILO companies and, critically,
        // never downgrades an existing Platform Owner profile or overwrites its password.
        let ownerUser = null;
        for (let page = 1; !ownerUser; page += 1) {
          const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
          if (listError) throw listError;
          ownerUser = listed.users.find(user => String(user.email || "").toLowerCase() === ownerEmail) || null;
          if (ownerUser || listed.users.length < 1000) break;
        }

        if (ownerUser) {
          userId = ownerUser.id;
        } else {
          const { data: createdUser, error: userError } = await admin.auth.admin.createUser({
            email: ownerEmail, password, email_confirm: true, user_metadata: { full_name: ownerName || name },
          });
          if (userError || !createdUser.user) throw userError || new Error("Owner login creation failed");
          userId = createdUser.user.id;
          createdNewUser = true;
        }

        const { data: existingProfile, error: existingProfileError } = await admin.from("user_profiles")
          .select("id,is_active").eq("id", userId).maybeSingle();
        if (existingProfileError) throw existingProfileError;
        if (existingProfile && !existingProfile.is_active) throw new Error("Existing owner login is inactive");

        const profileWrite = existingProfile
          ? await admin.from("user_profiles").update({
              last_company_id: companyId,
              last_business_unit_id: unit.id,
              updated_at: new Date().toISOString(),
            }).eq("id", userId)
          : await admin.from("user_profiles").insert({
              id:userId,user_id:userId,role:"admin",is_active:true,full_name:ownerName||name,email:ownerEmail,
              platform_role:"user",last_company_id:companyId,last_business_unit_id:unit.id,updated_at:new Date().toISOString(),
            });
        if (profileWrite.error) throw profileWrite.error;
        // Company membership creates the default business unit membership in
        // the database trigger; creating it again would violate its unique key.
        const { error: membershipError } = await admin.from("company_memberships").insert({
          company_id:companyId,user_id:userId,role:"company_owner",is_active:true,permissions:{},invited_by:actor.id,
        });
        if (membershipError) throw membershipError;
        const writes = await Promise.all([
          admin.from("company_settings").update({ country_code: countryCode, currency: fiscalSettings.base_currency_code, updated_at: new Date().toISOString() }).eq("company_id", companyId),
          admin.from("company_accounting_policies").update({
            base_currency: fiscalSettings.base_currency_code,
            updated_by: actor.id,
            updated_at: new Date().toISOString(),
          }).eq("company_id", companyId),
          admin.from("operating_location_memberships").insert({ company_id:companyId,business_unit_id:unit.id,operating_location_id:branch.id,user_id:userId,role:"company_owner",is_active:true }),
          admin.from("company_subscriptions").insert({ company_id:companyId,plan_id:planId,billing_cycle:plan.billing_cycle,status,starts_at:startsAt.toISOString(),expires_at:expiresAt.toISOString(),amount:Number(plan.price||0),currency_code:plan.currency_code||"USD",created_by:actor.id,notes:"Created through Platform Owner onboarding" }),
          admin.from("company_modules").insert(modules.map(module_key=>({company_id:companyId,module_key,enabled:true,updated_by:actor.id}))),
          admin.from("business_unit_modules").insert(modules.map(module_key=>({company_id:companyId,business_unit_id:unit.id,module_key,enabled:true}))),
          admin.from("company_tax_events").insert({company_id:companyId,tax_mode:fiscalSettings.tax_mode,
            effective_from:fiscalSettings.tax_effective_from,authority_code:fiscalSettings.authority_code,created_by:actor.id}),
        ]);
        const writeError = writes.find(result => result.error)?.error;
        if (writeError) throw writeError;
        return json({ company_id:companyId,user_id:userId,business_unit_id:unit.id,branch_id:branch.id,status,expires_at:expiresAt.toISOString() }, 201);
      } catch (error) {
        if (createdNewUser && userId) await admin.auth.admin.deleteUser(userId);
        if (companyId) await admin.from("companies").delete().eq("id", companyId);
        return json({ error:error instanceof Error ? error.message : "Onboarding failed and was rolled back." }, 400);
      }
    }

    if (action === "create_user") {
      const email = String(body.email || "").trim().toLowerCase();
      const companyId = String(body.company_id || "");
      const businessUnitId = body.business_unit_id ? String(body.business_unit_id) : null;
      const operatingLocationId = body.operating_location_id ? String(body.operating_location_id) : null;
      const role = String(body.role || "viewer");
      const password = String(body.password || "");
      const fullName = String(body.full_name || "").trim();

      if (!email || !companyId) return json({ error: "Email and company are required" }, 400);
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);

      if (businessUnitId) {
        const { data: businessUnit } = await admin
          .from("business_units")
          .select("id")
          .eq("id", businessUnitId)
          .eq("company_id", companyId)
          .eq("is_active", true)
          .maybeSingle();
        if (!businessUnit) return json({ error: "Invalid business workspace" }, 400);
      }

      if (operatingLocationId) {
        if (!businessUnitId) return json({ error: "A branch login requires a business workspace" }, 400);
        const { data: location } = await admin
          .from("operating_locations")
          .select("id,business_unit_id")
          .eq("id", operatingLocationId)
          .eq("company_id", companyId)
          .eq("business_unit_id", businessUnitId)
          .eq("is_active", true)
          .maybeSingle();
        if (!location) return json({ error: "Invalid or inactive branch for this business workspace" }, 400);
      }

      const [companyResult, membershipResult] = await Promise.all([
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

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

      if (createError || !created.user) {
        return json({ error: createError?.message || "Could not create auth user" }, 400);
      }

      const userId = created.user.id;
      try {
        const profileRole = role === "company_owner"
          ? "admin"
          : role === "accounts"
          ? "accountant"
          : role === "store"
          ? "warehouse"
          : role === "production"
          ? "admin"
          : role;

        let result = await admin.from("user_profiles").upsert({
          id: userId,
          role: profileRole,
          is_active: true,
          full_name: fullName || null,
          email,
          platform_role: "user",
          last_company_id: companyId,
          last_business_unit_id: businessUnitId,
          locked_business_unit_id: businessUnitId,
          locked_operating_location_id: operatingLocationId,
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" });
        if (result.error) throw new Error(`Profile: ${result.error.message}`);

        result = await admin.from("company_memberships").upsert({
          company_id: companyId,
          user_id: userId,
          role,
          is_active: true,
          permissions: body.permissions || {},
          invited_by: actor.id,
        }, { onConflict: "company_id,user_id" });
        if (result.error) throw new Error(`Company access: ${result.error.message}`);

        if (businessUnitId) {
          result = await admin.from("business_unit_memberships").upsert({
            company_id: companyId,
            business_unit_id: businessUnitId,
            user_id: userId,
            role,
            is_active: true,
          }, { onConflict: "business_unit_id,user_id" });
          if (result.error) throw new Error(`Business access: ${result.error.message}`);
        }

        if (operatingLocationId && businessUnitId) {
          result = await admin.from("operating_location_memberships").upsert({
            company_id: companyId,
            business_unit_id: businessUnitId,
            operating_location_id: operatingLocationId,
            user_id: userId,
            role,
            is_active: true,
          }, { onConflict: "operating_location_id,user_id" });
          if (result.error) throw new Error(`Branch access: ${result.error.message}`);
        }

        return json({ user: { id: userId, email, company_id: companyId, business_unit_id: businessUnitId, operating_location_id: operatingLocationId } });
      } catch (error) {
        await admin.auth.admin.deleteUser(userId);
        return json({ error: error instanceof Error ? error.message : "User setup failed" }, 500);
      }
    }

    if (action === "create_company") {
      const name = String(body.name || "").trim();
      const code = String(body.code || "").trim().toUpperCase();
      if (!name || !code) return json({ error: "Company name and code are required" }, 400);

      const { data: existing } = await admin
        .from("companies")
        .select("id,name,code")
        .eq("code", code)
        .maybeSingle();
      if (existing) return json({ error: `Company code ${code} already exists.` }, 409);

      const { data, error } = await admin.from("companies").insert({
        name,
        code,
        status: "active",
        max_users: Math.max(1, Number(body.max_users || 10)),
        contact_email: body.contact_email || null,
        contact_phone: body.contact_phone || null,
        address: body.address || null,
        notes: body.notes || null,
        is_test_company: body.is_test_company === true,
        subscription_expires_at: body.subscription_expires_at || null,
        created_by: actor.id,
      }).select("*").single();
      if (error) throw error;
      return json({ company: data });
    }

    if (action === "update_user_identity") {
      const companyId = String(body.company_id || "");
      const userId = String(body.user_id || "");
      const fullName = String(body.full_name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      if (!companyId || !userId || !fullName || !email) return json({ error: "Company, user, full name and email are required." }, 400);

      const { data: membership, error: membershipError } = await admin
        .from("company_memberships")
        .select("id")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) return json({ error: "User is not assigned to this company." }, 404);

      const { data: authLookup, error: authLookupError } = await admin.auth.admin.getUserById(userId);
      if (authLookupError || !authLookup.user) return json({ error: authLookupError?.message || "Auth user not found." }, 404);
      const previousEmail = String(authLookup.user.email || "").toLowerCase();
      const previousName = String(authLookup.user.user_metadata?.full_name || "");

      const { error: authError } = await admin.auth.admin.updateUserById(userId, {
        email,
        email_confirm: true,
        user_metadata: { ...authLookup.user.user_metadata, full_name: fullName },
      });
      if (authError) return json({ error: authError.message }, 400);

      const { error: profileError } = await admin
        .from("user_profiles")
        .update({ full_name: fullName, email, updated_at: new Date().toISOString() })
        .eq("id", userId);
      if (profileError) {
        await admin.auth.admin.updateUserById(userId, {
          email: previousEmail || undefined,
          email_confirm: true,
          user_metadata: { ...authLookup.user.user_metadata, full_name: previousName },
        });
        throw profileError;
      }
      return json({ user: { id: userId, full_name: fullName, email } });
    }

    if (action === "update_membership") {
      const membershipId = String(body.membership_id);
      const { data: currentMembership, error: currentMembershipError } = await admin
        .from("company_memberships")
        .select("id,company_id,role,is_active")
        .eq("id", membershipId)
        .single();
      if (currentMembershipError) throw currentMembershipError;

      const nextRole = body.role !== undefined ? String(body.role) : currentMembership.role;
      const nextActive = body.is_active !== undefined ? !!body.is_active : currentMembership.is_active;
      const removesActiveOwner =
        currentMembership.role === "company_owner" &&
        currentMembership.is_active &&
        (nextRole !== "company_owner" || !nextActive);

      if (removesActiveOwner) {
        const { count: activeOwnerCount, error: ownerCountError } = await admin
          .from("company_memberships")
          .select("id", { count: "exact", head: true })
          .eq("company_id", currentMembership.company_id)
          .eq("role", "company_owner")
          .eq("is_active", true);
        if (ownerCountError) throw ownerCountError;
        if ((activeOwnerCount ?? 0) <= 1) {
          return json({ error: "Assign another active Company Owner before demoting or disabling the last active owner." }, 409);
        }
      }

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.role !== undefined) patch.role = nextRole;
      if (body.is_active !== undefined) patch.is_active = nextActive;
      const { data, error } = await admin
        .from("company_memberships")
        .update(patch)
        .eq("id", membershipId)
        .select("*")
        .single();
      if (error) throw error;
      return json({ membership: data });
    }

    if (action === "remove_dedicated_workspace_login") {
      const companyId = String(body.company_id || "");
      const userId = String(body.user_id || "");
      if (!companyId || !userId) return json({ error: "Company and user are required." }, 400);

      const { error } = await admin.rpc("platform_remove_dedicated_workspace_login", {
        p_company_id: companyId,
        p_user_id: userId,
      });
      if (error) {
        const message = error.message || "Could not remove dedicated workspace login.";
        const status = /not found|not a dedicated|last active owner/i.test(message) ? 409 : 400;
        return json({ error: message }, status);
      }
      return json({ removed: true, user_id: userId });
    }
    if (action === "remove_company_user") {
      const companyId = String(body.company_id || "");
      const membershipId = String(body.membership_id || "");
      if (!companyId || !membershipId) return json({ error: "Company and membership are required." }, 400);

      const { data: membership, error: membershipError } = await admin
        .from("company_memberships")
        .select("id,company_id,user_id,role,is_active")
        .eq("id", membershipId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) return json({ error: "Company user assignment not found." }, 404);

      if (membership.role === "company_owner" && membership.is_active) {
        const { count: activeOwnerCount, error: ownerCountError } = await admin
          .from("company_memberships")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("role", "company_owner")
          .eq("is_active", true);
        if (ownerCountError) throw ownerCountError;
        if ((activeOwnerCount ?? 0) <= 1) {
          return json({ error: "Assign another active Company Owner before removing the last active owner." }, 409);
        }
      }

      // Remove only this company's access assignments. The global Auth user and
      // user profile are deliberately preserved because the same login may
      // belong to another NAVILO company.
      const accessDeletes = [
        await admin.from("operating_location_memberships").delete().eq("company_id", companyId).eq("user_id", membership.user_id),
        await admin.from("business_unit_memberships").delete().eq("company_id", companyId).eq("user_id", membership.user_id),
      ];
      const accessError = accessDeletes.find(result => result.error)?.error;
      if (accessError) throw accessError;

      const { error: deleteError } = await admin
        .from("company_memberships")
        .delete()
        .eq("id", membershipId)
        .eq("company_id", companyId);
      if (deleteError) throw deleteError;

      return json({ removed: true, user_id: membership.user_id });
    }

    if (action === "update_company_details") {
      const companyId = String(body.company_id || "");
      const name = String(body.name || "").trim();
      const code = String(body.code || "").trim().toUpperCase();
      if (!companyId || !name || !code) return json({ error: "Company, name and code are required." }, 400);

      const { data: duplicate, error: duplicateError } = await admin
        .from("companies")
        .select("id")
        .eq("code", code)
        .neq("id", companyId)
        .limit(1)
        .maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicate) return json({ error: `Company code ${code} already exists.` }, 409);

      const { data, error } = await admin
        .from("companies")
        .update({
          name,
          code,
          contact_email: String(body.contact_email || "").trim() || null,
          contact_phone: String(body.contact_phone || "").trim() || null,
          address: String(body.address || "").trim() || null,
          notes: String(body.notes || "").trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", companyId)
        .select("*")
        .single();
      if (error) throw error;
      return json({ company: data });
    }

    if (action === "remove_unused_branch") {
      const companyId = String(body.company_id || "");
      const branchId = String(body.branch_id || "");
      const { data: branch } = await admin.from("operating_locations").select("id").eq("id", branchId).eq("company_id", companyId).maybeSingle();
      if (!branch) return json({ error: "Branch not found for this company." }, 404);
      const { error } = await admin.from("operating_locations").delete().eq("id", branchId).eq("company_id", companyId);
      if (error?.code === "23503") return json({ error: "This branch is already referenced by users, transactions or operational records. Disable it instead." }, 409);
      if (error) throw error;
      return json({ removed: true });
    }

    if (action === "remove_unused_business_unit") {
      const companyId = String(body.company_id || "");
      const unitId = String(body.business_unit_id || "");
      const { error } = await admin.rpc("platform_remove_unused_business_unit", {
        p_company_id: companyId,
        p_business_unit_id: unitId,
      });
      if (error) {
        const message = error.message || "Could not remove Business Unit.";
        const status = /default Business Unit|referenced|not found/i.test(message) ? 409 : 400;
        return json({ error: message }, status);
      }
      return json({ removed: true });
    }

    if (action === "set_company_status") {
      const { data, error } = await admin
        .from("companies")
        .update({ status: String(body.status), updated_at: new Date().toISOString() })
        .eq("id", String(body.company_id))
        .select("*")
        .single();
      if (error) throw error;
      return json({ company: data });
    }

    if (action === "sign_out_user_all_devices") {
      const userId = String(body.user_id || "");
      if (!userId) return json({ error: "User is required" }, 400);
      const { error } = await admin.auth.admin.signOut(userId, "global");
      if (error) throw error;
      return json({ success: true, user_id: userId });
    }

    if (action === "set_user_access") {
      const { error } = await admin
        .from("company_memberships")
        .update({ is_active: !!body.is_active, updated_at: new Date().toISOString() })
        .eq("company_id", String(body.company_id))
        .eq("user_id", String(body.user_id));
      if (error) throw error;
      return json({ success: true });
    }

    if (action === "set_user_role") {
      const { error } = await admin
        .from("company_memberships")
        .update({ role: String(body.role), permissions: body.permissions || {}, updated_at: new Date().toISOString() })
        .eq("company_id", String(body.company_id))
        .eq("user_id", String(body.user_id));
      if (error) throw error;
      return json({ success: true });
    }

    if (action === "delete_company") {
      const companyId = String(body.company_id);
      const { data: company } = await admin.from("companies").select("code").eq("id", companyId).single();
      if (!company) return json({ error: "Company not found" }, 404);
      if (String(body.confirmation) !== `DELETE ${company.code}` || body.acknowledge !== true) {
        return json({ error: `Type DELETE ${company.code} exactly and acknowledge` }, 400);
      }
      const { data, error } = await admin.rpc("platform_delete_company", { p_company_id: companyId, p_actor_id: actor.id });
      if (error) throw error;
      return json(data);
    }

    if (action === "purge_test_company_preview") {
      const { data, error } = await admin.rpc("platform_preview_test_company_purge", {
        p_company_id: String(body.company_id),
      });
      if (error) throw error;
      return json(data);
    }

    if (action === "purge_test_company") {
      const companyId = String(body.company_id);
      const { data: company } = await admin.from("companies").select("code,is_test_company").eq("id", companyId).single();
      if (!company) return json({ error: "Company not found" }, 404);
      if (company.is_test_company !== true) return json({ error: "Only an explicitly marked Test Company can be purged" }, 409);
      if (String(body.confirmation) !== `PURGE ${company.code}` || body.acknowledge !== true) {
        return json({ error: `Type PURGE ${company.code} exactly and acknowledge` }, 400);
      }
      const { data, error } = await admin.rpc("platform_purge_test_company", {
        p_company_id: companyId,
        p_actor_id: actor.id,
      });
      if (error) throw error;
      return json(data);
    }

    if (action === "reset_company_preview") {
      const { data, error } = await admin.rpc("platform_preview_company_transaction_reset", {
        p_company_id: String(body.company_id),
      });
      if (error) throw error;
      return json(data);
    }

    if (action === "reset_company_transactions") {
      const companyId = String(body.company_id);
      const { data: company } = await admin.from("companies").select("code,is_test_company").eq("id", companyId).single();
      if (!company) return json({ error: "Company not found" }, 404);
      if (company.is_test_company !== true) return json({ error: "Transaction reset is allowed only for an explicitly marked Test Company" }, 409);
      if (String(body.confirmation) !== `RESET ${company.code}` || body.acknowledge !== true) {
        return json({ error: `Type RESET ${company.code} exactly and acknowledge` }, 400);
      }
      const { data, error } = await admin.rpc("platform_reset_company_transactions", {
        p_company_id: companyId,
        p_actor_id: actor.id,
      });
      if (error) throw error;
      return json(data);
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("platform-admin", action, error);
    return json({ error: error instanceof Error ? error.message : "Request failed" }, 500);
  }
});

