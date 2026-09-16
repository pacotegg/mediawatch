import type { FastifyInstance } from 'fastify';
import { config, saveConfig } from '../config.ts';
import { db } from '../db.ts';
import { detectCapabilities } from '../media/capabilities.ts';
import { requireUser } from './auth.ts';

export type Preferences = {
  playback: {
    maxHeight: number;
    resume: boolean;
    autoPlayNext: boolean;
    seekStep: number;
    seekStepLarge: number;
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

export const DEFAULT_PREFERENCES: Preferences = {
  playback: { maxHeight: 0, resume: true, autoPlayNext: true, seekStep: 10, seekStepLarge: 60 },
  audio: { preferredLanguage: 'spa', downmixStereo: true, normalize: false, defaultVolume: 1, mode: 'normal' },
  subtitles: { preferredLanguage: 'spa', mode: 'auto', preferForced: false, size: 100, color: '#ffffff', background: 'shadow', offset: 0 },
  interface: { reduceMotion: false, showWatched: true },
};

/** Shallow-merges each section so new defaults appear without wiping stored values. */
function merge(stored: Partial<Preferences> | null): Preferences {
  if (!stored) return DEFAULT_PREFERENCES;
  return {
    playback: { ...DEFAULT_PREFERENCES.playback, ...stored.playback },
    audio: { ...DEFAULT_PREFERENCES.audio, ...stored.audio },
    subtitles: { ...DEFAULT_PREFERENCES.subtitles, ...stored.subtitles },
    interface: { ...DEFAULT_PREFERENCES.interface, ...stored.interface },
  };
}

export function preferencesFor(userId: number): Preferences {
  const row = db.prepare('SELECT data FROM preferences WHERE user_id = ?').get(userId) as { data: string } | undefined;
  if (!row) return DEFAULT_PREFERENCES;
  try {
    return merge(JSON.parse(row.data));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export default async function preferenceRoutes(app: FastifyInstance) {
  app.get('/api/preferences', async (req) => {
    const user = requireUser(req);
    return preferencesFor(user.id);
  });

  app.put('/api/preferences', async (req) => {
    const user = requireUser(req);
    const next = merge(req.body as Partial<Preferences>);
    db.prepare(`INSERT INTO preferences (user_id, data) VALUES (?,?)
                ON CONFLICT(user_id) DO UPDATE SET data = excluded.data`)
      .run(user.id, JSON.stringify(next));
    return next;
  });

  app.get('/api/server-settings', async (req) => {
    const user = requireUser(req);
    if (!user.is_admin) return { readOnly: true, hwaccel: config.hwaccel };
    return {
      readOnly: false,
      hwaccel: config.hwaccel,
      transcodeQuality: config.transcodeQuality,
      tonemap: config.tonemap,
      tmdbLanguage: config.tmdbLanguage,
      hasTmdbKey: Boolean(config.tmdbApiKey),
      port: config.port,
      transcodeDir: config.transcodeDir,
      libraries: config.libraries,
    };
  });

  app.get('/api/capabilities', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'No autorizado' });
    const force = (req.query as { force?: string }).force === '1';
    return detectCapabilities(force);
  });

  app.post('/api/capabilities/apply', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'No autorizado' });
    const caps = await detectCapabilities();
    saveConfig({
      ...config,
      hwaccel: caps.best.hwaccel,
      transcodeQuality: caps.best.transcodeQuality,
      tonemap: caps.best.tonemap,
    });
    return { applied: caps.best };
  });

  app.put('/api/server-settings', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede cambiar los ajustes del servidor' });

    const body = req.body as Record<string, unknown>;
    const next = { ...config };
    if (body.hwaccel === 'qsv' || body.hwaccel === 'none') next.hwaccel = body.hwaccel;
    if (typeof body.transcodeQuality === 'number') next.transcodeQuality = Math.min(35, Math.max(12, body.transcodeQuality));
    if (typeof body.tonemap === 'boolean') next.tonemap = body.tonemap;
    if (typeof body.tmdbApiKey === 'string') next.tmdbApiKey = body.tmdbApiKey.trim();
    if (typeof body.tmdbLanguage === 'string') next.tmdbLanguage = body.tmdbLanguage;

    saveConfig(next);
    return { ok: true, hasTmdbKey: Boolean(config.tmdbApiKey) };
  });
}
