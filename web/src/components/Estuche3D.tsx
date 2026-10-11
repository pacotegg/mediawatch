import { useState } from 'react';

interface Estuche3DProps {
  posterUrl: string;
  discartUrl: string | null;
  title: string;
}

/**
 * Estuche físico coleccionista en 3D interactivo con disco extraíble.
 * Representa el cartel con perspectiva CSS 3D, lomo, reflejo de plástico
 * de caja Blu-ray y el disco (discart) que asoma al pasar el ratón.
 */
export default function Estuche3D({ posterUrl, discartUrl, title }: Estuche3DProps) {
  const [extraido, setExtraido] = useState(false);

  return (
    <div
      className="group relative select-none cursor-pointer pr-14"
      style={{ perspective: '1100px' }}
      onMouseEnter={() => setExtraido(true)}
      onMouseLeave={() => setExtraido(false)}
      onClick={() => setExtraido((prev) => !prev)}
      title={`${title} (Haz clic para extraer el disco)`}
    >
      <div
        className="relative w-[210px] h-[310px] transition-transform duration-500 ease-out"
        style={{
          transformStyle: 'preserve-3d',
          transform: extraido
            ? 'rotateY(-6deg) rotateX(1deg) translateY(-4px)'
            : 'rotateY(-18deg) rotateX(4deg)',
        }}
      >
        {/* Disco (discart) extraíble si existe */}
        {discartUrl && (
          <div
            className="absolute top-6 bottom-6 right-0 w-[240px] h-[240px] rounded-full transition-all duration-700 pointer-events-none"
            style={{
              transformStyle: 'preserve-3d',
              transform: extraido
                ? 'translateX(105px) rotate(220deg)'
                : 'translateX(8px) rotate(25deg)',
              zIndex: extraido ? 20 : 0,
              filter: 'drop-shadow(0 12px 20px rgba(0,0,0,0.65))',
            }}
          >
            <img
              src={discartUrl}
              alt=""
              className="w-full h-full object-contain rounded-full"
            />
            {/* Agujero central y reflejo óptico sobre el disco */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/10 via-transparent to-white/20 pointer-events-none" />
          </div>
        )}

        {/* Caja / Estuche con carátula */}
        <div
          className="relative z-10 w-full h-full overflow-hidden rounded-[8px] border border-white/20 bg-ink-950 shadow-[0_24px_45px_-8px_rgba(0,0,0,0.9),-10px_10px_25px_rgba(0,0,0,0.6)]"
          style={{
            transform: 'translateZ(10px)',
          }}
        >
          {/* Banda superior de estuche translúcido tipo Blu-ray */}
          <div className="absolute top-0 inset-x-0 h-4 bg-sky-500/25 backdrop-blur-[2px] border-b border-white/20 z-20 flex items-center justify-center">
            <div className="w-10 h-1 bg-white/40 rounded-full" />
          </div>

          {/* Imagen de carátula (póster) */}
          <img
            src={posterUrl}
            alt={title}
            className="w-full h-full object-cover"
            loading="lazy"
          />

          {/* Brillo diagonal de funda de plástico */}
          <div
            className="absolute inset-0 pointer-events-none z-30"
            style={{
              background:
                'linear-gradient(135deg, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0.06) 42%, transparent 58%, rgba(0,0,0,0.35) 100%)',
            }}
          />

          {/* Lomo izquierdo (borde con volumen) */}
          <div
            className="absolute top-0 bottom-0 left-0 w-3 pointer-events-none z-30"
            style={{
              background:
                'linear-gradient(to right, rgba(255,255,255,0.3) 0%, rgba(0,0,0,0.25) 50%, transparent 100%)',
            }}
          />
        </div>
      </div>
    </div>
  );
}
