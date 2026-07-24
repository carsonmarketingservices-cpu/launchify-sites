// netlify/functions/delete-site.js
//
// Deletes a saved site. Ownership enforced the same way as update-site.js.
// Note: this does NOT delete the site's images from Storage — cleaning
// up orphaned images is a reasonable later improvement (a scheduled
// function that garbage-collects unreferenced files), not required for
// this to work correctly today.

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
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server is missing Supabase env vars." }) };
  }

  const user = await verifyUser(event.headers.authorization || event.headers.Authorization);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Not logged in or session expired." }) };
  }

  let id;
  try {
    const parsed = JSON.parse(event.body || "{}");
    id = parsed.id;
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }
  if (!id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "id is required" }) };
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sites?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: "DELETE",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      }
    );
    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Failed to delete", detail: errText }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Unexpected server error", detail: String(err) }) };
  }
};
