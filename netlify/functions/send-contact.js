// netlify/functions/send-contact.js
//
// Real contact form backend — sends the submission as an email via
// Resend. Requires RESEND_API_KEY in Netlify env vars.
//
// IMPORTANT: the "from" address must be on a domain you've verified in
// Resend (Resend dashboard → Domains). Using an unverified domain will
// cause every send to fail. Set RESEND_FROM once that's done, e.g.
// "Launchify Sites <hello@launchifysites.com>".

const RESEND_API_URL = "https://api.resend.com/emails";
const MAX_FIELD_LENGTH = 2000;

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  if (!process.env.RESEND_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server is missing RESEND_API_KEY." }) };
  }

  let name, email, message;
  try {
    const parsed = JSON.parse(event.body || "{}");
    name = (parsed.name || "").toString().trim().slice(0, MAX_FIELD_LENGTH);
    email = (parsed.email || "").toString().trim().slice(0, MAX_FIELD_LENGTH);
    message = (parsed.message || "").toString().trim().slice(0, MAX_FIELD_LENGTH);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  if (!name || !email || !message) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "name, email, and message are all required" }) };
  }
  // Basic shape check — not full RFC validation, just catches obvious junk.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "That doesn't look like a valid email address." }) };
  }

  const FROM = process.env.RESEND_FROM || "Launchify Sites <hello@launchifysites.com>";
  const TO = process.env.RESEND_TO || "hello@launchifysites.com";

  // Escape user-supplied text before dropping it into HTML — this is
  // rendered in an email client, not a browser sandbox, so basic escaping
  // is the right control here (no iframe sandbox available in email).
  const escapeHtml = (str) =>
    str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        reply_to: email,
        subject: `New contact form message from ${name}`,
        html: `
          <p><strong>Name:</strong> ${escapeHtml(name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(email)}</p>
          <p><strong>Message:</strong></p>
          <p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
        `,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Failed to send email via Resend", detail: errText }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Unexpected server error", detail: String(err) }) };
  }
};
