const cache = new Map<string, string>();

function dominant(image: HTMLImageElement): string {
  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '40 40 60';
  ctx.drawImage(image, 0, 0, size, size);

  const { data } = ctx.getImageData(0, 0, size, size);
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;

  for (let i = 0; i < data.length; i += 4) {
    const [pr, pg, pb] = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(pr, pg, pb);
    const min = Math.min(pr, pg, pb);
    // Favour saturated mid-tones so the tint reads as the artwork's colour,
    // not the near-black or blown-out regions that dominate most posters.
    const saturation = max === 0 ? 0 : (max - min) / max;
    const brightness = max / 255;
    const w = saturation * (brightness > 0.12 && brightness < 0.95 ? 1 : 0.05) + 0.02;
    r += pr * w;
    g += pg * w;
    b += pb * w;
    weight += w;
  }

  if (weight === 0) return '40 40 60';
  return [r / weight, g / weight, b / weight].map((c) => Math.round(Math.min(255, c))).join(' ');
}

export function tintFrom(src: string): Promise<string> {
  const hit = cache.get(src);
  if (hit) return Promise.resolve(hit);

  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      let value = '40 40 60';
      try {
        value = dominant(image);
      } catch {
        /* canvas tainted or decode failed: fall back to the neutral tint */
      }
      cache.set(src, value);
      resolve(value);
    };
    image.onerror = () => resolve('40 40 60');
    image.src = src;
  });
}
