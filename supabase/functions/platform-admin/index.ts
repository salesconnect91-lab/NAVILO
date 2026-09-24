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
      const password = String(body.password || "");
      const planId = String(body.plan_id || "");
      const unitName = String(body.business_unit_name || name).trim();
      const unitCode = String(body.business_unit_code || code).trim().toUpperCase();
      const branchName = String(body.branch_name || "Head Office").trim();
      const branchCode = String(body.branch_code || "HO").trim().toUpperCase();
      const status = body.status === "active" ? "active" : "trial";
      const businessType = String(body.business_unit_type || "custom");
      if (!name || !code || !ownerEmail || !planId || !unitName || !unitCode || !branchName || !branchCode) {
        return json({ error: "Company, owner, plan, business unit and branch details are required." }, 400);
      }
      if (password.length < 8) return json({ error: "Temporary password must be at least 8 characters." }, 400);

      const [codeLookup, nameLookup, planLookup] = await Promise.all([
        admin.from("companies").select("id").eq("code",code).limit(1).maybeSingle(),
        admin.from("companies").select("id").ilike("name",name).limit(1).maybeSingle(),
        admin.from("subscription_plans").select("*").eq("id", planId).eq("is_active", true).maybeSingle(),
      ]);
      const preflight = checkOnboardingLookups(codeLookup, nameLookup, planLookup);
      if (!preflight.ok) return json({ error: preflight.error }, preflight.status);
      const plan = planLookup.data!;
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
      try {
        const { data: createdCompany, error: companyError } = await admin.from("companies").insert({
          name, code, status, contact_email: ownerEmail, contact_phone: body.contact_phone || null,
          address: body.address || null, notes: body.notes || null, created_by: actor.id,
          subscription_expires_at: expiresAt.toISOString(), max_users: Number(plan.max_users || 10),
          max_business_units: Number(plan.max_business_units || 1), max_branches: Number(plan.max_branches || 1),
          max_godowns: Number(plan.max_godowns || 1), base_currency_code: fiscalSettings.base_currency_code,
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

        const { data: createdUser, error: userError } = await admin.auth.admin.createUser({
          email: ownerEmail, password, email_confirm: true, user_metadata: { full_name: ownerName || name },
        });
        if (userError || !createdUser.user) throw userError || new Error("Owner login creation failed");
        userId = createdUser.user.id;

        const { error: profileError } = await admin.from("user_profiles").upsert({
          id:userId,user_id:userId,role:"admin",is_active:true,full_name:ownerName||name,email:ownerEmail,
          platform_role:"user",last_company_id:companyId,last_business_unit_id:unit.id,updated_at:new Date().toISOString(),
        },{onConflict:"id"});
        if (profileError) throw profileError;
        // Company membership creates the default business unit membership in
        // the database trigger; creating it again would violate its unique key.
        const { error: membershipError } = await admin.from("company_memberships").insert({
          company_id:companyId,user_id:userId,role:"company_owner",is_active:true,permissions:{},invited_by:actor.id,
        });
        if (membershipError) throw membershipError;
        const writes = await Promise.all([
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
        if (userId) await admin.auth.admin.deleteUser(userId);
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
        subscription_expires_at: body.subscription_expires_at || null,
        created_by: actor.id,
      }).select("*").single();
      if (error) throw error;
      return json({ company: data });
    }

    if (action === "update_membership") {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.role !== undefined) patch.role = String(body.role);
      if (body.is_active !== undefined) patch.is_active = !!body.is_active;
      const { data, error } = await admin
        .from("company_memberships")
        .update(patch)
        .eq("id", String(body.membership_id))
        .select("*")
        .single();
      if (error) throw error;
      return json({ membership: data });
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

    if (action === "reset_company_preview") {
      const { data, error } = await admin.rpc("platform_preview_company_transaction_reset", {
        p_company_id: String(body.company_id),
      });
      if (error) throw error;
      return json(data);
    }

    if (action === "reset_company_transactions") {
      const companyId = String(body.company_id);
      const { data: company } = await admin.from("companies").select("code").eq("id", companyId).single();
      if (!company) return json({ error: "Company not found" }, 404);
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
