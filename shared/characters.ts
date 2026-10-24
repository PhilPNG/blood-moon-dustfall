/** Public cast only. Safe to import in the browser, gallery and printable party kit. */
export interface CharacterProfile {
  id: string;
  name: string;
  gender: 'man' | 'woman';
  title: string;
  faction: string;
  bio: string;
  personality: string;
  costume: string;
  color: string;
  portrait: string;
}

export const CHARACTERS: CharacterProfile[] = [
  {
    id: 'silas-vale', name: 'Marshal Silas Vale', gender: 'man', title: 'The Weathered Marshal', faction: 'Dustfall · Law',
    bio: 'Silas kept Dustfall alive through cattle wars and a sky that suddenly fell to earth. Tonight he has checked every weapon at the Eclipse Saloon door and promised that the peace will hold until morning.',
    personality: 'Patient, dryly funny and difficult to impress; he treats a promise like a loaded weapon.',
    costume: 'A plum or brown duster, battered hat, silver mustache and a brass star pinned over the heart.',
    color: '#E7B959', portrait: '/assets/characters/silas-vale.webp',
  },
  {
    id: 'jed-rattler', name: 'Jed Rattler', gender: 'man', title: 'The Borderland Courier', faction: 'Dustfall · Outriders',
    bio: 'Jed can cross a hundred miles of bad country with a message nobody else will carry. A pardon brought him to the treaty, although the marshal still counts the silverware whenever Jed smiles.',
    personality: 'Restless, charming and quick with a joke when a conversation gets too close to home.',
    costume: 'A sand-colored hat, red bandana, worn boots and a messenger satchel full of folded maps.',
    color: '#FF8A59', portrait: '/assets/characters/jed-rattler.webp',
  },
  {
    id: 'elias-thorne', name: 'Elias Thorne', gender: 'man', title: 'The Town Undertaker', faction: 'Dustfall · Undertaking',
    bio: 'Elias measures coffins, repairs musical boxes and remembers every name in the cemetery. He has come to the Eclipse to discuss dignified funeral customs with visitors who may live for centuries.',
    personality: 'Soft-spoken, exacting and unexpectedly tender; his darkest observations arrive politely.',
    costume: 'A long black coat, silver spectacles, violet flower and a small notebook tied with ribbon.',
    color: '#B8A1F5', portrait: '/assets/characters/elias-thorne.webp',
  },
  {
    id: 'gabriel-flint', name: 'Reverend Gabriel Flint', gender: 'man', title: 'The Frontier Preacher', faction: 'Dustfall · Chapel',
    bio: 'Gabriel turned a freight shed into a chapel that welcomes strangers from any horizon. He will bless the treaty tonight, provided somebody can agree which way an alien congregation should face.',
    personality: 'Warm, theatrical and stubborn about second chances; he listens before delivering a sermon.',
    costume: 'A midnight coat, ivory clerical collar, gold sun pin and a dog-eared book with blank pages.',
    color: '#F3D780', portrait: '/assets/characters/gabriel-flint.webp',
  },
  {
    id: 'augustus-pike', name: 'Augustus Pike', gender: 'man', title: 'The Railroad Magnate', faction: 'Dustfall · Iron Meridian Rail',
    bio: 'Augustus brought rails to Dustfall and expects the town to remember the expense. He calls the treaty a golden opportunity and has already drafted a speech about tracks reaching all the way to the stars.',
    personality: 'Expansive, calculating and allergic to being ignored; every compliment sounds like an offer.',
    costume: 'A burgundy waistcoat, gold watch chain, silver sideburns and a rolled-up railway prospectus.',
    color: '#D89A64', portrait: '/assets/characters/augustus-pike.webp',
  },
  {
    id: 'tobias-wren', name: 'Tobias Wren', gender: 'man', title: 'The Telegraph Prodigy', faction: 'Dustfall · Telegraph Office',
    bio: 'Tobias can hear a loose contact in a storm of telegraph clicks. Since the crash, he has been trying to teach a machine from another world to say hello without setting the curtains on fire.',
    personality: 'Earnest, curious and prone to explaining his feelings as if they were circuit diagrams.',
    costume: 'Round spectacles, rolled teal sleeves, suspenders and a copper headset or telegraph key.',
    color: '#6CE3D0', portrait: '/assets/characters/tobias-wren.webp',
  },
  {
    id: 'finch-mercer', name: 'Finch Mercer', gender: 'man', title: 'The Velvet Cardsharp', faction: 'Dustfall · The Tables',
    bio: 'Finch has never lost a card game he will admit to remembering. He arrived for the Eclipse tournament and stayed for the treaty, where the stakes appear considerably higher than a pot of silver dollars.',
    personality: 'Elegant, amused and relentlessly observant; he prefers a raised eyebrow to a raised voice.',
    costume: 'A violet waistcoat, polished boots, narrow tie and a deck of cards with one conspicuous joker.',
    color: '#DCA0E8', portrait: '/assets/characters/finch-mercer.webp',
  },
  {
    id: 'orion-vex', name: 'Ambassador Orion Vex', gender: 'man', title: 'The Celestial Diplomat', faction: 'Asterian · Delegation',
    bio: 'Orion speaks for the stranded Asterian delegation with immaculate courtesy and a translator that dislikes frontier slang. He believes tonight can turn an accidental landing into a lasting alliance.',
    personality: 'Formal, diplomatic and quietly mischievous; he collects local sayings with alarming precision.',
    costume: 'Blue face paint or accessories, a gold-trimmed violet frock coat and a silver swept-back crest.',
    color: '#79B8FF', portrait: '/assets/characters/orion-vex.webp',
  },
  {
    id: 'keth-solaris', name: 'Keth Solaris', gender: 'man', title: 'The Starship Engineer', faction: 'Asterian · Engineering',
    bio: 'Keth has spent six weeks coaxing a broken starship to breathe again. He attends the treaty with tools still in his pockets and a sincere interest in whatever humans mean by a reliable steam engine.',
    personality: 'Blunt, practical and affectionate toward machines; he gives useful advice at inconvenient times.',
    costume: 'Copper accents or scales, amber lenses, a canvas work coat and a mint-lit imitation tool harness.',
    color: '#E9A45F', portrait: '/assets/characters/keth-solaris.webp',
  },
  {
    id: 'rowan-quill', name: 'Rowan Quill', gender: 'man', title: 'The Extraterrestrial Botanist', faction: 'Asterian · Life Sciences',
    bio: 'Rowan finds Earth magnificent, particularly its cacti and alarming habit of putting fruit in pie. His botanical exchange is the treaty’s gentlest promise: food that can thrive in Dustfall’s exhausted soil.',
    personality: 'Dreamy, attentive and unexpectedly tenacious; he asks plants for opinions before people.',
    costume: 'Sage-green accessories, leaflike temple fronds, an ochre poncho and a sealed specimen vial.',
    color: '#A5D58E', portrait: '/assets/characters/rowan-quill.webp',
  },
  {
    id: 'ada-crowe', name: 'Ada Crowe', gender: 'woman', title: 'The Eclipse Proprietor', faction: 'Dustfall · Eclipse Saloon',
    bio: 'Ada built the Eclipse from a leaky gambling room into the one place everyone in Dustfall will enter. Her hospitality hosts the treaty tonight, and she expects humans and aliens alike to mind her furniture.',
    personality: 'Commanding, generous and fluent in pointed silence; she notices who pays and who pretends.',
    costume: 'A violet velvet jacket, high curls, a ring of gold keys and a polished glass carried like a scepter.',
    color: '#D68AFF', portrait: '/assets/characters/ada-crowe.webp',
  },
  {
    id: 'beatrice-bell', name: 'Dr. Beatrice Bell', gender: 'woman', title: 'The Frontier Physician', faction: 'Dustfall · Infirmary',
    bio: 'Beatrice has patched ranch hands, rail crews and one very embarrassed Asterian pilot. The treaty may bring her a proper clinic; for now, she is prepared to treat either species with the same steady hands.',
    personality: 'Direct, compassionate and impatient with drama that delays actual care.',
    costume: 'A teal riding coat, neatly braided hair, a medical satchel and clean gloves tucked into a belt.',
    color: '#71DDD1', portrait: '/assets/characters/beatrice-bell.webp',
  },
  {
    id: 'cassidy-blaze', name: 'Cassidy Blaze', gender: 'woman', title: 'The Cinder Rancher', faction: 'Dustfall · Ranchlands',
    bio: 'Cassidy’s cattle were the first creatures in Dustfall to meet the crashed starship. She came to the treaty to protect the grazing lands and to discover whether alien horses are as sensible as her own.',
    personality: 'Fearless, plainspoken and fiercely loyal; she sizes up a boast the way she sizes up a fence.',
    costume: 'An ochre hat, dark braid, red-orange vest, sturdy boots and a rope loop worn safely at the hip.',
    color: '#FFAE54', portrait: '/assets/characters/cassidy-blaze.webp',
  },
  {
    id: 'delphine-dusk', name: 'Delphine Dusk', gender: 'woman', title: 'The Midnight Illusionist', faction: 'Dustfall · Traveling Stage',
    bio: 'Delphine can make a silver dollar disappear beneath a suspicious marshal’s nose. Her Halloween performance opens the peace celebration, a professional challenge when half the audience owns real technology that floats.',
    personality: 'Playful, poised and sharply protective of her craft; she makes an entrance even when leaving.',
    costume: 'A pink-violet tailcoat, glossy bob or sleek hat, silver gloves and a harmless ribbon trick.',
    color: '#FF84C0', portrait: '/assets/characters/delphine-dusk.webp',
  },
  {
    id: 'evelyn-sterling', name: 'Evelyn Sterling', gender: 'woman', title: 'The Ink-Stained Reporter', faction: 'Dustfall · Gazette',
    bio: 'Evelyn follows a story until the ink runs out, then borrows another pen. Tonight’s treaty could make her Gazette famous beyond the territory, if she can obtain one honest quote before the speeches begin.',
    personality: 'Bright, skeptical and wonderfully persistent; a casual question usually has three follow-ups.',
    costume: 'A mint blouse, auburn updo, rolled sleeves, pocket notebook and a box camera or press badge.',
    color: '#A0E8C0', portrait: '/assets/characters/evelyn-sterling.webp',
  },
  {
    id: 'florence-rook', name: 'Florence Rook', gender: 'woman', title: 'The Meteor Assayer', faction: 'Dustfall · Assay Office',
    bio: 'Florence can tell fool’s gold from a fortune by lamplight. Meteor fragments have made her assay office the busiest room in town, and she has agreed to certify the treaty’s exchange of unusual minerals.',
    personality: 'Measured, wry and delighted by a difficult problem; she trusts a scale more readily than a speech.',
    costume: 'A steel-gray braid, amber goggles, indigo apron and a clearly artificial glowing ore sample.',
    color: '#D7BC6A', portrait: '/assets/characters/florence-rook.webp',
  },
  {
    id: 'marigold-shaw', name: 'Marigold Shaw', gender: 'woman', title: 'The Rail Yard Mechanic', faction: 'Dustfall · Rail Workers',
    bio: 'Marigold keeps the Iron Meridian locomotives running despite a budget of promises and spare bolts. She came to the Eclipse for a fair labor clause and a look at machinery that has never heard of coal.',
    personality: 'Inventive, irreverent and warmhearted; she challenges nonsense by asking exactly how it works.',
    costume: 'Patched teal overalls, short curls, yellow neckerchief and a lightweight brass-colored wrench.',
    color: '#F9D16B', portrait: '/assets/characters/marigold-shaw.webp',
  },
  {
    id: 'lyra-nine', name: 'Captain Lyra Nine', gender: 'woman', title: 'The Fallen-Star Navigator', faction: 'Asterian · Flight Crew',
    bio: 'Lyra guided the Asterian ship through a storm no chart predicted. Grounded but unbowed, she has drawn a new map of the heavens above Dustfall and intends to carry news of tonight’s peace back to them.',
    personality: 'Disciplined, adventurous and quietly competitive; she turns uncertainty into a navigational problem.',
    costume: 'Lavender accents, luminous cheek markings and a white-and-gold flight duster with a compass.',
    color: '#C4A4FF', portrait: '/assets/characters/lyra-nine.webp',
  },
  {
    id: 'nyx-ash', name: 'Nyx Ash', gender: 'woman', title: 'The Treaty Sentinel', faction: 'Asterian · Security',
    bio: 'Nyx guards the delegation with a soldier’s stillness and a visitor’s fascination with wanted posters. She helped design the treaty’s safety arrangements and has no intention of becoming the town’s next cautionary tale.',
    personality: 'Watchful, laconic and fiercely principled; her rare jokes land with the accuracy of a warning shot.',
    costume: 'Orange accents, small swept horns, charcoal Western armor and a pink imitation visor.',
    color: '#FF986D', portrait: '/assets/characters/nyx-ash.webp',
  },
  {
    id: 'sera-lumen', name: 'Sera Lumen', gender: 'woman', title: 'The Memory Archivist', faction: 'Asterian · Living Archive',
    bio: 'Sera preserves songs, agreements and the small things civilizations forget to write down. She will record the treaty in a crystal archive, though she suspects the saloon’s piano deserves a record of its own.',
    personality: 'Serene, perceptive and amused by contradictions; she repeats an exact phrase when others wish she would not.',
    costume: 'Turquoise accents, flowing silver hair, a violet shawl and a gold-colored memory prism.',
    color: '#7DE4ED', portrait: '/assets/characters/sera-lumen.webp',
  },
];

export function characterById(id: string): CharacterProfile | undefined {
  return CHARACTERS.find(character => character.id === id);
}

/** Public admission-badge attributes; colors and motifs intersect to identify one guest. */
export function entrySeal(characterId: string): { color: string; symbol: string; label: string } {
  const index = CHARACTERS.findIndex(character => character.id === characterId);
  if (index < 0) throw new Error(`Unknown character: ${characterId}`);
  const color = ['Mint', 'Coral', 'Gold', 'Violet'][index % 4];
  const symbol = ['Cactus', 'Comet', 'Spur', 'Sun', 'Eye'][Math.floor(index / 4)];
  return { color, symbol, label: `${color} ${symbol}` };
}
