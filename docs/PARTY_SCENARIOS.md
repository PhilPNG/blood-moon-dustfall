# Party timing and outage scenarios

Use a disposable room for these checks. `/dev` runs the real engine with one-player support and optional sample guests. Ordinary rooms still require four players and keep game-master controls on the phone.

## Scenario matrix

| Situation | Expected behavior | Regression coverage |
| --- | --- | --- |
| Two GM tabs click Next from the same step | Exactly one transition. The other tab refreshes before another deliberate advance. | Memory and SQLite CAS tests; real HTTP concurrency |
| Two GM tabs reveal the final vote together | Results remain visible; the second request cannot reset the room. | Engine/service and HTTP scenarios |
| An old phone answer arrives in the next act | Reject with localized stale-step guidance; current-act answer stays empty. | Engine/service and HTTP scenarios |
| A successful request loses its response | Retrying the same receipt returns safely without duplicate actions, points or transitions. | Existing receipt regressions plus party scenarios |
| A delayed command arrives after reset | Old lobby Start/Kick and old-case readiness cannot affect the reset room or new deal. | Reset generation tests; real HTTP scenarios |
| A recovery response arrives after a newer takeover | Keep the newer saved controller and recovery-code revision. | Real service responses through client storage tests |
| Another tab writes an older rotated credential | Do not replace the newer known credential; a genuinely new room lifetime or player seat is allowed. | Client session scenarios |
| A sleeping phone misses an entire new game and reconnects to the same act/voting step | Clear old selections and confirmations; require a fresh accusation choice. | Game-step identity tests; real browser with isolated player outage |
| Films/caption manifests briefly return HTTP errors or unusable data | Retry with bounded backoff. Reconnection/replay can retry again; already loaded assets stay available. | Loader regressions; real browser fault proxy |
| A non-English phone reconnects during a host film | Silent phone captions follow actual host playback again without reloading. | Existing clock/caption tests; Portuguese browser outage rehearsal |
| A film-library link contains a malformed escaped anchor | Render the page safely rather than crashing React. | Anchor regressions; real browser `/films#%` |
| A rehearsal is left with only one sample guest | Keep automated search/share/answer actions, but leave suspicion and final accusation empty. Never let the sample catch itself. | Memory/SQLite regressions; real HTTP sole-sample flow |
| A browser requires a gesture before playing a film | Keep the manual Play film action available. Pause suspends the watchdog; broken media sources and real stalls still fail within a bounded time. | Production watchdog/error-classification tests with virtual time; normal native playback/pause/replay browser checks |
| Narrator audio fails while TV captions are Spanish or Portuguese | Show the authored translated transcript continuously, including gaps between timed cues. If no authored transcript loaded, use localized gameplay guidance. | Text-selection regressions; real browser MP3 outage with Portuguese captions |

Pending UI choices belong to a room, game, act and reset generation. Routine polling, participation counts, language changes and pause/resume must not erase a current choice. Server commands additionally carry the observed game step and are validated against current authoritative state inside the durable compare-and-swap retry. A successful saved receipt is handled before stale-step rejection so a lost response remains recoverable. Legacy clients remain compatible; refresh open tabs after an update to enable the new safeguards.

Final accusation targets and private dossiers remain private until the intended reveal. The public screen continues to show live participation only. These checks do not authorize changing a live party's progress.

## Repeat the HTTP timing checks

After `npm test` and `npm run build`, start the stable local server and run:

```sh
PORT=3001 npm start
node scripts/verify-scenarios.mjs http://localhost:3001
```

The script creates its own rehearsal, prints safe counts only, and covers concurrent transitions, delayed actions, reset/new-deal isolation, sealed results and translated errors. Run the other suites in `TESTING.md` as well. Hosted verification uses the same script with the public origin.

## Reproduce a phone sleep or asset outage in the browser

For local development only, build first, then run:

```sh
node --import tsx tests/helpers/scenario-preview.ts
```

This binds a proxy to `127.0.0.1:3002` with a fresh in-memory production server. Its control file defaults to `/tmp/dustfall-bugbash-control.json`; an absent file or `{}` means healthy. It is never mounted by the app or deployed Worker.

- `{"blockManifests":true}` temporarily fails film/narrator manifest requests. Open a host and a Portuguese player phone, then restore `{}` and use reconnect/replay to verify actual film playback and silent translated phone captions.
- `{"blockPlayerPolls":true}` fails only player subscription responses while the GM remains connected. Open an unsubmitted accusation confirmation, block the phone, use the GM to reveal/reset/start another case and reach voting, then restore `{}`. The old confirmation must close and all suspect options must be unselected.
- `{"blockRpc":true}` simulates a complete game API outage. Controls freeze while disconnected; accepted state returns after restoring the connection.
- `{"blockAudio":true}` fails only local narrator MP3 requests. Enable host sound and select Portuguese or Spanish captions before a fresh cue. The host should show its translated text fallback; film playback remains available. Restore `{}` before normal media checks.
- `{"delayEvents":{"room:join":2000}}` delays a response after the real backend commits it. The delay is capped at ten seconds. Use it to check response ordering; never log credentials or private responses.

The proxy's `/_qa/status` endpoint reports request counts only. Stop the proxy after testing and remove or reset its control file. Changing source under the ordinary watch server restarts its in-memory engine; use these stable previews for uninterrupted scenarios.
