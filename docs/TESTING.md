# Testing Dustfall with friends

Public site: https://blood-moon-dustfall.vercel.app

The original Sites host remains available and supplies the same durable room backend.

## Quick developer run

Open `/dev` and create a one-player rehearsal. It creates a real saved player plus a separate GM controller and opens the actual public game stage with a labelled developer toolbar. Open **Player phone** in another tab or join from a phone. Use **Next step** to start, reveal roles, enter each act, open voting, reveal results and return to the lobby. Pause/resume, skip/replay film and ordinary phone actions use the same authoritative mechanics as a party.

This mode is explicitly marked rehearsal and persists across reset/reload. It is selected only when creating the test room. Ordinary rooms still require four guests and keep controls on the GM phone. Entering an ordinary room code in the developer page never grants test controls. Rehearsal mutations also require the saved master credential.

With one player there is no other suspect to accuse, so use Next to reveal an empty ballot. To test actual phone voting, add sample guests in the lobby before starting, or invite another real phone. Sample guests ready/search/share/answer/vote automatically. The ordinary sealing/scoring/verdict rules still apply; the developer toolbar cannot force a particular verdict.

Watch every existing movie at `/films`: opening, five act intros, voting, clue discovery, and all three endings. Select the caption language, play with native controls, and inspect the transcript. Endings contain spoilers. Films are hosted MP4 streams referenced by `public/media/cinematics.json`; they are not saved as local project MP4s. Narration MP3s and timed VTT caption files are local in `public/media/`.

## Full party rehearsal

Use a computer/TV, one GM phone and at least four real or sample guests. Phones can use cellular data or any Wi-Fi.

1. Create an ordinary room. Pair the GM phone or create on `/host` and open its public screen. Enable TV sound once. Check fullscreen and English/Spanish/Portuguese TV captions.
2. Have real guests select different languages before entering, set names and character gender preferences. Confirm all names and connection status on the stage. Record private recovery codes discreetly.
3. Start. Each phone receives one unique character card; TV/GM show only public identities. Read Profile, Secrets and Missions. Ready up; test the GM's explicit continue override with one absent phone if desired.
4. In every act, search one location, publish an assigned clue, submit one case answer and change suspicion. Verify checklist progress, live public evidence and anonymous suspicion. Pin/search public evidence on phones. Check multilingual live captions during a TV film and narrator cue.
5. Pause: countdown, media and phone submissions should stop appropriately. Resume, add one minute, and advance only deliberately. Each next act resets current actions and keeps public evidence and prior answer feedback.
6. Open final voting. Each player chooses another suspect, confirms, then cannot change the final vote. TV shows participation only. Leave one guest unvoted and verify the GM's explicit continue warning. Reveal once; tallies, culprit, solution and awards now appear.
7. Start a new mystery and verify new game identity, cleared prior actions/votes and fresh roles, while local language and room recovery remain.

## Recovery rehearsal

Run these on a disposable room, not a party already in progress. See PLAYER_RECOVERY.md for exact behavior.

- Join, step away, return through saved seat; verify no duplicate identity. Release a lobby seat, confirm capacity returns, then join anew.
- Open the same player in two tabs. Close one; the other stays connected. Close both; the seat becomes away and still resumes.
- After starting, note the character and complete search/share/answer. Recover using the private code on another device. Compare identity, clues, score and accepted actions. Old device access/code must stop working.
- Name the GM, nominate a backup and offer an explicit handoff. Accept only on the selected phone; verify that player's character remains accessible and old master cannot command.
- Disconnect every GM tab. Reconnect before sixty seconds to cancel fallback. Disconnect again; after sixty seconds, only the eligible real connected guest should be able to confirm takeover. Demos and the public TV have no takeover action.
- Test no internet/phone sleep and return. Check away/connected badges, frozen network buttons, no automatic phase change, and no duplicated points/votes after retry.
- Reload the TV and re-enable sound. Verify current film/caption handling and public-only content.

## Automated regression

Use Node24. Install dependencies only if absent. Run:

```sh
npm test
npm run build
node scripts/verify-online.mjs http://localhost:3000
node scripts/verify-languages.mjs http://localhost:3000
node scripts/verify-extra-minute.mjs http://localhost:3000
node scripts/verify-recovery.mjs http://localhost:3000
node scripts/verify-rehearsal.mjs http://localhost:3000
node scripts/verify-scenarios.mjs http://localhost:3000
node scripts/verify-attention.mjs http://localhost:3000
node scripts/verify-party-features.mjs http://localhost:3000
```

Replace the origin with the public site for hosted verification. Scripts create disposable twelve-hour rooms and print only safe counts/status. Unit tests also exercise independent restored engine/service instances and both memory/SQLite repositories with fake-clock15/60/120second boundaries and CAS races. HTTP scripts verify actual anonymous browser→API behavior, but do not replace real mobile/network/media browser testing.

See `PARTY_SCENARIOS.md` for the timing/outage matrix, concurrent GM transitions, delayed recovery responses, missed new-game confirmations, and the local-only browser fault proxy. Refresh existing game tabs after deploying an update so they receive the newest client protections.

`npm run dev` deliberately uses an in-memory local backend and restarts on source changes, clearing local rooms. For an uninterrupted local rehearsal, first build, then run `PORT=3001 npm start` and use that stable origin. The hosted site stores rooms in managed D1 and is not affected by local edits/restarts.


## Party tools rehearsal

1. In the GM lobby, open **Party check** and run the screen test. Both phones and TV receive the ten-second cue; the existing short clue film plays with test captions. Confirm audible sound and readable captions manually. Testing does not deal characters or consume a story cue.
2. Open **Stage and sound**. Music starts enabled at 25%. Enable Sound on the TV once, check that music plays without a GM toggle, then test disabling it and changing volume. Check that a second TV tab does not play a second score, film, clue film or narrator voice, that pausing/looking away stops it, and that speech lowers it.
3. Enable the across-the-room layout. During investigation, spotlight a public card. Check the shared countdown and held act time, then clear it. No private clue is offered until its player publishes it.
4. Use two real connected phones to see optional table-talk partners. Check a new act, a disconnected partner and dismiss/complete. No other player receives the private dossier and no points change.
5. Open `/watch/CODE` in a clean phone/browser and choose Spanish or Portuguese. Check public evidence/captions and that there are no voting, dossier, recovery or GM takeover controls. Reload a spectator view in a browser that also has a saved private seat: it must still be public. Reset and use the ordinary join button when seats reopen.
6. After the final reveal, open Party awards. Submit one complete ballot per real phone, with no self nomination. Only turnout should update on the TV. Reveal early using the GM confirmation, test a tie, and skip/reopen a fresh ballot. Reset must remove the old ballot while keeping stage preferences.

## Phone viewport regression

Use CSS viewport sizes 320×568, 360×800, 375×667, 390×844 and 412×915, plus 844×390 landscape. Check actual `documentElement.clientWidth/clientHeight` before recording a result; the browser's viewport control can target a different tab from the one being inspected.

- In Spanish, select **Cualquiera** on Join. The full label must remain on one line, and every gender choice must remain easy to tap.
- Check character Profile/Secrets/Missions, all three investigation moves, evidence search/clear/pin, and sealed vote confirmation in English, Spanish and Portuguese. No page or control should extend horizontally beyond the viewport.
- Enable phone captions, scroll into the case, change language and rotate. Captions must remain below the actual header. Run a real TV screen test or story film to check wrapped caption text; phones remain silent.
- Tap each move shortcut with captions on and off. After smooth scrolling finishes, the focused heading or clue summary must sit below the entire caption bar. The offset should follow changing caption height, header height and rotation.
- Check 44px caption, language and search-clear touch targets, and 16px editable search/recovery text. At a reduced 390×360 height, focus the recovery input and confirm it can be reached without horizontal scrolling.
- On the GM phone, use the compact landscape action panel, scroll the settings dialog to its lower fields, save, and test invitation-copy and sound controls. Confirmation dialogs must keep their choices reachable.

These checks emulate viewport geometry in the available desktop browser. Physical iOS/Android keyboards, safe-area hardware, browser-specific behavior and audible speaker output still need an actual-device party check.
