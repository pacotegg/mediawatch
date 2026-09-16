const LANGUAGES: Record<string, string> = {
  spa: 'Español', eng: 'Inglés', cat: 'Catalán', glg: 'Gallego', eus: 'Euskera',
  fre: 'Francés', ger: 'Alemán', ita: 'Italiano', por: 'Portugués', jpn: 'Japonés',
  kor: 'Coreano', chi: 'Chino', rus: 'Ruso', ara: 'Árabe', hin: 'Hindi', swe: 'Sueco',
  dan: 'Danés', nor: 'Noruego', fin: 'Finés', dut: 'Neerlandés', pol: 'Polaco', tur: 'Turco',
};

export const languageName = (code?: string | null) =>
  !code ? 'Desconocido' : LANGUAGES[code.toLowerCase()] ?? code.toUpperCase();

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
  if (!height) return null;
  if (height >= 1900 || (width ?? 0) >= 3500) return '4K';
  if (height >= 1000) return '1080p';
  if (height >= 700) return '720p';
  return 'SD';
}

export const codecLabel = (codec?: string | null) => {
  if (!codec) return null;
  const map: Record<string, string> = { hevc: 'HEVC', h264: 'H.264', av1: 'AV1', xvid: 'XviD', divx: 'DivX', mpeg4: 'MPEG-4', vc1: 'VC-1' };
  return map[codec.toLowerCase()] ?? codec.toUpperCase();
};

export const audioLabel = (codec?: string | null, channels?: number | null) => {
  const names: Record<string, string> = {
    ac3: 'Dolby Digital', eac3: 'Dolby Digital+', truehd: 'Dolby TrueHD',
    dts: 'DTS', dtshd: 'DTS-HD', aac: 'AAC', flac: 'FLAC', mp3: 'MP3', opus: 'Opus', pcm_s16le: 'PCM',
  };
  const layout = channels === 8 ? '7.1' : channels === 6 ? '5.1' : channels === 2 ? '2.0' : channels ? `${channels}ch` : '';
  const name = names[(codec ?? '').toLowerCase()] ?? (codec ?? '').toUpperCase();
  return [name, layout].filter(Boolean).join(' ');
};

/** tinyMediaManager writes ratings like "ES:16 / ES:16/fig"; only the first token is useful. */
export const certification = (mpaa?: string | null) => {
  if (!mpaa) return null;
  const first = mpaa.split('/')[0].trim();
  return first.replace(/^ES:/, '') || null;
};
