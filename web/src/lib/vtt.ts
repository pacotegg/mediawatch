export type Cue = { start: number; end: number; text: string };

const timestamp = (raw: string): number => {
  const parts = raw.trim().split(':');
  const seconds = Number(parts.pop()?.replace(',', '.') ?? 0);
  const minutes = Number(parts.pop() ?? 0);
  const hours = Number(parts.pop() ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
};

export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n').filter(Boolean);
    const timingIndex = lines.findIndex((l) => l.includes('-->'));
    if (timingIndex < 0) continue;
    const [rawStart, rawEnd] = lines[timingIndex].split('-->');
    if (!rawEnd) continue;
    const body = lines.slice(timingIndex + 1).join('\n').trim();
    if (!body) continue;
    cues.push({ start: timestamp(rawStart), end: timestamp(rawEnd.split(' ')[0]), text: body });
  }
  return cues;
}

/**
 * A transcoded stream restarts its timeline at zero from the requested offset,
 * so cues have to be shifted by that offset to stay in sync.
 */
export function applyCues(track: TextTrack, cues: Cue[], offset: number, delay = 0) {
  while (track.cues && track.cues.length > 0) track.removeCue(track.cues[0]);
  for (const cue of cues) {
    // `delay` is the measured or hand-set correction: positive means the
    // subtitle runs early and has to be pushed later.
    const start = cue.start + delay - offset;
    const end = cue.end + delay - offset;
    if (end <= 0) continue;
    try {
      track.addCue(new VTTCue(Math.max(0, start), end, cue.text.replace(/<[^>]+>/g, '')));
    } catch {
      /* malformed cue: skip it rather than losing the whole track */
    }
  }
}
