import { useState, useRef } from 'react';

interface Estuche3DProps {
  posterUrl: string;
  discartUrl: string | null;
  title: string;
}

/**
 * Estuche coleccionista físico en 3D interactivo con acabado AAA.
 * - Inclinación y paralaje fluido sin re-renders continuos de React (CSS variables).
 * - Extracción suave del disco con giro de 220° y elevación física.
 * - Iridiscencia óptica espectral viva (arcoíris Blu-ray) y conos especulares.
 * - Orificio central pasante real y anillo de policarbonato con reflejo.
 * - Lomo y cabecera de metacrilato "4K Ultra HD" con relieve.
 */
export default function Estuche3D({ posterUrl, discartUrl, title }: Estuche3DProps) {
  const [extraido, setExtraido] = useState(false);
  const marcoRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!marcoRef.current) return;
    const r = marcoRef.current.getBoundingClientRect();
    const xRel = (e.clientX - r.left) / r.width;
    const yRel = (e.clientY - r.top) / r.height;

    const rotX = (1 - (yRel - 0.5) * 12).toFixed(2);
    const rotY = (-12 + (xRel - 0.5) * 16).toFixed(2);
    marcoRef.current.style.setProperty('--tilt-x', `${rotX}deg`);
    marcoRef.current.style.setProperty('--tilt-y', `${rotY}deg`);
    marcoRef.current.style.setProperty('--glare-x', `${(xRel * 100).toFixed(1)}%`);
    marcoRef.current.style.setProperty('--glare-y', `${(yRel * 100).toFixed(1)}%`);
    marcoRef.current.style.setProperty('--glare-op', '0.45');
  };

  const handleMouseEnter = () => {
    setExtraido(true);
  };

  const handleMouseLeave = () => {
    setExtraido(false);
    if (marcoRef.current) {
      marcoRef.current.style.setProperty('--tilt-x', '2deg');
      marcoRef.current.style.setProperty('--tilt-y', '-12deg');
      marcoRef.current.style.setProperty('--glare-op', '0');
    }
  };

  return (
    <div
      ref={marcoRef}
      className="group relative select-none cursor-pointer pr-56 sm:pr-64 py-4"
      style={{
        perspective: '1200px',
        // @ts-ignore
        '--tilt-x': '2deg',
        '--tilt-y': '-12deg',
        '--glare-x': '30%',
        '--glare-y': '30%',
        '--glare-op': '0',
      }}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => setExtraido((prev) => !prev)}
      title={`${title} (Haz clic o pasa el ratón para extraer el disco)`}
    >
      <div
        className="relative w-[220px] h-[324px]"
        style={{
          transformStyle: 'preserve-3d',
          transform: 'rotateX(var(--tilt-x, 2deg)) rotateY(var(--tilt-y, -12deg))',
          transition: 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        {/* Sombra de contacto en el suelo con suavizado físico */}
        <div
          className="absolute -bottom-7 left-3 right-8 h-8 rounded-full bg-black/85 blur-xl pointer-events-none"
          style={{
            transform: extraido ? 'scale(1.35) translateX(60px)' : 'scale(1) translateX(0)',
            opacity: extraido ? 0.95 : 0.65,
            transition: 'transform 0.85s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.85s ease',
          }}
        />

        {/* ============================================================== */}
        {/* DISCO ÓPTICO (DISCART) EXTRAÍBLE CON FÍSICA, GIRO Y LUZ        */}
        {/* ============================================================== */}
        <div
          className="absolute top-8 bottom-8 right-0 w-[246px] h-[246px] rounded-full pointer-events-none"
          style={{
            transform: extraido
              ? 'translateX(200px) rotate(0deg) translateZ(10px) scale(1.02)'
              : 'translateX(12px) rotate(-360deg) translateZ(0px) scale(0.95)',
            transition: 'transform 0.85s cubic-bezier(0.16, 1, 0.3, 1), filter 0.85s ease',
            filter: extraido
              ? 'drop-shadow(-4px 18px 25px rgba(0,0,0,0.85)) drop-shadow(0 4px 10px rgba(0,0,0,0.6))'
              : 'drop-shadow(-2px 8px 12px rgba(0,0,0,0.5))',
            willChange: 'transform',
          }}
        >
          {/* Superficie base del disco y bisel de policarbonato */}
          <div className="relative w-full h-full rounded-full overflow-hidden bg-gradient-to-tr from-slate-900 via-slate-700 to-slate-900 ring-1 ring-white/30 shadow-inner">
            {discartUrl ? (
              <img
                src={discartUrl}
                alt=""
                className="w-full h-full object-contain rounded-full"
                loading="lazy"
              />
            ) : (
              /* Fallback coleccionista de lujo si no hay discart específico */
              <div className="w-full h-full rounded-full bg-gradient-to-tr from-zinc-900 via-zinc-800 to-zinc-950 flex flex-col items-center justify-between p-6 text-center shadow-inner">
                <div className="text-[10px] uppercase font-black tracking-widest text-white/55">4K Ultra HD Blu-ray</div>
                <div className="max-w-[140px] truncate text-xs font-bold text-white/95 drop-shadow-md tracking-tight">
                  {title}
                </div>
                <div className="text-[9px] font-semibold tracking-wider text-amber-400/70 uppercase">Collector Edition</div>
              </div>
            )}

            {/* Iridiscencia óptica viva / Difracción arcoíris espectral de Blu-ray */}
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{
                mixBlendMode: 'screen',
                opacity: extraido ? 0.72 : 0.3,
                transition: 'opacity 0.6s ease',
                background:
                  'conic-gradient(from 45deg, transparent 0%, rgba(255, 0, 150, 0.55) 12%, rgba(0, 240, 255, 0.65) 25%, rgba(0, 255, 120, 0.55) 38%, rgba(255, 240, 0, 0.65) 50%, rgba(255, 0, 150, 0.55) 62%, rgba(0, 240, 255, 0.65) 75%, rgba(180, 0, 255, 0.55) 88%, transparent 100%)',
              }}
            />

            {/* Reflejo especular radial en dos conos opuestos de luz (anisotrópico) */}
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{
                mixBlendMode: 'overlay',
                background:
                  'conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.65) 25deg, transparent 55deg, transparent 180deg, rgba(255,255,255,0.65) 205deg, transparent 235deg)',
              }}
            />

            {/* Micro-surcos circulares de lectura óptica */}
            <div className="absolute inset-[10px] rounded-full border border-white/10 pointer-events-none" />
            <div className="absolute inset-[20px] rounded-full border border-white/5 pointer-events-none" />
            <div className="absolute inset-[32px] rounded-full border border-white/5 pointer-events-none" />

            {/* ========================================================== */}
            {/* ANILLO CENTRAL Y HUECO TRANSPARENTE DEL DISCO              */}
            {/* ========================================================== */}
            {/* Pista de datos interna plateada */}
            <div className="absolute inset-[74px] rounded-full border border-white/35 bg-white/10 backdrop-blur-[1px] pointer-events-none shadow-inner" />
            {/* Anillo de sujeción de policarbonato translúcido */}
            <div className="absolute inset-[84px] rounded-full border-2 border-white/45 bg-slate-900/50 backdrop-blur-[2px] pointer-events-none flex items-center justify-center">
              {/* Agujero central real (spindle) transparente */}
              <div className="w-[34px] h-[34px] rounded-full bg-ink-950/95 ring-2 ring-black/75 shadow-inner" />
            </div>
          </div>
        </div>

        {/* ============================================================== */}
        {/* CAJA FÍSICA / ESTUCHE DE METACRILATO CON PROFUNDIDAD 3D        */}
        {/* ============================================================== */}
        <div
          className="relative w-full h-full overflow-hidden rounded-[10px] border border-white/25 bg-ink-950 shadow-[0_28px_50px_-10px_rgba(0,0,0,0.92),-12px_14px_30px_rgba(0,0,0,0.7)]"
          style={{
            transformStyle: 'preserve-3d',
            transform: 'translateZ(6px)',
          }}
        >
          {/* Cabecera biselada de estuche Blu-ray en relieve con pestaña translúcida */}
          <div className="absolute top-0 inset-x-0 h-6 bg-gradient-to-b from-sky-400/40 to-sky-600/20 backdrop-blur-[4px] border-b border-white/20 z-20 flex items-center justify-between px-3">
            <div className="flex items-center gap-1 opacity-80">
              <span className="text-[8px] font-black tracking-widest text-white/95 drop-shadow">4K ULTRA HD</span>
            </div>
            {/* Pestaña de cierre del estuche */}
            <div className="w-12 h-1.5 bg-white/35 rounded-full border border-white/30 shadow-inner" />
            <div className="w-4 h-1.5 bg-white/20 rounded-full" />
          </div>

          {/* Imagen de carátula (póster) */}
          <img
            src={posterUrl}
            alt={title}
            className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.02]"
            loading="lazy"
          />

          {/* Lomo lateral izquierdo con volumen y bisel de profundidad */}
          <div
            className="absolute top-0 bottom-0 left-0 w-3.5 pointer-events-none z-30"
            style={{
              background:
                'linear-gradient(to right, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.15) 30%, rgba(0,0,0,0.4) 75%, transparent 100%)',
              boxShadow: 'inset 1px 0 0 rgba(255,255,255,0.6)',
            }}
          />

          {/* Canto superior reflectante */}
          <div
            className="absolute top-0 inset-x-0 h-1 pointer-events-none z-30"
            style={{
              background: 'linear-gradient(to bottom, rgba(255,255,255,0.6) 0%, transparent 100%)',
            }}
          />

          {/* Reflejo especular dinámico que sigue el ratón (metacrilato brillante) */}
          <div
            className="absolute inset-0 pointer-events-none z-30 transition-opacity duration-200"
            style={{
              opacity: 'var(--glare-op, 0)',
              background:
                'radial-gradient(circle 220px at var(--glare-x) var(--glare-y), rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.08) 50%, transparent 80%)',
            }}
          />

          {/* Brillo diagonal fijo de funda protectora transparente */}
          <div
            className="absolute inset-0 pointer-events-none z-20"
            style={{
              background:
                'linear-gradient(125deg, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0.06) 38%, transparent 54%, rgba(0,0,0,0.3) 100%)',
            }}
          />
        </div>
      </div>
    </div>
  );
}
