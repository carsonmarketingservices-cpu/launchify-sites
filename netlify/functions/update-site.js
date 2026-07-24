// netlify/functions/update-site.js
//
// Edits a saved site's description/HTML, or toggles published on/off
// (unpublish without deleting). Ownership is enforced by filtering the
// update query on both id AND user_id — a request for someone else's
// site id simply matches zero rows.

const { verifyUser } = require("./_verifyUser");

const MAX_HTML_LENGTH = 500000;

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
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server is missing Supabase env vars." }) };
  }

  const user = await verifyUser(event.headers.authorization || event.headers.Authorization);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Not logged in or session expired." }) };
  }

  let id, patch;
  try {
    const parsed = JSON.parse(event.body || "{}");
    id = parsed.id;
    patch = {};
    if (typeof parsed.business_description === "string") {
      patch.business_description = parsed.business_description.slice(0, 300);
    }
    if (typeof parsed.html_content === "string") {
      if (parsed.html_content.length > MAX_HTML_LENGTH) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "HTML content is too large." }) };
      }
      patch.html_content = parsed.html_content;
    }
    if (typeof parsed.published === "boolean") {
      patch.published = parsed.published;
    }
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  if (!id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "id is required" }) };
  }
  if (Object.keys(patch).length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Nothing to update." }) };
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sites?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify(patch),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Failed to update", detail: errText }) };
    }

    const rows = await res.json();
    if (!rows.length) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Site not found or not yours." }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ site: rows[0] }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Unexpected server error", detail: String(err) }) };
  }
};
