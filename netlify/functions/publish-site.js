// netlify/functions/publish-site.js
//
// Marks a saved site as published and gives it a public slug at
// /sites/:slug. Only works on sites owned by the verified user.

const { verifyUser } = require("./_verifyUser");

function randomSlug() {
  return Math.random().toString(36).slice(2, 10); // 8-char base36
}

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

  // Confirm the site exists and belongs to this user before publishing.
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/sites?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}&select=id`,
    {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    }
  );
  const rows = await checkRes.json();
  if (!checkRes.ok || !rows.length) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: "Site not found or not yours." }) };
  }

  // Try a random slug a few times in case of a unique-constraint collision.
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = randomSlug();
    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/sites?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({ slug, published: true }),
    });

    if (updateRes.ok) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ slug, url: `/sites/${slug}` }),
      };
    }

    lastError = await updateRes.text();
    // If it's a unique-violation on slug, loop and try another one.
    // Any other error, bail out immediately.
    if (!lastError.includes("duplicate") && !lastError.includes("unique")) break;
  }

  return { statusCode: 502, headers, body: JSON.stringify({ error: "Failed to publish", detail: lastError }) };
};
