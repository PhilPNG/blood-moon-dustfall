/** Server-only view translation. Always call AFTER the engine has filtered the viewer's data. */
import type { RoomView } from '../shared/types.js';
import type { Language } from '../shared/locale.js';
import english from './locales/en.json';
import spanish from './locales/es.json';
import portuguese from './locales/pt-BR.json';
import { ERROR_TRANSLATIONS, VALIDATION_LABELS } from './locales/errors.js';

const translations: Record<Exclude<Language, 'en'>, Record<string, string>> = { es: spanish, 'pt-BR': portuguese };
const attributes = {
  es: { Mint: 'Menta', Coral: 'Coral', Gold: 'Oro', Violet: 'Violeta', Cactus: 'Cactus', Comet: 'Cometa', Spur: 'Espuela', Sun: 'Sol', Eye: 'Ojo' },
  'pt-BR': { Mint: 'Menta', Coral: 'Coral', Gold: 'Ouro', Violet: 'Violeta', Cactus: 'Cacto', Comet: 'Cometa', Spur: 'Espora', Sun: 'Sol', Eye: 'Olho' },
} satisfies Record<Exclude<Language, 'en'>, Record<string, string>>;
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Most phone fields are complete literals. Keep interpolated/composed text on the strict matcher below.
const exactSources = new Map<string, string>();
for (const [index, source] of english.entries()) if (!source.includes('{{')) exactSources.set(source, String(index));
const templates = english.map((source, index) => {
  const keys: string[] = [];
  const parts = source.split(/(\{\{(?:color|symbol|name)\}\})/g);
  const pattern = parts.map(part => {
    const key = /^\{\{(color|symbol|name)\}\}$/.exec(part)?.[1];
    if (!key) return escaped(part);
    keys.push(key);
    return '(.+?)';
  }).join('');
  return { source, index: String(index), keys, expression: new RegExp(`^${pattern}`) };
}).sort((a, b) => b.source.length - a.source.length);

/** An unexpected exception must never echo private data, request values or infrastructure details. */
export const SAFE_ERROR_MESSAGE = 'The room could not respond. Please try again.';

export function localizeError(message: string, language: Language): string {
  const known = ERROR_TRANSLATIONS[message];
  if (known) return language === 'en' ? message : known[language];

  const validation = /^Invalid ([a-z ]+)\.$/.exec(message);
  if (validation && VALIDATION_LABELS[validation[1]]) return language === 'en' ? message : VALIDATION_LABELS[validation[1]][language];

  const phase = /^This action is only available during (lobby|roles|investigation|voting|results)\.$/.exec(message)?.[1];
  if (phase) {
    if (language === 'en') return message;
    const phases = {
      es: { lobby: 'la preparación de la sala', roles: 'el reparto de personajes', investigation: 'la investigación', voting: 'la votación', results: 'la revelación de resultados' },
      'pt-BR': { lobby: 'a preparação da sala', roles: 'a distribuição de personagens', investigation: 'a investigação', voting: 'a votação', results: 'a revelação dos resultados' },
    };
    const label = phases[language][phase as keyof typeof phases.es];
    return language === 'es' ? `Esta acción solo está disponible durante ${label}.` : `Esta ação só está disponível durante ${label}.`;
  }

  const gender = /^That character is a (man|woman)\. Choose a matching character or change the character gender preference to either\.$/.exec(message)?.[1];
  if (gender) {
    if (language === 'en') return message;
    if (language === 'es') return `Este personaje es ${gender === 'man' ? 'un hombre' : 'una mujer'}. Elige un personaje compatible o cambia la preferencia de género a «Cualquiera».`;
    return `Este personagem é ${gender === 'man' ? 'um homem' : 'uma mulher'}. Escolha um personagem compatível ou mude a preferência de gênero para “Tanto faz”.`;
  }

  const pool = /^Only (\d{1,3}) (men|women) characters are available\. Choose either or the other character gender\.$/.exec(message);
  if (pool) {
    if (language === 'en') return message;
    if (language === 'es') return `Solo hay ${pool[1]} personajes ${pool[2] === 'men' ? 'hombres' : 'mujeres'} disponibles. Elige «Cualquiera» o el otro género de personaje.`;
    return `Há apenas ${pool[1]} personagens ${pool[2] === 'men' ? 'homens' : 'mulheres'} disponíveis. Escolha “Tanto faz” ou o outro gênero de personagem.`;
  }

  const reserved = /^Reserved characters leave too few (men|women) for the current gender preferences\. Release a reservation or choose either\.$/.exec(message)?.[1];
  if (reserved) {
    if (language === 'en') return message;
    if (language === 'es') return `Las reservas dejan muy pocos personajes ${reserved === 'men' ? 'hombres' : 'mujeres'} para las preferencias actuales. Libera una reserva o elige «Cualquiera».`;
    return `As reservas deixam poucos personagens ${reserved === 'men' ? 'homens' : 'mulheres'} para as preferências atuais. Libere uma reserva ou escolha “Tanto faz”.`;
  }

  const setting = /^Invalid (rounds|roundSeconds|maxPlayers)\. Use a whole number from (\d{1,8}) to (\d{1,8})\.$/.exec(message);
  if (setting) {
    if (language === 'en') return message;
    const labels = { es: { rounds: 'El número de actos no es válido', roundSeconds: 'La duración de los actos no es válida', maxPlayers: 'El máximo de jugadores no es válido' }, 'pt-BR': { rounds: 'O número de atos é inválido', roundSeconds: 'A duração dos atos é inválida', maxPlayers: 'O máximo de jogadores é inválido' } };
    const label = labels[language][setting[1] as keyof typeof labels.es];
    return language === 'es' ? `${label}. Usa un número entero entre ${setting[2]} y ${setting[3]}.` : `${label}. Use um número inteiro de ${setting[2]} a ${setting[3]}.`;
  }

  return SAFE_ERROR_MESSAGE;
}

/** A strict catalog lookup makes missing translations observable in tests instead of silently using English. */
export function localizeStoryText(text: string, language: Language): string {
  if (language === 'en' || !text) return text;
  const dictionary = translations[language];
  const exactIndex = exactSources.get(text);
  if (exactIndex !== undefined) {
    const translated = dictionary[exactIndex];
    if (!translated) throw new Error(`Missing ${language} story translation ${exactIndex}.`);
    return translated;
  }
  for (const item of templates) {
    const match = item.expression.exec(text);
    if (!match) continue;
    // Only authored composition boundaries are legal: spaces between paragraphs, or title separators.
    const rest = text.slice(match[0].length);
    if (rest && !rest.startsWith(' ') && !rest.startsWith(' · ')) continue;
    let translated = dictionary[item.index];
    if (!translated) throw new Error(`Missing ${language} story translation ${item.index}.`);
    for (const [index, key] of item.keys.entries()) {
      const raw = match[index + 1];
      const value = key === 'name' ? raw : (attributes[language] as Record<string, string>)[raw];
      if (!value) throw new Error(`Unknown ${key} in ${language} story translation.`);
      translated = translated.replace(`{{${key}}}`, value);
    }
    if (!rest) return translated;
    if (rest.startsWith(' · ')) return `${translated} · ${localizeStoryText(rest.slice(3), language)}`;
    return `${translated} ${localizeStoryText(rest.trimStart(), language)}`;
  }
  throw new Error(`Untranslated ${language} story content: ${text.slice(0, 100)}`);
}

/** Catalog diagnostics are server-only; they must never be serialized into a room response. */
export function storyLocalizationCoverage(language: Exclude<Language, 'en'>) {
  const dictionary = translations[language];
  return {
    total: english.length,
    translated: english.filter((source, index) => typeof dictionary[String(index)] === 'string' && dictionary[String(index)] !== source && dictionary[String(index)].trim().length > 0).length,
    missing: english.flatMap((source, index) => !dictionary[String(index)] ? [{ index, source }] : []),
    unchanged: english.flatMap((source, index) => dictionary[String(index)] === source ? [{ index, source }] : []),
    invalidPlaceholders: english.flatMap((source, index) => {
      const placeholders = (value: string) => [...value.matchAll(/\{\{\w+\}\}/g)].map(match => match[0]).sort().join(',');
      return placeholders(source) === placeholders(dictionary[String(index)] ?? '') ? [] : [index];
    }),
  };
}

export function localizeRoomView(view: RoomView, language: Language): RoomView {
  // Copy the filtered view only. This module never reads a RoomSnapshot, dossier bank or culprit selection.
  const localized = structuredClone(view);
  if (language === 'en') return localized;
  const t = (value: string) => localizeStoryText(value, language);
  const clue = <T extends { title: string; text: string }>(item: T): T => ({ ...item, title: t(item.title), text: t(item.text) });
  if (localized.notice) localized.notice = t(localized.notice);
  localized.clues = localized.clues.map(clue);
  if (localized.me) {
    localized.me.clues = localized.me.clues.map(clue);
    if (localized.me.search) localized.me.search = clue(localized.me.search);
    if (localized.me.previousAnswer) localized.me.previousAnswer.text = t(localized.me.previousAnswer.text);
    const role = localized.me.role;
    if (role) {
      role.brief = t(role.brief);
      role.objective = t(role.objective);
      for (const field of ['background', 'secret', 'alibi', 'roleplayTip'] as const) if (role[field]) role[field] = t(role[field]);
      if (role.objectives) role.objectives = role.objectives.map(t);
      if (role.relationships) role.relationships = role.relationships.map(relationship => ({ ...relationship, detail: t(relationship.detail) }));
    }
  }
  if (localized.act) {
    const act = localized.act;
    act.title = t(act.title); act.narration = t(act.narration); act.prompt = t(act.prompt);
    act.evidence = act.evidence.map(clue);
    act.locations = act.locations.map(location => ({ ...location, label: t(location.label), description: t(location.description) }));
    act.question.prompt = t(act.question.prompt);
    act.question.options = act.question.options.map(option => ({ ...option, text: t(option.text) }));
  }
  if (localized.questionResult) localized.questionResult.explanation = t(localized.questionResult.explanation);
  if (localized.result?.solution) {
    const solution = localized.result.solution;
    solution.headline = t(solution.headline); solution.summary = t(solution.summary);
    solution.method = t(solution.method); solution.motive = t(solution.motive);
    solution.timeline = solution.timeline.map(entry => ({ time: /\d/.test(entry.time) ? entry.time : t(entry.time), text: t(entry.text) }));
  }
  return localized;
}
