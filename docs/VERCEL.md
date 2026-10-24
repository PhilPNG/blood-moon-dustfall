# Vercel frontend deployment

Production: **https://party.devicebytes.com**. Public source: https://github.com/PhilPNG/blood-moon-dustfall. The existing Sites service remains https://alibi-mystery-party.honeyspark.chatgpt.site.

## Custom domain and QR joining

`party.devicebytes.com` belongs to the existing Vercel project `blood-moon-dustfall`; it is another frontend address for the same game and room store. Configure only the `party` subdomain using the DNS target supplied by Vercel. Keep the apex domain, nameservers and unrelated records unchanged. Vercel manages HTTPS for the attached domain.

For new parties, open **https://party.devicebytes.com** on the computer and phones. The public player QR encodes `https://party.devicebytes.com/join/CODE`; private desktop-to-GM pairing encodes `https://party.devicebytes.com/host/CODE#ticket=…`. The one-use ticket remains confined to the private pairing screen and clears from the claiming phone's address bar. Once paired, the public screen replaces that QR with the player invitation. GM invitations, public-screen links and spectator links use the same frontend origin. Recovery and saved-game links remain on the domain currently open.

The original https://blood-moon-dustfall.vercel.app address remains available without a forced redirect, as does the Sites address. Browser storage cannot transfer saved player/GM credentials between domains. An existing guest should return to the original domain or recover on the new domain with their private recovery code; recovery replaces their former access while preserving their character and progress. Changing domains never creates a second room database.

## Shared backend, separate frontend

Vercel serves the Vite frontend and existing art, narrator audio, caption tracks and media manifests. `vercel.json` uses `npm run build`, publishes `.web-dist/`, and rewrites `/api/rpc` and `/api/health` to the existing Sites API. The Sites Worker and managed D1 remain authoritative for rooms, votes, recovery, presence and GM controls. A Vercel deploy does not migrate or replace that database.

Frontend routes fall back to `index.html`; `/assets/` and `/media/` remain static files. `api/config.mjs` is a small native Vercel function that returns the current requested frontend origin. Room API rewrites precede the SPA route. API responses use `no-store`. No provider API key is required to play the existing generated media.

Invitations use the current frontend origin: the client normalizes a proxied config response so room QRs stay on the custom domain when opened there. A public room code can identify the same room through every frontend, but browser-saved credentials are origin-scoped. Keep the GM and guests on one origin. Use a private recovery code to move an identity between origins or devices; recovery rotates access on the former device.

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

The GitHub repository is connected to Vercel project `blood-moon-dustfall` in PhilPNG’s team, using the committed settings and Node.js 24. No new database or browser-visible API secret is needed. Pushes to `main` build production; pull requests receive preview builds. GitHub Actions runs the unit suite and production build.

Substitute that confirmed origin in the existing verification scripts:

```sh
node scripts/verify-attention.mjs https://party.devicebytes.com
node scripts/verify-online.mjs https://party.devicebytes.com
node scripts/verify-languages.mjs https://party.devicebytes.com
node scripts/verify-extra-minute.mjs https://party.devicebytes.com
node scripts/verify-recovery.mjs https://party.devicebytes.com
node scripts/verify-rehearsal.mjs https://party.devicebytes.com
node scripts/verify-scenarios.mjs https://party.devicebytes.com
```

Check `/api/config` returns `joinOrigin: "https://party.devicebytes.com"` and `/api/health` reports a healthy game service. Check direct links to `/host`, `/join/CODE`, `/screen/CODE`, `/play/CODE`, `/recover/CODE`, `/watch/CODE`, `/dev`, `/films`, `/cast` and `/party-kit`. In disposable rooms, verify both QR payloads use the custom domain, pair the GM phone, and join from a fresh guest browser. Reload both phones to confirm their saved identities. Verify phone-only party GM controls, cellular joining, recovery, sealed voting, synchronized attention countdowns and captions following the TV. Test native film pause/replay and a media outage. Scripts create twelve-hour rooms; browsers remain necessary for autoplay, sound and physical-device behavior.

Keep the existing Sites site available: its Worker is also Vercel’s API. Removing that service requires a separate backend migration. Refresh older game tabs after publishing to load the new client.
