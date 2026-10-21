const LANGUAGES: Record<string, string> = {
  spa: 'Español', eng: 'Inglés', cat: 'Catalán', glg: 'Gallego', eus: 'Euskera',
  fre: 'Francés', ger: 'Alemán', ita: 'Italiano', por: 'Portugués', jpn: 'Japonés',
  kor: 'Coreano', chi: 'Chino', rus: 'Ruso', ara: 'Árabe', hin: 'Hindi', swe: 'Sueco',
  dan: 'Danés', nor: 'Noruego', fin: 'Finés', dut: 'Neerlandés', pol: 'Polaco', tur: 'Turco',
};

/*
 * Lo que no está en la lista lo nombra el navegador: las pistas usan dos estándares de códigos a la vez
 * (`chi` y `zho`, `dut` y `nld`, `cze` y `ces`…) y salían en mayúsculas («ZHO»). Contado el 15/10 en la
 * biblioteca: 9 códigos así en audio y 18 en subtítulos. `und` es «sin idioma marcado», no un idioma
 * (el navegador lo llama «root»), y lo que no es un código (hay subtítulos con idioma «3») se deja tal cual.
 */
const nombresDelNavegador = (() => {
  try { return new Intl.DisplayNames(['es'], { type: 'language' }); } catch { return null; }
})();

export const languageName = (code?: string | null) => {
  if (!code || code.toLowerCase() === 'und') return 'Desconocido';
  const conocido = LANGUAGES[code.toLowerCase()];
  if (conocido) return conocido;
  try {
    const nombre = nombresDelNavegador?.of(code.toLowerCase());
    if (nombre && nombre.toLowerCase() !== code.toLowerCase()) return nombre.charAt(0).toUpperCase() + nombre.slice(1);
  } catch { /* no es un código de idioma */ }
  return code.toUpperCase();
};

export function runtime(minutes?: number | null): string {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function remaining(position: number, duration: number): string {
  const left = Math.max(0, duration - position);
  const mins = Math.round(left / 60);
  return mins >= 60 ? `Quedan ${Math.floor(mins / 60)} h ${mins % 60} min` : `Quedan ${mins} min`;
}

export const fileSize = (bytes?: number | null) =>
  !bytes ? '' : bytes >= 1 << 30 ? `${(bytes / 2 ** 30).toFixed(1)} GB` : `${Math.round(bytes / 2 ** 20)} MB`;

export function resolutionLabel(width?: number | null, height?: number | null): string | null {
  const w = width ?? 0;
  const h = height ?? 0;
  if (!w && !h) return null;
  if (w >= 3500 || h >= 1600) return '4K';
  if (w >= 1900 || h >= 800) return '1080p';
  if (w >= 1200 || h >= 700) return '720p';
  return 'SD';
}

export function aspectRatioLabel(width?: number | null, height?: number | null): string | null {
  const w = width ?? 0;
  const h = height ?? 0;
  if (!w || !h) return null;
  const r = w / h;
  if (r >= 2.30 && r <= 2.45) return '2.39:1';
  if (r >= 2.15 && r < 2.30) return '2.20:1';
  if (r >= 1.95 && r < 2.15) return '2.00:1';
  if (r >= 1.80 && r < 1.95) return '1.85:1';
  if (r >= 1.70 && r < 1.80) return '16:9';
  if (r >= 1.55 && r < 1.70) return '16:10';
  if (r >= 1.45 && r < 1.55) return '1.50:1';
  if (r >= 1.30 && r < 1.45) return '4:3';
  return `${r.toFixed(2)}:1`;
}

export const codecLabel = (codec?: string | null) => {
  if (!codec) return null;
  const map: Record<string, string> = { hevc: 'HEVC', h264: 'H.264', av1: 'AV1', xvid: 'XviD', divx: 'DivX', mpeg4: 'MPEG-4', vc1: 'VC-1' };
  return map[codec.toLowerCase()] ?? codec.toUpperCase();
};

/**
 * Nombre limpio de un códec de audio, como lo escribe el fabricante: «Dolby Digital», «Dolby Digital Plus Atmos», «Dolby TrueHD Atmos»,
 * «DTS-HD Master Audio»… Los identificadores internos (`eac3_ddp_atmos`, `dts_hd_ma`) no se enseñan nunca.
 */
export const audioCodecName = (codec?: string | null, atmos = false): string => {
  const c = (codec ?? '').toLowerCase().replace(/[\s/.:-]+/g, '_');
  const conAtmos = atmos || c.includes('atmos') || c.includes('joc');
  if (c.startsWith('truehd') || c.startsWith('mlp')) return conAtmos ? 'Dolby TrueHD Atmos' : 'Dolby TrueHD';
  if (c.startsWith('eac3') || c === 'ddp') return conAtmos ? 'Dolby Digital Plus Atmos' : 'Dolby Digital Plus';
  if (c.startsWith('ac3') || c === 'dd') return 'Dolby Digital';
  if (c.startsWith('dts')) {
    if (c.includes('_x')) return 'DTS:X';
    if (c.includes('ma') && c.includes('hd')) return 'DTS-HD Master Audio';
    if (c.includes('hra')) return 'DTS-HD High Resolution';
    if (c.includes('hd')) return 'DTS-HD';
    return 'DTS';
  }
  const otros: Record<string, string> = { aac: 'AAC', flac: 'FLAC', mp3: 'MP3', mp2: 'MP2', opus: 'Opus', vorbis: 'Vorbis', alac: 'ALAC', wmav2: 'WMA', wmapro: 'WMA Pro' };
  if (otros[c]) return otros[c];
  if (c.startsWith('pcm')) return 'PCM';
  return c ? c.replace(/_/g, ' ').toUpperCase() : '';
};

export const audioLayout = (channels?: number | null): string => {
  const mapa: Record<number, string> = { 1: '1.0', 2: '2.0', 3: '2.1', 4: '4.0', 5: '5.0', 6: '5.1', 7: '6.1', 8: '7.1' };
  return channels ? mapa[channels] ?? `${channels}ch` : '';
};

export const audioLabel = (codec?: string | null, channels?: number | null, atmos = false) =>
  [audioCodecName(codec, atmos), audioLayout(channels)].filter(Boolean).join(' ');

/** Las etiquetas distintas de una lista de pistas (dos pistas iguales en idiomas distintos salen una sola vez). */
export const audioLabelsUnicas = (
  pistas: { codec?: string | null; channels?: number | null; atmos?: boolean }[] | undefined,
  max = 2,
): string[] => {
  const out: string[] = [];
  for (const a of pistas ?? []) {
    const t = audioLabel(a.codec, a.channels, a.atmos === true);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, max);
};

/** tinyMediaManager writes ratings like "ES:16 / ES:16/fig"; only the first token is useful. */
export const certification = (mpaa?: string | null) => {
  if (!mpaa) return null;
  const first = mpaa.split('/')[0].trim();
  return first.replace(/^ES:/, '') || null;
};
