import type { Language } from '../shared/locale';
const copy = {
  en: { title: 'Watch the mystery', description: 'Follow the public evidence and live captions. No character, secrets or voting seat required.', open: 'Open audience view', link: 'Just watching? Follow the public screen', invite: 'Spectator link', copy: 'Copy spectator link', home: 'Join the audience', note: 'Spectators follow the public story without taking a player seat.' },
  es: { title: 'Sigue el misterio', description: 'Sigue las pruebas públicas y los subtítulos en directo. Sin personaje, secretos ni plaza para votar.', open: 'Abrir vista del público', link: '¿Solo miras? Sigue la pantalla pública', invite: 'Enlace para el público', copy: 'Copiar enlace del público', home: 'Unirse al público', note: 'El público sigue la historia sin ocupar una plaza de jugador.' },
  'pt-BR': { title: 'Acompanhe o mistério', description: 'Acompanhe as evidências públicas e as legendas ao vivo. Sem personagem, segredos ou vaga para votar.', open: 'Abrir visão da plateia', link: 'Só assistindo? Acompanhe a tela pública', invite: 'Link da plateia', copy: 'Copiar link da plateia', home: 'Entrar na plateia', note: 'A plateia acompanha a história pública sem ocupar uma vaga de jogador.' },
} satisfies Record<Language, Record<string, string>>;
export function watchCopy(language: Language) { return copy[language]; }
