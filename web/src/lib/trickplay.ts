export type TilePosition = {
  index: number;
  sheet: number;
  col: number;
  row: number;
  percentX: number;
  percentY: number;
};

/**
 * Calcula el fotograma más cercano y las coordenadas de corte en la hoja de sprites
 * de trickplay. Utiliza porcentajes CSS universales para adaptarse a cualquier tamaño de tarjeta.
 */
export function tileCoordinates(
  times: number[],
  targetTime: number,
  columns: number,
  rows: number,
): TilePosition {
  if (!times || times.length === 0) {
    return { index: 0, sheet: 0, col: 0, row: 0, percentX: 0, percentY: 0 };
  }

  let bestIdx = 0;
  let bestDiff = Math.abs(times[0] - targetTime);
  for (let i = 1; i < times.length; i++) {
    const diff = Math.abs(times[i] - targetTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }

  const perSheet = Math.max(1, columns * rows);
  const sheet = Math.floor(bestIdx / perSheet);
  const within = bestIdx % perSheet;
  const col = within % columns;
  const row = Math.floor(within / columns);

  // En CSS: position = (container - image) * percent
  // Dado image = columns * container, container - image = container * (1 - columns)
  // Para que el desfase sea -col * container:
  // percentX = col / (columns - 1)
  const percentX = columns > 1 ? (col / (columns - 1)) * 100 : 0;
  const percentY = rows > 1 ? (row / (rows - 1)) * 100 : 0;

  return { index: bestIdx, sheet, col, row, percentX, percentY };
}
