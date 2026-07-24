# Phase: Real Image Generation — Scope

## Goal
When Claude generates the HTML preview, also generate real images for it
(hero image, maybe 1-2 supporting images) instead of CSS-only visuals.

## Why this is its own phase, not a tweak
Claude (Anthropic's models) doesn't generate images — it's text/code only.
This requires bringing in a second AI provider, a second API key, real
per-image cost, and new content-safety handling, on top of everything
already running.

---

## 1. Provider options

| Provider | Realism | Approx. cost/image | Commercial use | Notes |
|---|---|---|---|---|
| **OpenAI (gpt-image / DALL·E)** | High | ~$0.02–$0.08 depending on size/quality | Yes, with usage policy compliance | Widely used, strong general quality, has its own safety filters |
| **Stability AI (Stable Diffusion / SD3)** | High, more variable | ~$0.01–$0.04 | Yes | Cheaper at volume, quality more prompt-sensitive |
| **Recraft** | High, strong for clean commercial/marketing style | ~$0.02–$0.05 | Yes | Popular specifically for web/marketing imagery |
| **Ideogram** | High, strong at realistic photography style | ~$0.02–$0.06 | Yes | Good at avoiding the "AI-glossy" look for product/lifestyle shots |
| **Google Imagen (via Vertex AI)** | High | ~$0.02–$0.04 | Yes | Requires a Google Cloud account, more setup overhead |

None of these are free at real volume. Every "Generate Website" click that
includes images will cost you real money on top of the Anthropic bill —
this is the biggest behavior change from Phase 1.

*(Exact pricing changes over time — confirm current rates on the
provider's pricing page before committing, I haven't verified these live.)*

**My default recommendation if you want one:** Recraft or Ideogram for
site-appropriate imagery quality per dollar, OpenAI if you want the
best-known safety/reliability track record and don't mind paying a bit
more.

---

## 2. Architecture

Two realistic approaches:

### Option A — Two-step pipeline (recommended)
1. Claude generates the HTML **and** a short JSON list of image prompts
   with placement tokens, e.g.:
   ```json
   {
     "html": "...<div class='hero-img'>{{IMAGE:hero}}</div>...",
     "imagePrompts": [
       { "token": "hero", "prompt": "warm, natural-light photo of a small coffee roastery counter, no visible people, no text or logos" }
     ]
   }
   ```
2. A second function call sends each prompt to the image provider,
   gets back image data, and the token gets swapped for a real
   `<img src="...">` in the HTML before it's sent to the browser.

This keeps Claude focused on layout/copy and lets the image model focus
on images — better results than asking one model to do both.

### Option B — Single combined call
Ask Claude to describe images inline and generate them in the same
request. Not viable — Claude can't call an image model itself from
inside its own response in this setup; Option A's two-step approach is
the realistic path.

## 3. Where do generated images live?
Two choices, matching the "no persistence yet" rule from Phase 1:

- **Base64-embedded, ephemeral (consistent with Phase 1):** the image
  data gets embedded directly in the HTML response, shown once, gone on
  refresh. No storage needed. Bigger page payload per preview, but zero
  new infrastructure.
- **Uploaded to storage, given a real URL:** needs a place to put them
  (Netlify Blobs, S3, etc.) — this starts to overlap with the save/publish
  phase you already said you want to do separately with a new Supabase
  project. I'd hold off on this until that phase, to avoid building
  storage twice.

**Recommendation:** base64/ephemeral for now, matching Phase 1's "nothing
is saved" boundary. Real storage comes naturally when you build
save/publish.

## 4. Content safety (non-negotiable, not optional polish)
The image prompts are ultimately shaped by visitor input (the business
description), so the same untrusted-input caution from Phase 1 applies:

- Prompts sent to the image model must explicitly exclude real,
  identifiable people, copyrighted characters/logos, and brand imagery
  — instructed the same way the HTML generation currently avoids scripts
  and real forms
- Most providers run their own moderation and will reject clearly unsafe
  prompts, but that's a backstop, not the primary control
- No image should ever be presented as a real photo of an identifiable
  real person or place tied to the business (it's all synthetic/illustrative)

## 5. Cost and latency stack on top of Phase 1
- Each image adds its own generation time (often 3–10 seconds) — for a
  hero + 2 supporting images, that can mean 10–25+ seconds of total wait
  if done one at a time. Doing the image calls in parallel (not
  sequentially) matters a lot here.
- Rate limiting/abuse protection — already flagged as a Phase 1 to-do —
  becomes more urgent, since image generation costs meaningfully more
  per click than text alone.

---

## Decisions needed before I build this

1. Which image provider (cost/quality tradeoff above)
2. How many images per generated preview (1 hero-only is cheapest/fastest;
   2-3 images is more impressive but slower and costs more per click)
3. Confirm: ephemeral/base64 for now, real storage later with the
   save/publish phase — or do you want storage built now instead?
