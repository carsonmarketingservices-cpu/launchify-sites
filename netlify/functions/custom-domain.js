// netlify/functions/custom-domain.js
//
// Sets or removes a custom domain on a saved site. This is NOT just a
// database write — for a custom domain to route to your site at all,
// Netlify itself has to be told about it (as a "domain alias" on your
// site), or traffic to that domain never reaches Netlify in the first
// place, regardless of what's in Supabase. This function does both:
//   1. Adds/removes the domain as a Netlify domain alias via Netlify's API
//   2. Adds/removes it on the site's row in Supabase
//
// Requires NETLIFY_AUTH_TOKEN (a Netlify personal access token) and
// NETLIFY_SITE_ID (your site's ID, found in Site configuration → General
// → Site details) as Netlify env vars.
//
// IMPORTANT — what this does NOT do: it doesn't touch DNS. The customer
// still has to point their domain's DNS (a CNAME to your Netlify
// subdomain, or the A record Netlify gives you) at Netlify themselves,
// and SSL provisioning after that can take a few minutes. That's true
// of every platform that supports custom domains — Wix, Framer, Webflow
// all require the same DNS step on the customer's end.

const { verifyUser } = require("./_verifyUser");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const NETLIFY_AUTH_TOKEN = process.env.NETLIFY_AUTH_TOKEN;
  const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server is missing Supabase env vars." }) };
  }
  if (!NETLIFY_AUTH_TOKEN || !NETLIFY_SITE_ID) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server is missing NETLIFY_AUTH_TOKEN / NETLIFY_SITE_ID — custom domains can't be registered without these." }),
    };
  }

  const user = await verifyUser(event.headers.authorization || event.headers.Authorization);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Not logged in or session expired." }) };
  }

  let id, domain, action;
  try {
    const parsed = JSON.parse(event.body || "{}");
    id = parsed.id;
    domain = (parsed.domain || "").toString().trim().toLowerCase();
    action = parsed.action === "remove" ? "remove" : "set";
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: "id is required" }) };
  if (action === "set") {
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "That doesn't look like a valid domain." }) };
    }
  }

  // Confirm ownership before touching anything.
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/sites?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,custom_domain`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const rows = await checkRes.json();
  if (!checkRes.ok || !rows.length) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: "Site not found or not yours." }) };
  }
  const existingDomain = rows[0].custom_domain;

  // Step 1: update Netlify's domain aliases.
  try {
    const siteInfoRes = await fetch(`https://api.netlify.com/api/v1/sites/${NETLIFY_SITE_ID}`, {
      headers: { Authorization: `Bearer ${NETLIFY_AUTH_TOKEN}` },
    });
    if (!siteInfoRes.ok) {
      const detail = await siteInfoRes.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Failed to read Netlify site info", detail }) };
    }
    const siteInfo = await siteInfoRes.json();
    let aliases = new Set(siteInfo.domain_aliases || []);

    if (existingDomain) aliases.delete(existingDomain);
    if (action === "set") aliases.add(domain);

    const patchRes = await fetch(`https://api.netlify.com/api/v1/sites/${NETLIFY_SITE_ID}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NETLIFY_AUTH_TOKEN}`,
      },
      body: JSON.stringify({ domain_aliases: [...aliases] }),
    });
    if (!patchRes.ok) {
      const detail = await patchRes.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Failed to register domain with Netlify", detail }) };
    }
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Unexpected error calling Netlify API", detail: String(err) }) };
  }

  // Step 2: update Supabase.
  try {
    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/sites?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({ custom_domain: action === "set" ? domain : null }),
    });
    if (!updateRes.ok) {
      const detail = await updateRes.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Domain registered with Netlify but failed to save in database", detail }) };
    }
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Unexpected server error", detail: String(err) }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      domain: action === "set" ? domain : null,
      dnsInstructions: action === "set"
        ? `Add a CNAME record for ${domain} pointing to your Netlify site's default domain (found in Netlify → Domain management). SSL provisioning typically takes a few minutes after DNS propagates.`
        : null,
    }),
  };
};
