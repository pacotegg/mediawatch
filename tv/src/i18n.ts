import { ajustes } from './ajustes.ts';

export type Idioma = 'en' | 'es';

export const TEXTOS = {
  en: {
    home: 'Home',
    search: 'Search',
    settings: 'Settings',
    play: 'Play',
    resume: 'Resume',
    details: 'Details',
    audio: 'Audio',
    subtitles: 'Subtitles',
    offset: 'Offset',
    language: 'Language',
    menuOrder: 'Customize menu',
    nightMode: 'Night mode',
    clearVoice: 'Clear voice',
    normalAudio: 'Original',
    endsAt: 'Ends at',
    continueWatching: 'Continue watching',
    featured: 'Featured',
    recentlyAdded: 'Recently added',
  },
  es: {
    home: 'Inicio',
    search: 'Buscar',
    settings: 'Ajustes',
    play: 'Reproducir',
    resume: 'Reanudar',
    details: 'Ficha',
    audio: 'Audio',
    subtitles: 'Subtítulos',
    offset: 'Desfase',
    language: 'Idioma',
    menuOrder: 'Personalizar menú',
    nightMode: 'Modo noche',
    clearVoice: 'Voces claras',
    normalAudio: 'Normal',
    endsAt: 'Termina a las',
    continueWatching: 'Continuar viendo',
    featured: 'Destacados',
    recentlyAdded: 'Estrenadas recientemente',
  },
} as const;

export type ClaveTexto = keyof typeof TEXTOS.en;

export function t(clave: ClaveTexto): string {
  const lang = (ajustes().idiomaInterfaz as Idioma) || 'en';
  return TEXTOS[lang]?.[clave] ?? TEXTOS.en[clave] ?? clave;
}

/**
 * Texto en los dos idiomas, en línea: para pantallas enteras (Ajustes, menú, controles del
 * reproductor) es más legible que una clave por frase. Sigue el idioma de la interfaz.
 */
export function tr(es: string, en: string): string {
  return ajustes().idiomaInterfaz === 'es' ? es : en;
}
