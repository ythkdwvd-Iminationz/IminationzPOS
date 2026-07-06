# Iminationz — Landing Page (QR target)

Standalone, 3D-interactive landing page linked from the QR code on the
visiting card. Deploy this folder to Netlify and point your QR to the
resulting URL.

## Files
- `index.html` — full page (Playfair + Inter, Supabase JS via CDN)
- `logo.png`   — brand logo
- `netlify.toml` — publish config for this subfolder

## One-time Supabase setup
Run this SQL in the Supabase SQL Editor (once):

```
supabase/migration/landing_config.sql
```

That creates a `landing_config` key/value table with sensible defaults.
Anyone can read (public landing page), only authenticated users can write.

## Editing the links (no redeploy needed)
1. Open Supabase → **Table Editor** → `landing_config`
2. Edit the `value` of any of these keys — changes appear on next page reload:

| key                       | example value                                              |
|---------------------------|------------------------------------------------------------|
| `instagram_url`           | `https://instagram.com/iminationz`                         |
| `store_location_url`      | `https://maps.app.goo.gl/xxxxx`                            |
| `whatsapp_community_url`  | `https://chat.whatsapp.com/xxxxxxxxxxxx`                   |
| `upi_url`                 | `upi://pay?pa=iminationz@okhdfc&pn=Iminationz&cu=INR`      |
| `shop_via_dm_url`         | `https://ig.me/m/iminationz`                               |
| `latest_collection_url`   | `https://www.instagram.com/iminationz/reels/`              |

## Deploying to Netlify
### Option A — drag & drop (fastest)
1. Go to <https://app.netlify.com/drop>
2. Drag this `landing/` folder in
3. Copy the generated URL → point your QR to it

### Option B — from Git (auto-deploy on push)
1. Netlify → **Add new site → Import from Git** → pick this repo
2. Set:
   - **Base directory:** `landing`
   - **Publish directory:** `landing`
   - **Build command:** *(leave empty)*
3. Deploy

## What the page does
- 3D-tilting logo (mouse on desktop, gyroscope on phones)
- Ambient particle field, sheen animation, subtle floating logo
- 6 elegant cards → Instagram · Store · WhatsApp · UPI · Shop DM · New Drop
- Sound toggle (top-right): synthesized ambient pad + sparkle on tap
- Sound preference is stored per-device
- Fully static — no build step, no server
