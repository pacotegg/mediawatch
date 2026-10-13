/**
 * Etiquetas tecnicas del titulo (4K, HDR, audio) a partir de su mejor fichero. La app de la tele
 * las usa para el lomo del estuche y los chips de la ficha; hasta ahora nadie las calculaba y
 * siempre salia «BLU-RAY 1080P». Los valores de `hdr` y de `audio_tracks.codec` son los que hay
 * en la base de datos real: HDR10, HDR10PLUS, DOLBYVISION, HDR; eac3_ddp_atmos, truehd_atmos,
 * dtshd_ma...
 */
export type FicheroParaEtiquetas = {
  width: number | null;
  height: number | null;
  hdr: string | null;
  audio: { codec: string | null; channels: number | null }[];
};

export function etiquetasTecnicas(files: FicheroParaEtiquetas[]): string[] {
  const mejor = [...files].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  if (!mejor) return [];
  const tags: string[] = [];
  if ((mejor.height ?? 0) >= 1400 || (mejor.width ?? 0) >= 3000) tags.push('4K');
  if (mejor.hdr === 'DOLBYVISION') tags.push('DV');
  else if (mejor.hdr === 'HDR10PLUS') tags.push('HDR10+');
  else if (mejor.hdr === 'HDR10') tags.push('HDR10');
  else if (mejor.hdr) tags.push('HDR');
  const codecs = mejor.audio.map((a) => a.codec ?? '');
  if (codecs.some((c) => c.includes('atmos'))) tags.push('Atmos');
  if (codecs.some((c) => c.startsWith('truehd'))) tags.push('TrueHD');
  if (codecs.some((c) => c.startsWith('dtshd'))) tags.push('DTS-HD');
  const canales = Math.max(0, ...mejor.audio.map((a) => a.channels ?? 0));
  if (canales >= 8) tags.push('7.1');
  else if (canales >= 6) tags.push('5.1');
  return tags;
}
