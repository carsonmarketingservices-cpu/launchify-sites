// netlify/functions/save-site.js
//
// Saves a generated preview to the logged-in user's account. Also
// upgrades the page from ephemeral base64 images to real, permanent
// image URLs in Supabase Storage — the live unsaved preview stays
// base64 (that's fine, it's temporary), but anything actually saved
// gets real hosted images, same as any production site builder.

const { verifyUser } = require("./_verifyUser");

const MAX_HTML_LENGTH = 500000;
const STORAGE_BUCKET = "site-images";

async function uploadImagesToStorage(html, supabaseUrl, serviceKey) {
  const dataUriRegex = /data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)/g;
  const matches = [...html.matchAll(dataUriRegex)];
  let updatedHtml = html;

  for (const match of matches) {
    const [fullMatch, ext, base64Data] = match;
    try {
      const buffer = Buffer.from(base64Data, "base64");
      const filename = `${crypto.randomUUID()}.${ext === "jpeg" ? "jpg" : "png"}`;

      const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${filename}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": `image/${ext}`,
        },
        body: buffer,
      });

      if (uploadRes.ok) {
        const publicUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${filename}`;
        updatedHtml = updatedHtml.split(fullMatch).join(publicUrl);
      }
      // If upload fails, leave that image as base64 rather than breaking the save.
    } catch {
      // Same reasoning — one failed image shouldn't fail the whole save.
    }
  }

  return updatedHtml;
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

  let description, html, siteId;
  try {
    const parsed = JSON.parse(event.body || "{}");
    description = (parsed.description || "").toString().slice(0, 300);
    html = (parsed.html || "").toString();
    siteId = parsed.id || null; // if present, this is an update to an existing saved site
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  if (!html) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "html is required" }) };
  }
  if (html.length > MAX_HTML_LENGTH) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Generated site is too large to save." }) };
  }

  const finalHtml = await uploadImagesToStorage(html, SUPABASE_URL, SERVICE_KEY);

  try {
    let res;
    if (siteId) {
      // Update an existing saved site (owner-checked via query filter).
      res = await fetch(
        `${SUPABASE_URL}/rest/v1/sites?id=eq.${encodeURIComponent(siteId)}&user_id=eq.${encodeURIComponent(user.id)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            Prefer: "return=representation",
          },
          body: JSON.stringify({ business_description: description, html_content: finalHtml }),
        }
      );
    } else {
      res = await fetch(`${SUPABASE_URL}/rest/v1/sites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          user_id: user.id,
          business_description: description,
          html_content: finalHtml,
        }),
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Failed to save to Supabase", detail: errText }) };
    }

    const rows = await res.json();
    if (!rows.length) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Site not found or not yours." }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ id: rows[0].id }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Unexpected server error", detail: String(err) }) };
  }
};
