// netlify/edge-functions/domain-router.js
//
// Runs on every request (see netlify.toml). If the request's Host header
// matches a site's custom_domain in Supabase, serves that site's HTML
// directly. Otherwise, passes the request through untouched so your
// normal homepage, functions, and /sites/:slug routing keep working.
//
// NOTE: Netlify Edge Functions run on Deno, not Node — this file can't
// use the Node-style `process.env` the regular functions use. Env var
// access syntax for Edge Functions has changed across Netlify versions;
// verify `Netlify.env.get()` (used below) is still current in Netlify's
// Edge Functions docs before relying on this in production.
//
// Requires SUPABASE_URL and SUPABASE_ANON_KEY to be available to edge
// functions (Netlify env vars set to "all scopes" cover this; edge-only
// scopes may need to be checked explicitly in the dashboard).

export default async (request, context) => {
  const host = request.headers.get("host") || "";

  // Skip the routing lookup entirely for your own primary domain —
  // only custom domains need this check.
  const PRIMARY_DOMAINS = ["launchifysites.com", "www.launchifysites.com"];
  if (PRIMARY_DOMAINS.includes(host) || host.includes("netlify.app")) {
    return context.next();
  }

  let SUPABASE_URL, SUPABASE_ANON_KEY;
  try {
    SUPABASE_URL = Netlify.env.get("SUPABASE_URL");
    SUPABASE_ANON_KEY = Netlify.env.get("SUPABASE_ANON_KEY");
  } catch {
    return context.next();
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return context.next();

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sites?custom_domain=eq.${encodeURIComponent(host)}&published=eq.true&select=html_content`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (!res.ok) return context.next();
    const rows = await res.json();
    if (!rows.length) return context.next();

    return new Response(rows[0].html_content, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch {
    // If anything goes wrong, fall through to normal routing rather
    // than breaking the request entirely.
    return context.next();
  }
};

export const config = { path: "/*" };
