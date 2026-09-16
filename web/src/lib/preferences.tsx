import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Preferences = {
  playback: {
    maxHeight: number;
    resume: boolean;
    autoPlayNext: boolean;
    seekStep: number;
    seekStepLarge: number;
    /** Trocear en HLS para que la calidad se adapte a la red. */
    adaptativo: 'auto' | 'siempre' | 'nunca';
  };
  audio: {
    preferredLanguage: string;
    downmixStereo: boolean;
    normalize: boolean;
    defaultVolume: number;
    mode: 'normal' | 'dialogue' | 'night';
  };
  subtitles: {
    preferredLanguage: string;
    mode: 'always' | 'auto' | 'never';
    preferForced: boolean;
    size: number;
    color: string;
    background: 'none' | 'shadow' | 'box';
    offset: number;
  };
  interface: {
    reduceMotion: boolean;
    showWatched: boolean;
  };
};

export const DEFAULTS: Preferences = {
  playback: { maxHeight: 0, resume: true, autoPlayNext: true, seekStep: 10, seekStepLarge: 60, adaptativo: 'auto' },
  audio: { preferredLanguage: 'spa', downmixStereo: true, normalize: false, defaultVolume: 1, mode: 'normal' },
  subtitles: { preferredLanguage: 'spa', mode: 'auto', preferForced: false, size: 100, color: '#ffffff', background: 'shadow', offset: 0 },
  interface: { reduceMotion: false, showWatched: true },
};

const STORAGE_KEY = 'cineteca.preferences';

type Section = keyof Preferences;

type Context = {
  prefs: Preferences;
  update: <S extends Section>(section: S, patch: Partial<Preferences[S]>) => void;
  reset: () => void;
};

const PreferencesContext = createContext<Context>({ prefs: DEFAULTS, update: () => {}, reset: () => {} });

/**
 * Completa lo guardado con los valores por defecto.
 *
 * Hay que aplicarlo también a lo que devuelve el servidor, no solo a la copia
 * local: unos ajustes guardados hace meses no traen las opciones añadidas
 * después, y si se usan tal cual esas opciones se quedan en `undefined` para
 * siempre —el control aparece vacío y la función nueva no se activa nunca.
 */
function conValoresPorDefecto(stored: Partial<Preferences> | null | undefined): Preferences {
  return {
    playback: { ...DEFAULTS.playback, ...stored?.playback },
    audio: { ...DEFAULTS.audio, ...stored?.audio },
    subtitles: { ...DEFAULTS.subtitles, ...stored?.subtitles },
    interface: { ...DEFAULTS.interface, ...stored?.interface },
  };
}

function readCache(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return conValoresPorDefecto(JSON.parse(raw) as Partial<Preferences>);
  } catch {
    return DEFAULTS;
  }
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  // The cached copy avoids a flash of default settings while the server answers.
  const [prefs, setPrefs] = useState<Preferences>(readCache);

  useEffect(() => {
    fetch('/api/preferences', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((server: Partial<Preferences> | null) => {
        if (!server) return;
        const completo = conValoresPorDefecto(server);
        setPrefs(completo);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(completo));
      })
      .catch(() => undefined);
  }, []);

  const update = useCallback<Context['update']>((section, patch) => {
    setPrefs((current) => {
      const next = { ...current, [section]: { ...current[section], ...patch } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      fetch('/api/preferences', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).catch(() => undefined);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setPrefs(DEFAULTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULTS));
    fetch('/api/preferences', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DEFAULTS),
    }).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ prefs, update, reset }), [prefs, update, reset]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export const usePreferences = () => useContext(PreferencesContext);

/** Styles the native cue box; the only way to restyle WebVTT text. */
export function subtitleCss(s: Preferences['subtitles']): string {
  const background =
    s.background === 'box' ? 'rgba(0,0,0,0.75)' : 'transparent';
  const shadow =
    s.background === 'shadow'
      ? 'text-shadow: 0 2px 4px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.8);'
      : '';
  return `::cue { font-size: ${s.size}%; color: ${s.color}; background-color: ${background}; ${shadow} font-family: 'Inter Variable', system-ui, sans-serif; }`;
}
