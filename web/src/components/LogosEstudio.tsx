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
    <div className={`${compacto ? 'mt-5' : 'mt-7'} flex w-full max-w-[300px] flex-col items-center`}>
      <div className="mb-3 text-[12px] tracking-wide text-mist-500">Producida por</div>
      <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-5">
        {estudios.map((nombre) => {
          const largo = largos[nombre];
          const tam = solo ? (compacto ? 'max-h-12 max-w-[190px]' : 'max-h-16 max-w-[240px]') : largo ? 'max-h-10 max-w-[260px] basis-full' : 'max-h-12 max-w-[120px]';
          return (
            <img
              key={nombre}
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
          );
        })}
      </div>
    </div>
  );
}
