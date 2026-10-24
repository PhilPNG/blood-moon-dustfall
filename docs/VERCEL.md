# Vercel frontend deployment

Configuration is ready; a new Vercel production URL has **not yet been confirmed**. The existing playable site remains https://alibi-mystery-party.honeyspark.chatgpt.site.

## Shared backend, separate frontend

Vercel serves the Vite frontend and existing art, narrator audio, caption tracks and media manifests. `vercel.json` uses `npm run build`, publishes `.web-dist/`, and rewrites `/api/:path*` to the existing Sites API. The Sites Worker and managed D1 remain authoritative for rooms, votes, recovery, presence and GM controls. A Vercel deploy does not migrate or replace that database.

Frontend routes fall back to `index.html`; `/assets/` and `/media/` remain static files. The API rewrite precedes the SPA route. API responses use `no-store`. No provider API key is required to play the existing generated media.

Invitations use the current frontend origin: the client normalizes a proxied config response so Vercel room QRs stay on Vercel. A public room code can identify the same room through either frontend, but browser-saved credentials are origin-scoped. Keep the GM and guests on one origin. Use a private recovery code to move an identity between origins or devices; recovery rotates access on the former device.

## Public source export

The intended repository is `PhilPNG/blood-moon-dustfall`.

```sh
node scripts/stage-public.mjs
```

This rebuilds `.public-release/`, preserving its existing `.git` history. It copies approved application/backend source, migrations, tests, assets, selected docs, five labelled generated concepts, and reviewed gameplay screenshots. Source symlinks are skipped. Exclusions cover `.openai/`, `.env*`, dependencies, bundles, runtime databases, progress logs, consent screenshots, account/billing records and local source-image path records.

Functional Higgsfield CDN URLs remain because films use those public addresses. The export contains no provider credentials or newly generated media. Review the export before publishing; staging does not push or deploy.

For a fresh checkout:

```sh
npm ci
npm test
npm run build
```

The Worker build tolerates absent `.openai/hosting.json`. Original private Sites builds still copy it when supplied. Vercel publishes only `.web-dist/`.

## Publish and verify

Import the public GitHub repository into the intended Vercel project using the committed settings and Node.js 24. No new database or browser-visible API secret is needed. Confirm the resulting production origin before replacing the pending status here and in README.

Substitute that confirmed origin in the existing verification scripts:

```sh
node scripts/verify-online.mjs https://YOUR-CONFIRMED-PROJECT.vercel.app
node scripts/verify-languages.mjs https://YOUR-CONFIRMED-PROJECT.vercel.app
node scripts/verify-extra-minute.mjs https://YOUR-CONFIRMED-PROJECT.vercel.app
node scripts/verify-recovery.mjs https://YOUR-CONFIRMED-PROJECT.vercel.app
node scripts/verify-rehearsal.mjs https://YOUR-CONFIRMED-PROJECT.vercel.app
node scripts/verify-scenarios.mjs https://YOUR-CONFIRMED-PROJECT.vercel.app
```

Check direct links to `/host`, `/join/CODE`, `/screen/CODE`, `/play/CODE`, `/recover/CODE`, `/dev`, `/films`, `/cast` and `/party-kit`. In disposable rooms, verify QR origins, phone-only party GM controls, cellular joining, recovery, sealed voting, synchronized attention countdowns and captions following the TV. Test native film pause/replay and a media outage. Scripts create twelve-hour rooms; browsers remain necessary for autoplay, sound and physical-device behavior.

Keep the existing Sites site available: its Worker is also Vercel’s API. Removing that service requires a separate backend migration. Refresh older game tabs after publishing to load the new client.
