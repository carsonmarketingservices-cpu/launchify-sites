// netlify/functions/generate-website.js
//
// Real HTML generation + a 3-image gallery (hero + 2 supporting), via
// Claude for the page and OpenAI for the images.
//
// SECURITY: both API keys live only here as Netlify env vars, never sent
// to the browser. The generated HTML is untrusted content (shaped by
// visitor input) and MUST be rendered by the frontend in a sandboxed
// iframe — see index.html. This function also strips <script> tags and
// inline event handlers as defense in depth.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";

const TEXT_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini";

const MAX_DESCRIPTION_LENGTH = 300;
const MAX_TOKENS = 4500;

const IMAGE_TOKENS = ["{{IMAGE_1}}", "{{IMAGE_2}}", "{{IMAGE_3}}"];

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
  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server is missing ANTHROPIC_API_KEY." }) };
  }

  let description;
  try {
    const parsed = JSON.parse(event.body || "{}");
    description = (parsed.description || "").toString().trim();
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }
  if (!description) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "description is required" }) };
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` }) };
  }

  const systemPrompt = `You are a web designer generating a real, complete one-page website for a website-building product's live preview feature.

Given a short business description, design and write a COMPLETE, SELF-CONTAINED HTML document for a one-page site for that specific business. Vary the structure, section order, and layout based on what actually fits the business.

Respond in EXACTLY this plain-text format, nothing else:

IMAGE_1: <one line: a hero image for this business — photographic, specific, no real identifiable people, no copyrighted characters/logos, no brand names, no text/signage in the image>
IMAGE_2: <one line: a second supporting image — a different angle/detail of the business, same restrictions>
IMAGE_3: <one line: a third supporting image — another different detail/angle, same restrictions>
===HTML===
<!DOCTYPE html>
...full HTML document...
</html>

Hard requirements for the HTML part:
- Start with <!DOCTYPE html> and end with </html>. No markdown fences, no commentary.
- Self-contained: inline <style> only. You may link Google Fonts via <link>. No external CSS/JS files.
- No <script> tags, no inline event handlers. Static, script-free page.
- No <form> tags with real action attributes — present contact info as static text.
- Exactly THREE <img> tags are allowed, using these exact src values in whatever layout positions make sense (hero + gallery/detail shots): <img src="{{IMAGE_1}}" alt="...">, <img src="{{IMAGE_2}}" alt="...">, <img src="{{IMAGE_3}}" alt="...">. Do not use any other <img> tags or external image URLs.
- Include a <meta name="viewport"> tag and a responsive layout.
- Include a nav/header, a hero section using IMAGE_1, 2-4 content sections appropriate to the business (using IMAGE_2 and IMAGE_3 naturally within them), and a footer.
- Write real, specific copy for this business — no lorem ipsum, no placeholder business names.
- Use a cohesive color palette fitting the business's mood/industry.
- Keep it focused; this is a live preview, not a 10-page site.`;

  let raw;
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: description }],
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Upstream Anthropic API error", detail: errText }) };
    }
    const data = await response.json();
    const textBlock = (data.content || []).find((block) => block.type === "text");
    raw = textBlock ? textBlock.text : "";
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Unexpected error calling Anthropic", detail: String(err) }) };
  }

  raw = raw.replace(/^```(?:\w+)?/i, "").replace(/```$/i, "").trim();

  const splitIndex = raw.indexOf("===HTML===");
  if (splitIndex === -1) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Model response missing HTML section", raw: raw.slice(0, 500) }) };
  }

  const promptBlock = raw.slice(0, splitIndex);
  let html = raw.slice(splitIndex + "===HTML===".length).trim();

  const imagePrompts = [1, 2, 3].map((n) => {
    const match = promptBlock.match(new RegExp(`IMAGE_${n}:\\s*(.+)`, "i"));
    return match ? match[1].trim() : null;
  });

  if (!/^<!DOCTYPE html>/i.test(html) && !/^<html/i.test(html)) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Model did not return a valid HTML document", raw: html.slice(0, 500) }) };
  }

  // Defense in depth.
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"(.*?)"/gi, "")
    .replace(/\son\w+\s*=\s*'(.*?)'/gi, "")
    .replace(/javascript:/gi, "");

  // Generate all three images in parallel — sequential would be far too
  // slow given Netlify's function timeout. Each one fails soft.
  let imagesGenerated = 0;
  if (process.env.OPENAI_API_KEY) {
    const results = await Promise.all(
      imagePrompts.map(async (prompt, i) => {
        if (!prompt) return null;
        try {
          const imgRes = await fetch(OPENAI_IMAGE_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: IMAGE_MODEL,
              prompt,
              size: i === 0 ? "1536x1024" : "1024x1024",
              n: 1,
              moderation: "auto",
            }),
          });
          if (!imgRes.ok) return null;
          const imgData = await imgRes.json();
          return imgData?.data?.[0]?.b64_json || null;
        } catch {
          return null;
        }
      })
    );

    results.forEach((b64, i) => {
      if (b64) {
        html = html.split(IMAGE_TOKENS[i]).join(`data:image/png;base64,${b64}`);
        imagesGenerated++;
      }
    });
  }

  // Any tokens that didn't get a real image (missing key, failed call,
  // or moderation rejection) fall back to a CSS-only gradient block so
  // the layout still holds together.
  IMAGE_TOKENS.forEach((token) => {
    const tokenRegex = new RegExp(`<img[^>]*src=["']${token.replace(/[{}]/g, "\\$&")}["'][^>]*>`, "gi");
    html = html.replace(
      tokenRegex,
      `<div style="width:100%;min-height:180px;border-radius:12px;background:linear-gradient(135deg,#1ABC9C,#38BDF8,#6366F1);"></div>`
    );
  });

  return {
    statusCode: 200,
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ html, imagesGenerated, imagesRequested: 3 }),
  };
};
