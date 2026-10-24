# Joining, leaving and recovering a Dustfall game

Use the same public site from any internet connection. A room lasts twelve hours from creation. A separate game master controls ordinary party rooms from a phone; the computer/TV is the public stage.

## Before inviting everyone

1. Create the party on the computer and scan its one-use game-master QR with the GM phone, or create at `/host` on the GM phone and open `/screen/CODE` on the TV.
2. Give the GM a recognizable name under **Game master and recovery**. Their name and connection status appear to everyone.
3. Each real guest scans the player QR or opens `/join/CODE`, chooses English, Español or Português (Brasil), enters their own name and chooses a character gender. New identities can join only while the lobby is open and unlocked.
4. Each player and the GM should reveal their own **Private recovery code** and keep it privately. This is a twelve-character backup, separate from the public four-letter room code. Never display it on the TV or share it with the whole group.
5. In GM recovery settings, optionally nominate a real guest as backup. Automatic selection uses the first currently connected real guest in roster order. Sample players cannot become GM.

## What is preserved

Closing a tab, losing internet, locking a phone or choosing **Step away** keeps the same seat. Reconnection restores the exact assigned character, secrets, clues, search result, sealed answer, previous answer feedback, suspicion, points and final accusation. The room's current phase and clock continue; connectivity alone never pauses or advances the story.

Local saved entries contain access credentials and public labels, not dossiers or clue text. Home and the join/host pages offer return links. Do not create a fresh identity when returning to an existing seat. A room can be locked, full or already started and still accept an authenticated return.

## Scenario guide

| Situation | Expected behavior / action |
| --- | --- |
| Player closes a tab or steps away in lobby | Seat remains reserved. The roster marks them away when no tab remains live. Return using the saved seat. |
| Player opens two tabs | Each has its own presence lease. Closing one keeps the other connected. Delayed old polls cannot revive a closed tab. |
| Phone sleeps or internet drops | UI reconnects and disables network actions until a successful response. Seat and accepted actions remain. Expiry of presence is not removal. |
| Guest leaves the party permanently before starting | **Release lobby seat** asks for confirmation, removes that identity and invalidates its token/code. The freed capacity can be used by someone else. A GM may also remove a lobby guest. |
| Guest leaves after characters are assigned | Keep the seat and its character for the entire case, including if it is the culprit or a voting target. There is no active-game removal. GM may explicitly continue past missing ready acknowledgements or final votes. |
| Same phone/browser returns | Open the saved game or `/play/CODE`; it resumes without dealing a new character. Join UI offers the existing seat rather than overwriting it. |
| Guest uses a different phone or cleared browser | Open `/recover/CODE`, select Player, and enter their private code. Access and code rotate; old devices lose access. All gameplay data stays intact. |
| A recovery code is exposed | On the authenticated phone choose **Create a new code**, confirm, and save it privately. The previous code stops working. |
| Recovery attempted twice | A lost-response retry uses the same request receipt. An already replaced old code or earlier join receipt cannot resurrect the previous identity. Concurrent operations have a single durable winner. |
| Player was removed or room expired | Previous credentials and codes cannot recover it. Rejoin as a new player only in an open lobby, or start a new room after expiry. |
| Same guest tries to submit again after a dropped response | Accepted search/share/answer/vote and points are not duplicated. Answers and final votes remain sealed and immutable; suspicion can still change. |
| GM temporarily disconnects | Named status changes to reconnecting. Anyone can keep viewing; guests can continue allowed actions. GM returns on the saved phone or uses their private master recovery code. |
| GM deliberately hands over | GM selects a real player and offers the role. Only that player can accept on their phone. Offer expires after two minutes or can be cancelled/replaced. Acceptance rotates master authority and old GM code. |
| GM disappears for a minute | After sixty seconds without authenticated GM activity, the eligible connected guest can confirm **Take over as game master**. This is an explicit action, never automatic promotion. |
| GM reconnects before takeover | The fallback option is cancelled. The original controller continues. |
| Nominated backup is also away | No unrelated guest can bypass the nomination. The existing GM can reconnect/recover and clear or change the backup. Automatic selection is used only without a nominated backup. |
| Former GM returns after handoff/takeover | Old master authority is rejected. They do not silently regain controls. The current GM can offer a new handoff. |
| Promoted GM also has a character | Separate Player and GM sessions remain saved. Switch between **Return to my character** and **Open game master controls**; private character data never appears on the public stage/GM projection. |
| GM phone replacement using master code | Select Game master at `/recover/CODE`. The new controller retains the room and GM name, and replaces previous master credentials. |
| Browser storage is blocked/full | Credentials remain in memory during the current visit and internal return/switch links keep that visit alive. Reveal and keep the private code before closing/reloading the browser. Durable saving cannot be promised when the browser refuses storage. |
| Everyone loses both saved access and private codes | Room code/name are not proof of identity. If no eligible guest remains, create a new room. There is no public identity lookup or secret disclosure shortcut. |
| Computer/TV closes | Reopen `/screen/CODE`. It needs no player/GM identity. Re-enable sound with its sound button if the browser requires it. |
| Player returns during a film | The game resumes at its current phase. Optional silent phone captions follow the actual active TV's reported media clock in the phone's language. Media unavailable/stale is shown honestly. |

Presence expires after fifteen seconds without a device refresh; network/UI updates may add a polling interval. The sixty-second fallback is measured from authenticated GM activity, not from the time somebody notices an away badge. A successful current GM request/reconnection prevents fallback. No name, QR room code, public display capability or sample player can grant private controls.

Final accusation participation is public and updates live. Individual choices and candidate tallies remain private until results. Leaving/recovering cannot change a submitted final vote. Captions, narrator recordings and films use the same existing gameplay event system.
