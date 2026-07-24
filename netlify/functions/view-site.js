// netlify/functions/view-site.js
//
// Serves a published site's raw HTML at /sites/:slug (via the redirect
// rule in netlify.toml). Uses the ANON key, not the service role key —
// this only works because of the "Anyone can view published sites" RLS
// policy in schema.sql, which only exposes rows where published = true.

exports.handler = async (event) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  const slug = event.queryStringParameters && event.queryStringParameters.slug;
  if (!slug) {
    return { statusCode: 400, headers: { "Content-Type": "text/plain" }, body: "Missing slug" };
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { statusCode: 500, headers: { "Content-Type": "text/plain" }, body: "Server is misconfigured." };
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sites?slug=eq.${encodeURIComponent(slug)}&published=eq.true&select=html_content`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const rows = await res.json();
    if (!res.ok || !rows.length) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "text/html" },
        body: "<html><body style='font-family:sans-serif;text-align:center;padding:80px;'><h1>Site not found</h1><p>This link may be unpublished or doesn't exist.</p></body></html>",
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: rows[0].html_content,
    };
  } catch (err) {
    return { statusCode: 500, headers: { "Content-Type": "text/plain" }, body: "Unexpected server error: " + String(err) };
  }
};
