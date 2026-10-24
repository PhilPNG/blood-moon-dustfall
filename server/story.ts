/** Server-only authored case content. Never import this module into a browser entry point. */
import { characterById, entrySeal, type CharacterProfile } from '../shared/characters.js';

export interface PrivateDossier {
  background: string;
  secret: string;
  alibi: string;
  objectives: string[];
  relationships: { name: string; detail: string }[];
  roleplayTip: string;
}
interface Evidence { id: string; title: string; text: string }
interface ClueText { title: string; text: string }
interface Location { id: string; label: string; description: string }
interface Question {
  id: string;
  prompt: string;
  options: { id: string; text: string }[];
  correctOptionId: string;
  explanation: string;
}

function requireCharacter(id: string): CharacterProfile {
  const character = characterById(id);
  if (!character) throw new Error(`Unknown character: ${id}`);
  return character;
}
function relationship(id: string, detail: string) { return { name: requireCharacter(id).name, detail }; }
function checkRound(round: number) {
  if (!Number.isInteger(round) || round < 1 || round > 5) throw new Error('Story round must be an integer from 1 to 5.');
}

const DOSSIERS: Record<string, PrivateDossier> = {
  'silas-vale': {
    background: 'You spent thirty years making peace between people who would rather draw. Graves promised the treaty would fund a real constabulary and end the town’s dependence on railroad guards. You agreed to check every gun, including your own, at the saloon entrance.',
    secret: 'Years ago you let Jed escape an unjust bounty and signed the ledger as though the prisoner had died. Graves found the altered page and has used it to demand favors ever since. Your badge could be taken if it becomes public.',
    alibi: 'Your account: you inspected the front doors at 8:54, then went to the unlit side porch to check a noise. You returned when you heard the shot. Nobody stood beside you continuously during those missing minutes.',
    objectives: ['Recover the old bounty ledger before the railroad can use it to discredit every arrest you ever made.', 'Make one public promise about fair treatment for human and alien suspects, then keep it during the investigation.'],
    relationships: [relationship('jed-rattler', 'You once saved Jed from a crooked bounty. You trust his ability to read a dangerous room, but his jokes about your age can still make you snap.'), relationship('nyx-ash', 'Nyx helped plan the weapon check. You respect her discipline and want a joint patrol, although neither of you enjoys surrendering authority.')],
    roleplayTip: 'Speak slowly and ask for exact times. Let one dry joke escape when the room gets tense. You may reveal your forged ledger without revealing any other private information.',
  },
  'jed-rattler': {
    background: 'Dustfall knows you as a wanted rider turned indispensable courier. You have carried letters between the town and the crashed ship for weeks, learning that both sides fear being cheated. Tonight’s promised pardon would finally let you travel under your own name.',
    secret: 'The pardon in your pocket is a beautiful forgery that you bought from a traveling clerk. You planned to bluff Graves into honoring it publicly before he noticed. The document concerns your old smuggling charges, not tonight’s crime.',
    alibi: 'Your account: at 8:53 you tied your horse behind the Eclipse and then checked the saddle alone. You say you were still outside when the lights failed; the stable clock had stopped, so you cannot prove the minute.',
    objectives: ['Persuade someone with authority to support a genuine pardon rather than investigating your paper too closely.', 'Find out whether the treaty keeps the desert mail routes open to independent riders like you.'],
    relationships: [relationship('silas-vale', 'Silas gave you a second chance when nobody else would. You tease him to avoid admitting that you still care what he thinks of you.'), relationship('cassidy-blaze', 'Cassidy has lent you horses and never lost track of a debt. You owe her a saddle and an honest explanation of where the last one went.')],
    roleplayTip: 'Make trouble sound like an unfortunate coincidence. Offer to carry messages between groups, and occasionally let your concern for the town show through the grin.',
  },
  'elias-thorne': {
    background: 'You inherited the undertaking shop with its debt, its tools and its meticulous records. Graves wanted a cheap pauper’s cemetery; you insisted every person deserved a name. You came tonight to obtain a written guarantee that alien visitors would receive the same dignity.',
    secret: 'You have been helping indebted families move away by issuing false burial certificates. Six people in your cemetery book are alive and free in another territory. Exposure would ruin your business and return those families to railroad debt.',
    alibi: 'Your account: you left the dining room at 8:52 to straighten a memorial wreath in the quiet coat passage. You were alone with the flowers for several minutes and returned after hearing movement near the rear gallery.',
    objectives: ['Secure a public commitment that every casualty, human or alien, will receive a proper record and funeral.', 'Keep the false burial certificates out of official hands, or win someone’s promise to protect the families named in them.'],
    relationships: [relationship('beatrice-bell', 'Beatrice has quietly directed desperate families to you. You respect her courage and disagree only about how much danger a good deed justifies.'), relationship('sera-lumen', 'Sera asked how Earth remembers the dead. Your conversations have become an unlikely friendship built on careful names and very old songs.')],
    roleplayTip: 'Remain courteous even when saying something chilling. Carry a notebook, offer people a seat, and never let your profession become an excuse to announce unearned forensic facts.',
  },
  'gabriel-flint': {
    background: 'Before you found Dustfall, you survived by giving people convincing stories about a better future. The chapel began as shelter for a stranded rail crew and grew into a calling. You hope the treaty proves that a community can change its habits as well as its fortunes.',
    secret: 'You once performed confidence tricks under the name Gideon Glass. A poster in Graves’s private collection shows your younger face. Your present work is sincere, but you fear the town will mistake your changed life for another performance.',
    alibi: 'Your account: you practiced the treaty blessing in the upstairs prayer alcove from about 8:51. You went downstairs after the blackout, but the alcove has a second stair and nobody checked when you left it.',
    objectives: ['Get two people from different factions to make a practical promise of mutual aid after tonight.', 'Find a safe way to acknowledge your former identity before someone else uses it to destroy the chapel.'],
    relationships: [relationship('ada-crowe', 'Ada let you shelter hungry travelers in her storeroom before the chapel existed. You owe her more than any sermon can repay.'), relationship('orion-vex', 'Orion has asked whether a blessing can include the sky. You enjoy his curiosity and worry that your public reputations rest on equally fragile words.')],
    roleplayTip: 'Offer brief parables, then ask a direct question. Your warmth should invite conversation; save the grand sermon for a moment when the room has earned it.',
  },
  'augustus-pike': {
    background: 'You built the Iron Meridian by making ambitious promises and keeping enough of them to borrow again. Dustfall’s treaty could open markets beyond imagination. You want the rail company seated at that table before its creditors discover how thin the company’s fortunes have become.',
    secret: 'Your celebrated railroad is nearly insolvent. You have been paying last month’s interest with next month’s wages. The ledger in your waistcoat records a disastrous bond issue; it does not record a purchase of alien technology.',
    alibi: 'Your account: at 8:50 you withdrew to the billiard annex to revise your speech and inspect a bond certificate. You claim you stayed there until the shot, although the annex door opens onto the rear gallery.',
    objectives: ['Win a public endorsement for a lawful rail-and-starship trade route before the company’s debts become gossip.', 'Convince a worker or creditor that you will honor the overdue wages instead of making another grand promise.'],
    relationships: [relationship('marigold-shaw', 'Marigold can keep a train running when your managers cannot. She has earned your respect and is in a position to demand much more than compliments.'), relationship('florence-rook', 'Florence refuses to certify ore on the strength of your handshake. Her honesty is useful to investors and deeply inconvenient to you.')],
    roleplayTip: 'Speak as though every disagreement can become a business arrangement. Let panic flicker when someone asks for actual figures, then recover your magnificent composure.',
  },
  'tobias-wren': {
    background: 'You taught yourself electrical engineering through mail-order diagrams and patient mistakes. Translating Asterian signals has given you a glimpse of a career beyond tapping out other people’s telegrams. Graves offered to fund your studies if the treaty succeeded.',
    secret: 'You have been sending unsigned poems over the closed commercial wire to an unknown correspondent aboard the ship. The company would dismiss you for stealing bandwidth. You have hidden the romantic exchange among otherwise ordinary relay logs.',
    alibi: 'Your account: you adjusted a noisy receiver in the telegraph niche shortly before nine. You stepped into the passage when its signal died, and cannot account for the whole blackout from a working clock or witness.',
    objectives: ['Persuade an Asterian guest to explain one peaceful use for the damaged ship’s technology.', 'Recover the private poem tape before the investigation turns an embarrassing correspondence into public entertainment.'],
    relationships: [relationship('lyra-nine', 'Lyra has been explaining star charts in exchange for lessons in Morse code. You admire her certainty and fear looking foolish in front of her.'), relationship('evelyn-sterling', 'Evelyn uses your office as a newsroom annex. You enjoy her company but know that a private wire makes irresistible newspaper copy.')],
    roleplayTip: 'Ask permission before sketching a theory. When nervous, compare conversations to crossed wires; when someone is kind, let your sincerity replace the technical language.',
  },
  'finch-mercer': {
    background: 'You live by reading what people hope the cards will say. Graves asked you to run tonight’s friendly tournament, a generous description for a table surrounded by rivals who distrust one another. You came prepared to win enough money to leave the circuit behind.',
    secret: 'You marked a deck to recover a family heirloom from a cheat who had first cheated you. That rigged deck is still in your pocket. You cannot expose the original swindle without admitting that your celebrated streak is partly manufactured.',
    alibi: 'Your account: you counted the tournament chips alone in the little cashier’s booth at 8:54. You say you waited there through the dark; its service hatch also opens into the gallery and nobody watched it.',
    objectives: ['Get your family’s silver signet ring back through negotiation rather than another crooked game.', 'Read the room well enough to name one truthful statement and one bluff, explaining the evidence for each.'],
    relationships: [relationship('delphine-dusk', 'Delphine knows the difference between skill and a marked deck. She has kept your professional embarrassments quiet, and expects the same courtesy.'), relationship('augustus-pike', 'Augustus lost generously at your table, then tried to settle with railway bonds. You have begun to suspect that your winnings are mostly decorative paper.')],
    roleplayTip: 'Never force another guest to gamble or disclose a secret. Offer playful wagers about public evidence, and allow one honest admission to cost you visible pride.',
  },
  'orion-vex': {
    background: 'You were appointed ambassador after the crash because you could apologize in twelve languages. The delegation needs local food and spare materials; the town needs assurance that the ship is a neighbor rather than an invasion. You have staked your career on this agreement.',
    secret: 'Your diplomatic credentials expired before the ship left home. You acted beyond your authority to prevent a frightened crew from threatening the town. If headquarters learns this first from a hostile report, your peace could be branded a fraud.',
    alibi: 'Your account: you rehearsed a translation in the curtained reception booth after 8:52. The booth was empty when you entered and the translator lost its clock during the blackout, leaving your departure unrecorded.',
    objectives: ['Secure a spoken commitment that the treaty will be judged on its terms rather than on your personal credentials.', 'Ask a human guest to teach you a local courtesy, then use it sincerely in a tense conversation.'],
    relationships: [relationship('gabriel-flint', 'Gabriel treats your language mistakes with kindness. You sense that he also knows what it means to grow into a title after assuming it.'), relationship('nyx-ash', 'Nyx is charged with protecting you and knows that you sometimes omit awkward facts. She will follow a lawful order; do not confuse that with unquestioning trust.')],
    roleplayTip: 'Be ceremonious without being cold. Translate an idiom too literally once, then demonstrate that your attention to people is sharper than your command of slang.',
  },
  'keth-solaris': {
    background: 'You know every damaged conduit on the ship and exactly how many days remain before its stored energy runs low. Earth’s machinery is primitive but ingenious. You believe cooperation could get the crew home, provided nobody starts treating the power system as a curiosity to dismantle.',
    secret: 'You traded a harmless shipboard heater for a crate of human bearings without seeking authorization. The manifest calls the heater scrap. You fear punishment for breaking export rules, although the device cannot operate a weapon or open the core vault.',
    alibi: 'Your account: at 8:53 you inspected the saloon’s steam radiator from the service passage. You made notes alone, then moved toward the ballroom when the lights went out. Your tool harness has no clock.',
    objectives: ['Make someone understand the difference between repairing the ship and selling pieces of it.', 'Retrieve or regularize the unauthorized heater trade before a missing manifest line becomes an international grievance.'],
    relationships: [relationship('marigold-shaw', 'Marigold solved a coupling problem that defeated your translation software. You consider her a colleague, even when she calls your calculations fussy.'), relationship('rowan-quill', 'Rowan keeps proposing that the ship grow replacement parts. You respect his patience and wish he would keep roots out of your ventilation ducts.')],
    roleplayTip: 'Examine imaginary machinery with your eyes rather than touching props or people. Explain one technical point in ordinary words and grudgingly admire a human invention.',
  },
  'rowan-quill': {
    background: 'You joined the expedition to study living systems, not negotiate mining rights. Dustfall’s soil could recover if its residents accept your drought-resistant seeds. You hope the treaty will protect an experimental garden instead of making it another piece of somebody’s property.',
    secret: 'You planted a small test bed on mayoral land without permission. Its night-blooming flowers sing faintly, which the town has mistaken for a haunting. You have been sneaking out to water them and allowing the ghost story to protect the experiment.',
    alibi: 'Your account: you went into the rear conservatory to check a wilting specimen around 8:51. You say you remained with it until the shot, but the conservatory’s open service door offers no independent proof.',
    objectives: ['Obtain a promise of protected land for a lawful shared garden, with neither faction claiming exclusive ownership.', 'Choose whether to explain the singing flowers before frightened guests decide that Dustfall is haunted.'],
    relationships: [relationship('cassidy-blaze', 'Cassidy distrusts untested seeds near her cattle, but she has shown you every spring on her land. You want her to become a partner in the experiment.'), relationship('keth-solaris', 'Keth complains about your seedlings and secretly repairs their lamps. You know his grumbling is one of his forms of affection.')],
    roleplayTip: 'Notice little details and invite others to slow down. You may be fanciful about plants, but keep the distinction between a botanical observation and proof of murder clear.',
  },
  'ada-crowe': {
    background: 'The Eclipse is the first thing you have owned that nobody can order you to leave. You offered it as treaty ground because every faction already owes you a meal or a favor. Graves promised the event would cancel the saloon’s municipal lien.',
    secret: 'A concealed room beneath your pantry shelters travelers escaping exploitative labor contracts. You have paid fines and lied about deliveries to keep them safe. The room is separate from the ship’s core vault and has no passage to it.',
    alibi: 'Your account: you checked a late supper in the pantry at 8:54 and sent the kitchen help out to hear the speeches. You say you stayed behind to tally the plates, leaving a few minutes nobody can corroborate.',
    objectives: ['Keep the sheltered travelers out of the investigation, or win a trustworthy promise of protection before naming them.', 'Have the guests agree that the Eclipse remains neutral ground even if tonight’s treaty falls apart.'],
    relationships: [relationship('gabriel-flint', 'Gabriel has fed the travelers in your hidden room without asking for repayment. You trust his good heart more than his polished stories.'), relationship('delphine-dusk', 'Delphine’s performances bring custom and chaos. You protect her backstage privacy; she owes you a replacement chandelier and a straight answer about it.')],
    roleplayTip: 'Host the conversation as though it were your saloon: welcome shy guests, interrupt cruelty and ask useful questions while polishing an imaginary glass.',
  },
  'beatrice-bell': {
    background: 'You crossed the territory to build a clinic and found a town that paid doctors in chickens. Treating alien patients taught you how little either species knows about the other. You want the treaty’s medical exchange more than any ceremonial speech.',
    secret: 'You have been treating injured rail workers without recording their names, so their employer cannot dismiss them as unfit. Graves ordered a full patient list. Your refusal could cost the clinic its lease and your patients their wages.',
    alibi: 'Your account: you sorted bandages in the downstairs washroom at 8:52 after a guest cut a finger. The patient had already left; you were alone until the blackout brought you back toward the ballroom.',
    objectives: ['Win a commitment to confidential treatment for anyone hurt tonight, regardless of faction or employment.', 'Protect your unnamed patients while explaining which forensic observations are facts and which are guesses.'],
    relationships: [relationship('elias-thorne', 'Elias has helped families you could heal but could not keep safe. You are grateful and afraid that his records could expose your patients.'), relationship('florence-rook', 'Florence lends you precision scales for medicines. You trust her measurements and challenge her habit of treating people like mineral samples.')],
    roleplayTip: 'Use calm, specific language and ask before approaching another guest. The app provides the case’s medical facts; your profession does not grant extra secret diagnoses.',
  },
  'cassidy-blaze': {
    background: 'Your ranch survived drought, debt and the astonishing sight of a saucer plowing into the far ridge. The crash damaged your fence but revealed a watercourse. You want fair compensation and a treaty that leaves small ranches a future.',
    secret: 'You found a natural spring beneath disputed railway land and have quietly watered neighboring herds from it. Your unauthorized irrigation is why so many cattle survived the summer. A legal ruling could close the channel and bankrupt those ranches.',
    alibi: 'Your account: you checked the stable trough at 8:53, then took a bucket through the side yard. You say you were still there during the blackout, but nobody followed you and the yard reaches the gallery door.',
    objectives: ['Get someone with influence to support common access to the new spring instead of an exclusive concession.', 'Collect Jed’s promise to settle his horse-and-saddle debt in something more useful than another story.'],
    relationships: [relationship('jed-rattler', 'Jed is a reliable rider and an unreliable borrower. You know his better nature, but you have stopped accepting charm as payment.'), relationship('rowan-quill', 'Rowan offered seeds that might revive your pasture. You like his care for living things and insist on hearing the risks before agreeing to a trial.')],
    roleplayTip: 'Ask what a plan means for ordinary people, animals and water. Keep the bluster friendly; a practical offer is more persuasive than threatening to lasso a suspect.',
  },
  'delphine-dusk': {
    background: 'You built a stage career from patient rehearsal while audiences insisted that a woman’s cleverness must be supernatural. The treaty gala is your largest engagement yet. You want the visitors to admire your artistry even after seeing its wires.',
    secret: 'Your famous levitation relies on a stolen theater patent. You have been saving royalties to buy the rights honestly, but the patent holder’s representative may be in town. The stage harness cannot reach the mayor’s office or the core vault.',
    alibi: 'Your account: you changed gloves behind the stage curtain at 8:54 after your opening act. Your assistant had gone home. You say you stayed backstage when the lights failed; the scenery hides a service exit.',
    objectives: ['Persuade one skeptic that a cleverly made illusion still deserves respect after its mechanism is understood.', 'Arrange a legitimate purchase of your stage patent without turning the gala into a public dispute over theft.'],
    relationships: [relationship('finch-mercer', 'Finch can spot your false shuffle, and you can spot his. You share professional courtesy and a dangerous amount of mutual leverage.'), relationship('ada-crowe', 'Ada gave you the stage when better theaters refused. You want to repay her faith, even if admitting the chandelier mishap costs you a month’s wages.')],
    roleplayTip: 'Use a flourish to invite attention, then reveal one small truth. Never conceal a required game clue as part of a trick or imply you have abilities beyond your dossier.',
  },
  'evelyn-sterling': {
    background: 'You bought the Gazette’s battered press with money earned writing under somebody else’s name. Dustfall deserves news that does not arrive approved by the railway. Tonight you want a true account of the treaty, including the small print nobody reads aloud.',
    secret: 'You printed an early edition accusing Graves of selling water rights, then discovered your source had confused two contracts. Most copies were destroyed; one remains in your camera case. Publishing recklessly could wreck your credibility for good.',
    alibi: 'Your account: you developed a test plate in a curtained storage closet at 8:51. You stepped out when the power faltered, and the plate records a wall rather than the minutes when you were alone.',
    objectives: ['Correct the false water-rights story before it can harm someone, without surrendering the paper’s independence.', 'Obtain two on-the-record statements that distinguish observed evidence from rumors about human or alien motives.'],
    relationships: [relationship('tobias-wren', 'Tobias helps transmit your dispatches after hours. His guarded manner around one particular wire tells you there is a personal story he is not ready to print.'), relationship('sera-lumen', 'Sera records exactly what people say; you care about what they mean. Your arguments over accuracy are becoming the best reporting lessons you have had.')],
    roleplayTip: 'Ask whether a remark is on the record and respect the answer. Quote people accurately, carry a notebook and let correcting yourself become a sign of integrity.',
  },
  'florence-rook': {
    background: 'You have spent three decades proving that careful measurement can outlast a gold rush. The crash brought materials unlike anything in your books. Graves asked you to appraise the treaty exchange and you insisted on testing every sample.',
    secret: 'You replaced a fraudulent railway ore certificate with a correct one but kept the fee meant to secure your silence. You used the money to repay cheated prospectors. Your measurements were honest; your account of where the fee went was not.',
    alibi: 'Your account: you checked sealed mineral samples in the assay alcove around 8:52. You were working alone and left your goggles there; their presence cannot establish that you remained through the blackout.',
    objectives: ['Get the mineral exchange valued openly, with the same standards applied to the railway and the delegation.', 'Find an ally willing to help regularize the repayment fund before the missing fee is mistaken for a bribe.'],
    relationships: [relationship('augustus-pike', 'Augustus likes your signature more than your questions. You know his ore estimates are optimistic and suspect that optimism is becoming desperation.'), relationship('beatrice-bell', 'Beatrice borrows your best scales and returns them cleaner. You admire her courage, though you disagree about when a record should be withheld.')],
    roleplayTip: 'Ask what would disprove a theory. Make one firm distinction between a measured fact and a tempting assumption, then show a warmer interest in the person holding the theory.',
  },
  'marigold-shaw': {
    background: 'You entered the rail yard as a cleaner and became the person everyone calls when an engine refuses to move. The company still pays you less than the men you train. The treaty’s new machinery could mean advancement, or another excuse to overlook the workers.',
    secret: 'You copied company repair diagrams and gave them to a workers’ cooperative. The copies concern ordinary locomotive parts. Pike would call it industrial theft; you call it making sure the people who do the work can bargain fairly.',
    alibi: 'Your account: you fetched a clean rag from the saloon’s service landing at 8:54, then inspected a stubborn lamp alone. You say you stayed there during the failure, but the landing overlooks the rear gallery.',
    objectives: ['Secure support for fair pay and training before the treaty creates a new class of better-paid machinery experts.', 'Decide whom to trust with the copied diagrams so the cooperative survives even if the company discovers your part.'],
    relationships: [relationship('augustus-pike', 'Pike praises your ingenuity when a train is late and forgets your name when wages are discussed. You intend to make that arrangement change.'), relationship('keth-solaris', 'Keth treats your engineering as real expertise. You enjoy proving that a well-made human bearing can solve an extraterrestrial problem.')],
    roleplayTip: 'Use vivid everyday explanations. You can puncture a pompous theory without humiliating its author; invite the quiet guest to help you test it.',
  },
  'lyra-nine': {
    background: 'You have brought crews safely through uncharted space and still wake to the sound of this landing. The ship encountered a storm that should not have existed. Tonight’s treaty may buy time to repair the vessel and rebuild your crew’s trust.',
    secret: 'You omitted a warning from your official navigation report because you feared it would end your flying career. You have since reconstructed the readings and know the warning could not have prevented the crash, but the omission itself remains yours.',
    alibi: 'Your account: you compared star charts in the rooftop stairwell at 8:52. You say cloud cover kept you there until the blackout; neither the rooftop nor the service stair has a witness who can time your movements.',
    objectives: ['Tell someone the complete story of the omitted warning, including what the later calculations do and do not prove.', 'Make a practical agreement for the ship’s safe departure that also honors what the crew owes the town.'],
    relationships: [relationship('tobias-wren', 'Tobias asks questions without judging your mistakes. You have been replying to his unsigned poems in a code neither of you has formally admitted to knowing.'), relationship('orion-vex', 'Orion speaks of peace while you count fuel and days. You rely on his negotiations and want him to be more candid about the limits of his authority.')],
    roleplayTip: 'Give clear directions when discussion drifts, then leave room for others to choose the course. Let admitting a navigation mistake cost you pride without collapsing your confidence.',
  },
  'nyx-ash': {
    background: 'You trained to protect people during first contact and learned that fear can turn ordinary gestures into threats. Dustfall has tested your patience and won your affection. You want tonight’s agreement to replace emergency orders with rules both sides understand.',
    secret: 'You disabled a distress beacon that would have summoned an armed retrieval crew before the talks. You believed it would provoke a battle. The beacon is unrelated to the containment field, which still works exactly as designed.',
    alibi: 'Your account: you checked the west service latch at 8:53, then walked a circuit beyond the reception booth. You say you were securing it when the dark came; the patrol route was yours alone.',
    objectives: ['Persuade the guests to adopt a shared safety rule based on conduct rather than species or uniform.', 'Find someone who will support your decision to delay the distress call before the crew learns it as an accusation.'],
    relationships: [relationship('silas-vale', 'Silas understands how much judgment hides behind a simple order. You respect him and watch carefully for the moment loyalty overtakes fairness.'), relationship('orion-vex', 'Orion’s diplomacy has kept everyone alive. You suspect his credentials are irregular and want the truth before you must defend them publicly.')],
    roleplayTip: 'Be economical with words and generous with attention. Keep all intimidation theatrical and consensual; you are a guest at a party, even while playing a sentinel.',
  },
  'sera-lumen': {
    background: 'You remember civilizations through the songs they nearly lost. The ship’s damaged archive makes every new recording precious. You came to preserve a treaty and have found a town whose ordinary stories may be just as important.',
    secret: 'You erased an official recording of frightened crew members insulting the town. You kept a written account of your decision so the deletion would not become an invisible lie. A strict archivist would call it a betrayal of your calling.',
    alibi: 'Your account: you cleaned a memory prism in the music alcove at 8:51. It was switched off for maintenance and records none of the blackout. You say you stayed beside the piano, but its bench was hidden by the reception curtain.',
    objectives: ['Create a short shared account of tonight using only facts the group can support, leaving disputed claims clearly marked.', 'Decide whether preserving trust justifies the deleted recording, and tell someone what responsibility you are prepared to accept.'],
    relationships: [relationship('elias-thorne', 'Elias remembers people without reducing them to their endings. You value his careful names and have promised him a song for the cemetery.'), relationship('evelyn-sterling', 'Evelyn wants a story that changes the future. You want an account the future can trust; each of you catches the other taking shortcuts.')],
    roleplayTip: 'Repeat an exact phrase when it reveals a contradiction, then give its speaker room to explain. Memory is your craft, but you only know the facts the game actually provides.',
  },
};

export function privateDossier(characterId: string): PrivateDossier {
  requireCharacter(characterId);
  // Fresh objects prevent one player or a snapshot migration from mutating another dossier.
  return structuredClone(DOSSIERS[characterId]);
}

const QUESTIONS: Question[] = [
  {
    id: 'case-1-method', prompt: 'Which sequence best fits the physical evidence?',
    options: [
      { id: 'coil-then-blank', text: 'An induction coil killed Graves; a blank shot then staged a gun murder.' },
      { id: 'revolver', text: 'A revolver bullet killed Graves before the electrical failure.' },
      { id: 'field', text: 'The containment field killed Graves when it closed over town.' },
    ],
    correctOptionId: 'coil-then-blank',
    explanation: 'The branching electrical burn and discharged peace medallion establish an induction-coil strike. The recovered blank wadding and absence of a bullet wound make the later gunshot a deliberate distraction.',
  },
  {
    id: 'case-2-motive', prompt: 'What does the Black Star escrow actually establish?',
    options: [
      { id: 'alien-only', text: 'Only a member of the alien delegation could profit from the theft.' },
      { id: 'auction', text: 'Someone planned to sell the stolen core and needed Graves’s treaty to remain unsigned.' },
      { id: 'land', text: 'The core was exchanged for the town’s water rights.' },
    ],
    correctOptionId: 'auction',
    explanation: 'The escrow offers a living Asterian power core to an off-world buyer under the Black Star alias. Graves’s signed treaty would place the core under joint custody and prohibit private sale. An alias proves a plan, not a species or a name.',
  },
  {
    id: 'case-3-identity', prompt: 'Which evidence should carry the most weight in a final accusation?',
    options: [
      { id: 'secret', text: 'The suspect with the most embarrassing unrelated secret.' },
      { id: 'expertise', text: 'The suspect whose profession sounds most technical.' },
      { id: 'linked-records', text: 'The intersection of the gallery seal color and the cradle motif, linked by the live audit.' },
    ],
    correctOptionId: 'linked-records',
    explanation: 'The gallery preserves a seal color and the cradle preserves a motif. Each alone fits several guests; their intersection fits one public entry seal. The continuous live audit links that seal to the breaker, coil interval, core removal and Black Star escrow. A hidden personal secret or technical occupation does not make that chain disappear.',
  },
  {
    id: 'case-4-timeline', prompt: 'Why does the order of the blackout, coil strike and shot matter?',
    options: [
      { id: 'staging', text: 'It shows the shot was staged after the lethal electrical strike.' },
      { id: 'two-killers', text: 'It requires two different killers to have been in the office.' },
      { id: 'all-clear', text: 'It clears anyone who says they heard the gunshot from outside.' },
    ],
    correctOptionId: 'staging',
    explanation: 'The breaker fell at 8:56, the coil discharged at 8:57 and the blank fired at 8:58. One person could perform all three actions along the open gallery route; a claim about hearing the shot does not independently establish where its speaker was a minute earlier.',
  },
  {
    id: 'case-5-standard', prompt: 'Which final argument follows the complete evidence?',
    options: [
      { id: 'popularity', text: 'The most popular suspect is guilty because many people agree.' },
      { id: 'chain', text: 'Intersect the independent seal fragments, then explain method, motive and timing.' },
      { id: 'confession', text: 'No accusation is possible unless the culprit volunteers a confession.' },
    ],
    correctOptionId: 'chain',
    explanation: 'A supported accusation intersects the gallery color with the cradle motif to find one public entry seal, then connects its verified live audit to the induction coil, staged blank, stolen core and Black Star sale. Agreement, charisma and a voluntary confession are not substitutes for the independent records available to every group.',
  },
];

export function getQuestion(round: number): Question {
  checkRound(round);
  return structuredClone(QUESTIONS[round - 1]);
}

const LOCATIONS: Location[][] = [
  [
    { id: 'mayors-office', label: 'Mayor’s Office', description: 'A cracked peace medallion and a desk overturned in the dark.' },
    { id: 'saloon-stage', label: 'Saloon Stage', description: 'A smoke-stained curtain, a locked gun rack and something beneath the boards.' },
    { id: 'rear-gallery', label: 'Rear Gallery', description: 'The shared service route, its breaker box and a jammed audit camera.' },
  ],
  [
    { id: 'treaty-table', label: 'Treaty Table', description: 'Unfinished signatures and the custody clause nobody read aloud.' },
    { id: 'telegraph-relay', label: 'Telegraph Relay', description: 'An escrow message waiting for a buyer beyond the atmosphere.' },
    { id: 'service-stairs', label: 'Service Stairs', description: 'An open path between the ballroom, the mayor and the core vault.' },
  ],
  [
    { id: 'audit-camera', label: 'Audit Camera', description: 'Three recovered exposures from a lantern that never lost power.' },
    { id: 'entry-registry', label: 'Entry Registry', description: 'The signed guest seal that can finally put a name to Black Star.' },
    { id: 'core-vault', label: 'Core Vault', description: 'A closed security loop with one unambiguous removal record.' },
  ],
  [
    { id: 'clockwork-bench', label: 'Clockwork Bench', description: 'Independent clocks line up the blackout, the strike and the staged shot.' },
    { id: 'evidence-cabinet', label: 'Evidence Cabinet', description: 'The coil, the medallion and the blank cartridge compared side by side.' },
    { id: 'escrow-cache', label: 'Escrow Cache', description: 'A second copy of the sale offer, preserved outside the town network.' },
  ],
  [
    { id: 'case-board', label: 'Case Board', description: 'Build a final argument from observations the entire room can inspect.' },
    { id: 'landing-beacon', label: 'Landing Beacon', description: 'The buyer’s canceled approach and a core still hidden inside the field.' },
    { id: 'treaty-archive', label: 'Treaty Archive', description: 'Separate the murderer’s commercial plan from everyone else’s private troubles.' },
  ],
];

function evidence(round: number, culprit: CharacterProfile): Evidence[] {
  const seal = entrySeal(culprit.id);
  switch (round) {
    case 1: return [
      { id: 'electrical-burn', title: 'A Death Before the Shot', text: 'Graves has no bullet wound. A branching electrical burn crosses his chest beneath the brass peace medallion. Its fused contact matches an induction coil missing from the saloon’s public demonstration cabinet.' },
      { id: 'blank-wadding', title: 'The Revolver Was Theater', text: 'A fired blank and its paper wadding lie beside the staged revolver. The office clock’s electrical contact stopped at 8:57; the shot rang out at 8:58. Someone wanted the room to remember a gun murder.' },
      { id: 'recorder-seeded', title: 'Three Exposures, One Stolen Core', text: 'The Asterian core is gone and its containment field has sealed Dustfall. A battery-lit audit camera overlooks the rear gallery; its jammed tape counter shows three exposures. Every guest’s public entry seal has a color and a motif, bound to a live admission signature.' },
    ];
    case 2: return [
      { id: 'black-star-offer', title: 'A Buyer for Black Star', text: 'A sealed 8:47 escrow message offers a living Asterian core at a private auction under the alias Black Star. Payment requires the core intact and the joint-custody treaty unsigned. The bidder’s seal image is obscured by a damaged strip.' },
      { id: 'custody-clause', title: 'The Price of Peace', text: 'Graves’s final custody clause would forbid private sale of the core and place it under joint human–Asterian supervision. Killing him before signing buys the seller a brief window to steal it and escape with the auction proceeds.' },
      { id: 'common-access', title: 'A Route Open to Every Guest', text: 'The rear gallery connects the breaker, office and core vault. All treaty guests received a registered entry seal and a demonstration of the universal coil switch. Neither species, profession nor gun ownership limits who could use this route.' },
    ];
    case 3: return [
      { id: 'gallery-color-trace', title: 'The Gallery Keeps a Color', text: `The repaired battery-lit exposures hide the face and badge motif, but preserve one clear seal color: ${seal.color}. The same live-verified admission signature crosses the breaker at 8:56, the office with an induction coil at 8:57, and the vault passage after the 8:58 blank shot. A color alone leaves five possible public seals.` },
      { id: 'vault-symbol-trace', title: 'The Cradle Keeps a Motif', text: `The core-vault audit preserves one badge motif: ${seal.symbol}. Its color layer is lost. This live-contact signature removed the core at 8:59 and matches the original 8:47 Black Star escrow. The continuous audit ties it to the gallery trace; a borrowed badge cannot supply its living verification. A motif alone leaves four possible seals.` },
      { id: 'registry-intersection', title: 'Two Fragments, One Entry', text: 'The public admission registry gives every character a unique color-and-motif pair, shown on their entry seal. Compare the gallery’s color with the cradle’s motif, then find the one profile satisfying both. Use the full public cast list if needed. The records do not preserve a readable name or face.' },
    ];
    case 4: return [
      { id: 'clock-comparison', title: 'Three Clocks Agree', text: 'The saloon breaker log, Graves’s stopped contact clock and the stage’s mechanical cue roll agree: blackout 8:56, induction-coil strike 8:57, blank shot 8:58. The apparent gun murder was a delayed performance.' },
      { id: 'color-crosscheck', title: 'The Second Color Reading', text: `A second inspection of the independent gallery lantern confirms ${seal.color} in the entry seal’s color band. No motif is legible in that exposure. The live signature follows the breaker-to-office route, so compare this fragment against the separate cradle record rather than guessing a profession.` },
      { id: 'symbol-crosscheck', title: 'The Off-Town Motif Copy', text: `An off-town escrow receiver independently retained the ${seal.symbol} motif. Its pigment layer is absent. The copied live signature matches the core-vault removal record and gallery trace; combine the two public seal attributes to identify the registered guest without inventing a second attacker.` },
    ];
    default: return [
      { id: 'closing-color', title: 'The Color in the Last Exposure', text: `The final gallery exposure again preserves ${seal.color} on the seal band as the figure heads toward the vault after the blank shot. The face and motif remain obscured. This narrows the public registry but cannot identify a guest on its own.` },
      { id: 'closing-symbol', title: 'The Motif in the Sale Offer', text: `The Black Star original preserves the ${seal.symbol} motif and the same verified live signature as the 8:59 core removal. Its color is unreadable. Intersect this motif with the independent gallery color and compare the public entry-seal labels before choosing a name.` },
      { id: 'buyer-withdraws', title: 'No Escape Through the Field', text: 'The buyer cancels the approach: the containment field is still closed, so the stolen core remains inside Dustfall. Its theft triggered the field automatically. The accusation still needs a seal intersection, a method and a motive; a personal secret or a popular suspicion is not an extra identity record.' },
    ];
  }
}

const ACT_TEXT = [
  {
    title: 'Act I · A Shot in the Eclipse',
    narration: 'Halloween, 1887. The Eclipse Saloon glows beneath a red moon as Dustfall prepares to make peace with its stranded visitors from the stars. The lights fail. A shot cracks through the ballroom. Mayor Solomon Graves lies dead, the alien power core is missing, and a humming containment field folds over the town. Every guest is trapped with a story to tell.',
    prompt: 'Reconstruct what actually killed Graves. Which observations establish a sequence, and which details merely sound suspicious?',
  },
  {
    title: 'Act II · The Black Star Bargain',
    narration: 'Beyond the windows, the field turns the desert into violet glass. Under a ribbon of telegraph paper lies a bargain worth more than the entire town: a living power core offered to a buyer in the sky. The treaty was more than a ceremonial promise. Its unsigned last clause stood between somebody and a fortune.',
    prompt: 'Who benefited from delaying the treaty, and what proves a plan to profit? Compare the common access route before accusing a faction.',
  },
  {
    title: 'Act III · What the Lantern Kept',
    narration: 'The saloon’s battery lantern gives a final stubborn flicker. Beneath it, the repaired audit tape runs again: a breaker falls, a figure crosses the gallery, a vault opens. One record keeps a seal’s color; another keeps its motif. The damaged strips are fitted against the public guest registry. Black Star’s alias is about to face a test no single fragment could settle.',
    prompt: 'Intersect the seal fragments, then link that deduction to the method and motive. Give each suspect a chance to explain before you seal your final accusation.',
  },
  {
    title: 'Act IV · The Minute Between',
    narration: 'A persuasive accusation needs both a seal intersection and a sequence. The room lays three clocks beside a coil, a cracked medallion and an empty cartridge. An independent relay copy arrives from outside the field. This is time to test the reconstruction against the evidence and hear the strongest objection.',
    prompt: 'Build the three-minute route aloud. Can the evidence explain the blackout, killing, staged shot and theft without inventing a second criminal?',
  },
  {
    title: 'Act V · Before the Last Bell',
    narration: 'The off-world buyer turns away, unwilling to approach a sealed town. Somewhere inside Dustfall, the stolen core still hums. The treaty pages wait beside the case board. Before the last bell, the guests must decide whether their accusation follows the facts closely enough to survive the morning.',
    prompt: 'State your final case in one minute: the person, the method, the motive and the independent records. Challenge an inference with evidence.',
  },
];

export function getAct(round: number, culpritCharacterId: string) {
  checkRound(round);
  const culprit = requireCharacter(culpritCharacterId);
  const { correctOptionId: _answer, explanation: _explanation, ...question } = getQuestion(round);
  return { ...ACT_TEXT[round - 1], evidence: evidence(round, culprit), locations: structuredClone(LOCATIONS[round - 1]), question };
}

function slip(title: string, text: string): ClueText { return { title, text }; }

function clueBank(round: number, culprit: CharacterProfile): ClueText[] {
  const seal = entrySeal(culprit.id);
  const first = [
    slip('The Brass Medallion', 'The peace medallion’s back is fused into a tiny branching pattern. Its front is intact: the damage traveled through an electrical contact against Graves’s chest, rather than through a bullet hole.'),
    slip('The Empty Cartridge', 'The revolver holds one spent blank. Its crimped mouth has opened, but there is no bullet to recover. The dramatic shot does not explain the electrical burn on Graves.'),
    slip('A Minute Too Late', 'The office clock stopped when a surge fused its electrical contact at 8:57. The mechanical stage cue roll records the gunshot at 8:58. Something lethal happened before the sound everyone remembers.'),
    slip('The Missing Demonstrator', 'The public technology cabinet is missing a small induction coil. Its card describes a universal thumb switch and a dangerous live contact; the apparatus does not require an engineer to operate.'),
    slip('Paper Under the Desk', 'A twist of scorched blank-cartridge wadding lies below the desk. There is powder on the carpet but no bullet strike in the wall behind Graves. Somebody arranged the scene to suggest a shooting.'),
    slip('The Field’s Warning', 'The containment notice says the field closes automatically if the power core leaves its cradle. Its alarm began after the gunshot. The field is a response to the theft, not the cause of the earlier death.'),
    slip('A Shared Corridor', 'The rear gallery has doors to the ballroom, service stairs, mayor’s office and core-vault vestibule. No lock divides its length. A guest could move between these places without crossing the crowded dance floor.'),
    slip('The Lantern Battery', 'The gallery audit camera uses its own battery lantern. The saloon blackout could hide a person from the ballroom while leaving a usable exposure on the recorder’s tape.'),
    slip('Three Turns of Tape', 'The recorder counter advanced three exposures during the disturbance. Its tape is jammed rather than burned. Repairing a physical fault may recover the missing minutes without trusting any suspect’s account.'),
    slip('A Cold Gun Rack', 'The checked weapons remain in the entrance rack with their ties intact. The staged revolver was a theatrical blank-firing prop. Ownership of an ordinary gun cannot by itself identify the killer.'),
    slip('Copper on the Cuff', 'Loose copper whiskers on the desk match the torn contact braid of the missing demonstration coil. They are electrical debris, not evidence that a particular guest wore copper jewelry.'),
    slip('A Window Still Latched', 'The mayor’s office window is latched from within and its dusty sill is undisturbed. The connected rear gallery offers a much better supported route than a stranger firing from the desert.'),
    slip('The Torn Contact Lead', 'A lead from the induction-coil cabinet has been cut short. The portable coil could be carried by one person; it did not have to remain connected to the saloon lighting circuit to deliver its stored charge.'),
    slip('The Blackout Switch', 'The main breaker lever is down, but its fuse is not blown. The darkness was deliberately switched on before the office clock’s surge. An accidental overloaded lamp cannot explain both events.'),
    slip('No Poison Cup', 'Graves’s untouched toast remains on the treaty table. The available examination establishes an electrical burn, not a poison reaction. A guest’s interest in herbs or medicine is not physical proof of this crime.'),
    slip('The Public Demonstration', 'The evening program scheduled a coil demonstration before the speeches. Its switch was shown to the whole reception, and the cabinet stood open afterward. Knowledge of it was common to all treaty guests.'),
    slip('An Unfinished Signature', 'Graves’s treaty pen rests above a blank signature line. He had not signed before the disturbance. The document may explain why the timing mattered even though it does not yet name a suspect.'),
    slip('A Loop of Burned Ribbon', 'The medallion’s ribbon is singed only where the conductive clasp touches brass. The focused damage supports a direct induction-coil contact rather than an explosion affecting the entire room.'),
    slip('The Vault Alarm Sequence', 'The core cradle recorded removal after the office surge and the blank shot. The crime involved a killing followed by a theft; the missing core did not vanish before the mayor entered his office.'),
    slip('An Unreliable Chorus', 'Several guests remember the shot with confidence, but the saloon’s darkened clocks disagree with casual estimates. Distinguish a remembered sound from an independent record of where its listener stood.'),
  ];
  if (round === 1) return first;
  const second = [
    slip('The Auction Header', 'The escrow header reads BLACK STAR — LIVING ASTERIAN CORE. It seeks a buyer for an intact power source. This was a planned commercial theft, not merely damage inflicted in anger.'),
    slip('Payment After Possession', 'The buyer’s terms release payment only when the seller proves possession of the core. Killing Graves alone would not earn a cent; the plan required removing the power source from its cradle.'),
    slip('The Custody Clause', 'The treaty’s last clause gives joint custody of the core to a human–Asterian commission and prohibits private sale. Graves’s signature would have closed the seller’s simplest route to a fortune.'),
    slip('An Earlier Offer', 'The sale offer was transmitted at 8:47, before the 8:56 blackout. The theft was not an improvised response to a death; someone had arranged a market for the core in advance.'),
    slip('The Damaged Seal Strip', 'The auction message contains a partially obscured entry-seal strip. Its surviving marks match the guest-registration format. Recovering the original can connect the alias to a person without guessing from occupation.'),
    slip('A Map for Everyone', 'A gallery plan was printed on every guest program. The route links breaker, office and vault in a short walk. Knowing the route does not distinguish a local resident from a newly arrived delegate.'),
    slip('The Universal Switch', 'The demonstration notes translate the coil’s single control into both human and Asterian symbols. The important questions are who used it and when, rather than who sounds clever enough to understand it.'),
    slip('The Buyer’s Condition', 'The auction buyer insists that the core remain alive and the joint-custody agreement remain unsigned. A damaged power source would void the sale. The plan was extraction for profit, not destruction of alien technology.'),
    slip('A Polite Cover Story', 'The public schedule describes the mayor’s office interval as a final review of the custody clause. An attacker could approach with a plausible treaty question; no appointment reserved the gallery to one named guest.'),
    slip('The Open Vestibule', 'For the ceremony, the core-vault vestibule admitted every registered guest. The inner cradle kept a live-contact audit. Opportunity was broad, but the removal record should be much more specific.'),
    slip('No Secret Tunnel Needed', 'The service-stair door opens directly to the rear gallery. The mapped route takes less than three minutes at an ordinary walk. Inventing a hidden tunnel would add an assumption without explaining any new evidence.'),
    slip('The Late Delivery', 'The off-world buyer planned to collect after nine outside the town limits. The containment field interrupted that schedule. The core therefore remains inside Dustfall even if the seller pretends the sale is already complete.'),
    slip('An Alias Is Not a Species', 'Black Star is a seller name typed into an escrow form. The form accepts any registered guest. Its dramatic wording does not prove that its author is alien, human, military or a professional gambler.'),
    slip('The Signed Original', 'A duplicate escrow header survives locally, while the original seal strip is stored with the admission audit. Comparing independent copies can reveal alteration that a single loose sheet would conceal.'),
    slip('Treaty Before Profit', 'The final custody clause takes effect on signing, with no later grace period for private traders. That explains the attack before the pen reached the signature line and the hurry to take the core afterward.'),
    slip('A Cradle with Memory', 'The power cradle records a living hand pattern as well as an entry seal. A borrowed badge might open the vestibule, but it cannot account for the inner removal record. Wait for the full audit before judging an owner.'),
    slip('The Redundant Lantern', 'The recorder manual confirms that its battery lights a short exposure even when the main breaker is down. The blackout explains why the audience saw nothing; it does not erase the separate gallery record.'),
    slip('A Sale, Not a Water Deed', 'The escrow’s item description gives the core’s serial and energy state. No parcel of ranch land or water rights appears in its payment conditions. Other disputes may be real without being the purpose of this crime.'),
    slip('Words Nobody Signed', 'The treaty remains unsigned by Graves, so its core-custody restrictions have not begun. Someone turned that legal pause into a commercial opportunity. An argument over the treaty is suggestive; the sale offer is concrete.'),
    slip('A Person Behind the Plan', 'The method, route and auction could all be carried out by one admitted guest. None of them yet establishes which guest. The missing identity must come from the repaired recorder and signed registry, not the loudest rumor.'),
  ];
  if (round === 2) return second;
  const third = [
    slip('A Color Without a Face', `The gallery’s first exposure preserves ${seal.color} on a seal band at the breaker. Its face and motif are obscured. Five public entry seals share that color, so this fragment narrows the field without supplying a name.`),
    slip('A Motif Without Pigment', `The live core-removal audit preserves the ${seal.symbol} motif but loses the seal’s pigment. Four public seals share that motif. Pair it with an independently observed attribute before accusing its registered wearer.`),
    slip('The Fatal Interval', 'The restored office exposure is timed at 8:57, when the contact clock fused. It shows a portable induction coil crossing the doorway. The 8:58 blank shot cannot be the earlier cause of the electrical injury.'),
    slip('The Cradle’s Living Check', 'The inner cradle requires living admission verification. A borrowed or copied decorative badge cannot produce that match. This makes the seal evidence a trace of personal action rather than mere possession of a loose prop.'),
    slip('Read the Whole Registry', 'The public registry lists one unique color-and-motif pair per character. Several entries share each separate attribute. Find the intersection of the two recovered fragments, including profiles outside the active party if you need to check uniqueness.'),
    slip('The Second Color Frame', `The office-bound figure’s band again reads ${seal.color}. The camera cannot recover a face or a motif. The matching live trace connects this frame to the earlier breaker action rather than to an unrelated guest passing through.`),
    slip('The Sale’s Motif', `The Black Star original carries the ${seal.symbol} motif. Its live signature matches the core cradle’s 8:59 removal record, while its color is unreadable. The offer supplies planned profit and one partial identity attribute.`),
    slip('A Short, Ordinary Walk', 'The breaker, office and vault connect along one open gallery. The recorded sequence fits the available three-minute route. A secret tunnel or a second attacker would add assumptions without explaining a missing observation.'),
    slip('The Lantern’s Separate Supply', 'The recorder’s battery was installed before the reception. It lights short exposures independently of the main breaker, explaining how a visible seal trace survived a blackout that hid the route from the ballroom.'),
    slip('The Auction Came First', 'The escrow is stamped 8:47, nine minutes before the breaker fell. The seller had already sought a buyer for the living core. That order distinguishes a planned theft for profit from a spontaneous reaction to the mayor’s death.'),
    slip('What a Color Cannot Prove', `A ${seal.color} seal band is evidence of an attribute, not a complete identity. Check the independent motif trace and the public mapping. Do not replace the missing half with a guess based on species, costume accent or occupation.`),
    slip('What a Motif Cannot Prove', `The ${seal.symbol} motif appears on four different public entries. It becomes identifying only when intersected with the separate color record. Similar badges do not imply a conspiracy among their registered wearers.`),
    slip('A Continuous Live Trace', 'The gallery checkpoints and cradle audit share one uninterrupted live admission signature through the crime interval. Its human-readable name is damaged. Its separate surviving visual fragments can still be compared to the public seal registry.'),
    slip('Objects Before Stories', 'The fused medallion, missing coil and blank wadding do not depend on anyone’s alibi. Establish the electrical method and delayed shot first, then use the independent seal fragments to test which account fits the observed route.'),
    slip('The Unsigned Barrier', 'The last treaty clause would prohibit all private core sales immediately on signing. The pen never reached that line. That legal window explains why the attack preceded the theft rather than following a failed attempt to sell an already protected core.'),
    slip('A Sale That Could Not Finish', 'The core left its cradle at 8:59 and the containment field closed at 9:00. The off-world buyer cannot approach a sealed town. Whoever arranged the theft still has a reason to distract the investigation while the core remains inside Dustfall.'),
    slip('Why a Secret Is Not an Audit', 'An embarrassing private history may explain a guest’s nervousness. It does not supply a color, a motif or a live removal record. Ask which part of the observed crime chain a personal confession actually establishes.'),
    slip('The Receiver Copy', 'The off-town escrow copy was saved before the blackout. Its surviving live-signature check agrees with the local original. This corroboration limits a theory that someone added a convenient seller mark to a loose page after the crime.'),
    slip('The Two-Column Test', 'Make two candidate lists from the public entry seals: one for the camera’s surviving attribute and one for the cradle’s. Keep only profiles present in both lists. Then connect that deduction to the coil timing and planned sale.'),
    slip('An Accusation with Reasons', 'A complete argument needs method, motive and identity. Explain the induction coil, delayed blank and Black Star bargain, then show how two independently preserved seal attributes narrow several candidates to one registered character.'),
  ];
  if (round === 3) return third;
  if (round === 4) return first.map((clue, index) => ({
    title: `Timeline Review · ${clue.title}`,
    text: `${clue.text} ${[
      `The gallery’s ${seal.color} band supplies one attribute to compare with the separate cradle motif.`,
      `The cradle’s ${seal.symbol} motif supplies one attribute to compare with the separate gallery color.`,
      'The independent clocks place the breaker at 8:56, lethal coil interval at 8:57 and delayed blank at 8:58.',
      'The live audit continues to the 8:59 core removal; distinguish what the object proves from what a seal intersection establishes.',
    ][index % 4]}`,
  }));
  return second.map((clue, index) => ({
    title: `Closing Argument · ${clue.title}`,
    text: `${clue.text} ${[
      `The closing gallery reading confirms ${seal.color}, with the motif obscured; compare it to the independent audit fragment.`,
      `The original sale strip confirms the ${seal.symbol} motif, with its color unreadable; compare it to the independent gallery fragment.`,
      'Use the offer to establish motive and the timed records to establish action; one partial seal alone is not a name.',
      'Test a final accusation against both public seal attributes and the continuous live signature, rather than a private scandal.',
    ][index % 4]}`,
  }));
}

export function makeClue(round: number, index: number, culpritCharacterId: string, rosterCharacterIds: string[]): ClueText {
  checkRound(round);
  if (!Number.isInteger(index) || index < 0) throw new Error('Clue index must be a nonnegative integer.');
  const culprit = requireCharacter(culpritCharacterId);
  rosterCharacterIds.forEach(requireCharacter);
  // No clue relies on another role being present. Twenty slips cover the largest legal party.
  return { ...clueBank(round, culprit)[index % 20] };
}

export function searchClue(round: number, locationId: string, culpritCharacterId: string): ClueText {
  checkRound(round);
  const culprit = requireCharacter(culpritCharacterId);
  const locationIndex = LOCATIONS[round - 1].findIndex(location => location.id === locationId);
  if (locationIndex < 0) throw new Error('Unknown search location for this story round.');
  const seal = entrySeal(culprit.id);
  const searches: ClueText[][] = [
    [
      slip('The Fused Medallion', 'Inside the mayor’s office, the medallion’s back shows a branching electrical contact burn. There is no bullet wound. Copper whiskers on the desk match the torn braid of the missing portable induction coil.'),
      slip('A Box of Blanks', 'Behind the stage curtain is a box of theatrical blanks matching the spent cartridge beside Graves. The mechanical cue roll marks a report at 8:58, after the office contact clock stopped at 8:57. The shot was a delayed distraction.'),
      slip('A Battery in the Dark', 'The rear-gallery recorder still has a warm battery lantern and a counter showing three exposures. Its tape is jammed, not burned. The lowered breaker darkened the ballroom but did not stop this independent camera.'),
    ],
    [
      slip('The Unsigned Custody Clause', 'The treaty table holds Graves’s final clause: joint human–Asterian custody of the core, with all private sale forbidden immediately on signing. His empty signature line preserves the very opportunity a private seller would need.'),
      slip('The Black Star Escrow', 'The relay has a sealed 8:47 sale offer for a living Asterian core. Payment waits on possession and an unsigned treaty. The seller uses Black Star, with a damaged seal strip that must be compared against the admission original.'),
      slip('The Short Walk', 'From the service stairs, the open rear gallery reaches the breaker, office and core-vault vestibule in under three minutes. Every guest received this route on a program. The inner cradle records live contact, so its audit may narrow who actually removed the core.'),
    ],
    [
      slip('The Gallery Color Layer', `The restored camera preserves ${seal.color} on the moving seal band, but no readable face or motif. The continuous live trace follows the breaker at 8:56, coil-bearing office approach at 8:57 and vault passage after the delayed blank. Compare this partial attribute to a separate record.`),
      slip('How the Public Registry Works', 'The admission registry gives each guest one unique color-and-motif pair. A separate attribute fits several entries, so neither camera nor cradle fragment is enough alone. Intersect the public badge labels; portrait accent colors and species are not substitute evidence.'),
      slip('The Cradle Motif Layer', `The 8:59 live-contact core audit preserves the ${seal.symbol} motif, while its pigment is unreadable. The same signature appears on the earlier Black Star escrow and the continuous gallery trace. Compare this independent fragment to the camera’s color before choosing a name.`),
    ],
    [
      slip('The Clock Comparison', 'At the clockwork bench, the breaker log, stopped office contact and mechanical stage cue agree: 8:56 darkness, 8:57 electrical strike, 8:58 blank shot. The three-minute walk reaches the vault at 8:59 without requiring a second attacker.'),
      slip('A Color on the Contact Image', `An enlarged gallery contact image again preserves a ${seal.color} band near the coil case. The motif remains obscured. The cabinet’s physical objects establish an electrical death before the shot; the identity still requires the independent cradle attribute.`),
      slip('The Off-Town Motif Copy', `The escrow cache contains a receiver copy saved outside Dustfall before the field closed. It preserves the ${seal.symbol} motif without pigment and a live-signature match to the original core-removal audit. Combine it with the separate camera fragment rather than guessing from the alias.`),
    ],
    [
      slip('The Two-Column Case Board', 'The case board calls for two candidate lists, one per surviving seal attribute. Their intersection identifies a public profile, while the continuous audit links that seal to the coil interval and core removal. Keep method, motive and identity as separate steps in your argument.'),
      slip('The Buyer Turns Away', 'The landing beacon logs the buyer’s canceled approach: the containment field is still closed. The core remains inside Dustfall. The field was triggered by removal from the cradle, so it explains the interrupted escape rather than the earlier killing.'),
      slip('A Motif and a Commercial Plan', `The archived offer preserves ${seal.symbol} on the seller’s seal strip, but its pigment and name are lost. Its live signature matches the removed core. The treaty would forbid private sale once signed; compare the separate gallery color to finish the identity argument.`),
    ],
  ];
  const clue = searches[round - 1][locationIndex];
  return { title: `${LOCATIONS[round - 1][locationIndex].label} · ${clue.title}`, text: clue.text };
}

export function solution(culpritCharacterId: string) {
  const culprit = requireCharacter(culpritCharacterId);
  return {
    headline: `${culprit.name} was Black Star.`,
    summary: `${culprit.name} killed Mayor Solomon Graves and stole the Asterian power core. The blackout hid the approach, the blank shot sold a false gun-murder story, and the missing core triggered the containment field. The signed entry registry, recovered gallery exposures and live-contact vault audit identify the same person behind the Black Star sale offer.`,
    method: 'A charged induction coil was pressed to Graves’s brass peace medallion at 8:57, delivering the lethal electrical strike. A theatrical revolver fired a blank at 8:58 to stage a shooting after the death. The killer then took the core through the connected rear gallery.',
    motive: 'Sell the living Asterian power core at a private off-world auction under the Black Star alias. Graves’s imminent treaty signature would have imposed joint custody and prohibited private sale, so the seller killed him before signing to preserve a window for theft and profit.',
    timeline: [
      { time: '8:40 PM', text: 'Graves circulates the final treaty clause: joint human–Asterian custody, with no private sale of the core.' },
      { time: '8:47 PM', text: `${culprit.name} registers the Black Star auction offer using the entry seal later recovered in the original escrow strip.` },
      { time: '8:56 PM', text: `${culprit.name} lowers the saloon breaker. The independently powered gallery camera continues recording.` },
      { time: '8:57 PM', text: `${culprit.name} enters Graves’s office with the induction coil and delivers the lethal strike through the brass peace medallion.` },
      { time: '8:58 PM', text: 'A theatrical revolver fires a blank. The staged shot draws attention to a false explanation of the death.' },
      { time: '8:59 PM', text: `${culprit.name} removes the living core. The vault records the registered seal and a matching live hand pattern.` },
      { time: '9:00 PM', text: 'The empty cradle triggers the containment field. Dustfall is sealed before the buyer can collect the stolen core.' },
      { time: 'Before the last bell', text: 'The repaired tape, signed registry and independent escrow copy expose Black Star. The core remains within the field, ready to be recovered and returned to joint custody.' },
    ],
  };
}
