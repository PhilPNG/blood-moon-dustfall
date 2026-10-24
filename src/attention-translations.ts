import type { Language } from '../shared/locale';

type AttentionCopy = {
  label: string;
  phoneTitle: string;
  hostTitle: string;
  masterTitle: string;
  instruction: string;
  masterInstruction: string;
  seconds: string;
  synced: string;
  paused: string;
  reconnecting: string;
  cues: Record<'phase' | 'clue' | 'timer-warning' | 'lobby', string>;
};

export const attentionTranslations: Record<Language, AttentionCopy> = {
  en: {
    label: 'Shared-screen moment',
    phoneTitle: 'Eyes on the big screen',
    hostTitle: 'All eyes on Dustfall',
    masterTitle: 'Gather the table',
    instruction: 'Look up — the next moment is about to begin.',
    masterInstruction: 'Give everyone a moment to look up. Your controls stay available.',
    seconds: 'seconds',
    synced: 'Synced with the room',
    paused: 'Countdown paused',
    reconnecting: 'Reconnecting to the room',
    cues: { phase: 'Next chapter', clue: 'New public evidence', 'timer-warning': 'Host announcement', lobby: 'Welcome to Dustfall' },
  },
  es: {
    label: 'Momento en la pantalla compartida',
    phoneTitle: 'Miren la pantalla grande',
    hostTitle: 'Todas las miradas en Dustfall',
    masterTitle: 'Reúnan al grupo',
    instruction: 'Levanten la mirada — el próximo momento está por comenzar.',
    masterInstruction: 'Denles un momento para mirar la pantalla. Los controles siguen disponibles.',
    seconds: 'segundos',
    synced: 'Sincronizados con la sala',
    paused: 'Cuenta regresiva en pausa',
    reconnecting: 'Reconectando con la sala',
    cues: { phase: 'Próximo capítulo', clue: 'Nueva prueba pública', 'timer-warning': 'Anuncio del anfitrión', lobby: 'Bienvenidos a Dustfall' },
  },
  'pt-BR': {
    label: 'Momento na tela compartilhada',
    phoneTitle: 'Olhem para a tela grande',
    hostTitle: 'Todos de olho em Dustfall',
    masterTitle: 'Reúnam a turma',
    instruction: 'Levantem os olhos — o próximo momento está prestes a começar.',
    masterInstruction: 'Dê um momento para todos olharem para a tela. Seus controles continuam disponíveis.',
    seconds: 'segundos',
    synced: 'Em sincronia com a sala',
    paused: 'Contagem pausada',
    reconnecting: 'Reconectando à sala',
    cues: { phase: 'Próximo capítulo', clue: 'Nova evidência pública', 'timer-warning': 'Anúncio do anfitrião', lobby: 'Boas-vindas a Dustfall' },
  },
};
