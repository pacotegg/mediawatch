import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, img } from '../lib/api.ts';

/**
 * Los logos de todos los estudios de un título, bajo el cartel, con el rótulo «Producida por» (como en la tele).
 *
 * Antes era un solo logo (el primero), en blanco liso con un filtro CSS. Ahora el servidor da la lista y cada logo viene
 * ya aclarado o en dorado (media/logos-estudio.ts). Uno solo, grande; varios, de dos en dos; los muy alargados
 * (4:1 o más, p. ej. el texto de DreamWorks Pictures) en su propia fila, o saldrían a 11 px de alto.
 */
export default function LogosEstudio({ itemId, compacto = false }: { itemId: number; compacto?: boolean }) {
  const { data } = useQuery({ queryKey: ['studio-logos', itemId], queryFn: () => api.studioLogos(itemId), staleTime: 10 * 60_000 });
  const [largos, setLargos] = useState<Record<string, boolean>>({});
  const [rotos, setRotos] = useState<Record<string, boolean>>({});
  const estudios = (data?.estudios ?? []).filter((n) => !rotos[n]);
  if (!estudios.length) return null;
  const solo = estudios.length === 1;
  return (
    // Nunca más ancho que el cartel (220 px): con 300 px se metía debajo del texto y los iconos de al lado.
    <div className={`${compacto ? 'mt-5' : 'mt-7'} flex w-full max-w-[220px] flex-col items-center`}>
      <div className="mb-3 text-[12px] tracking-wide text-mist-500">Producida por</div>
      <div className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-4">
        {estudios.map((nombre) => {
          const largo = largos[nombre];
          // Un solo logo, algo mayor; varios, DOS por fila como máximo (cada uno ocupa media fila); los muy alargados, fila propia.
          const celda = solo || largo ? 'basis-full' : 'basis-[calc(50%-6px)]';
          const tam = solo ? (compacto ? 'max-h-10 max-w-[150px]' : 'max-h-12 max-w-[180px]') : largo ? 'max-h-7 max-w-[200px]' : 'max-h-9 max-w-full';
          return (
            <div key={nombre} className={`flex min-w-0 items-center justify-center ${celda}`}>
              <img
                src={img.estudio(nombre)}
                alt={nombre}
                loading="lazy"
                onLoad={(e) => {
                  const el = e.currentTarget;
                  if (!solo && el.naturalWidth / el.naturalHeight >= 4) setLargos((p) => (p[nombre] ? p : { ...p, [nombre]: true }));
                }}
                onError={() => setRotos((p) => ({ ...p, [nombre]: true }))}
                className={`logo-estudio-3d object-contain ${tam}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
