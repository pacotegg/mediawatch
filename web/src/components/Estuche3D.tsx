import { useState, useRef } from 'react';

interface Estuche3DProps {
  posterUrl: string;
  discartUrl: string | null;
  title: string;
  /** Si la copia es 4K: la cabecera dice «4K ULTRA HD» solo entonces. */
  es4k?: boolean;
  onAbrirColeccionista?: () => void;
}

/**
 * Estuche coleccionista físico en 3D interactivo con acabado AAA.
 * - Inclinación y paralaje fluido sin re-renders continuos de React (CSS variables).
 * - Extracción suave y continua del disco con giro y elevación física por GPU.
 * - Iridiscencia óptica espectral viva (arcoíris Blu-ray) y conos especulares.
 * - Orificio central pasante real y anillo de policarbonato con reflejo.
 * - Lomo y cabecera de metacrilato con relieve.
 */
export default function Estuche3D({
  posterUrl,
  discartUrl,
  title,
  es4k = false,
  onAbrirColeccionista,
}: Estuche3DProps) {
  const [extraido, setExtraido] = useState(false);
  const marcoRef = useRef<HTMLDivElement>(null);

  // Solo el ratón inclina el estuche al pasar por encima.
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || !marcoRef.current) return;
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

  const handlePointerEnter = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') setExtraido(true);
  };

  const handlePointerLeave = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
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
      className="group relative select-none cursor-pointer pr-[170px] xl:pr-[250px] py-4 animar-siempre [--sal-disco:130px] xl:[--sal-disco:236px]"
      style={{
        perspective: '1200px',
        // @ts-ignore
        '--tilt-x': '2deg',
        '--tilt-y': '-12deg',
        '--glare-x': '30%',
        '--glare-y': '30%',
        '--glare-op': '0',
      }}
      onPointerMove={handlePointerMove}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onClick={() => {
        if (onAbrirColeccionista) onAbrirColeccionista();
        else setExtraido((prev) => !prev);
      }}
      role="button"
      tabIndex={0}
      aria-pressed={extraido}
      aria-label={`${title}: ver edición coleccionista física`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (onAbrirColeccionista) onAbrirColeccionista();
          else setExtraido((prev) => !prev);
        }
      }}
      title={`${title} · Clic para abrir edición coleccionista`}
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
            transform: extraido ? 'scale(1.25) translateX(45px)' : 'scale(1) translateX(0)',
            opacity: extraido ? 0.95 : 0.65,
            transition: 'transform 0.55s cubic-bezier(0.2, 0, 0, 1), opacity 0.55s ease',
          }}
        />

        {/* ============================================================== */}
        {/* DISCO (DISCART): SALE POR LA DERECHA, DETRÁS DE LA CAJA, SIN GIRAR  */}
        {/* ============================================================== */}
        {/* Va siempre por detrás de la caja (translateZ negativo): al salir se desliza girando media vuelta, termina recto a la derecha y no pasa por encima de la carátula. */}
        {/* La imagen ya lleva su aro y su agujero; no se le pone nada encima (una capa de color lo teñía de lila) y la sombra sigue su silueta (drop-shadow). */}
        <div
          className="absolute top-[57px] right-1 h-[210px] w-[210px] pointer-events-none"
          style={{
            // Sale girando media vuelta mientras se desliza y termina recto (rotate 0). Siempre por detrás de la caja (translateZ negativo).
            transform: extraido ? 'translateX(var(--sal-disco)) rotate(0deg) translateZ(-4px)' : 'translateX(0px) rotate(-180deg) translateZ(-4px)',
            transition: 'transform 0.55s cubic-bezier(0.2, 0, 0, 1)',
            willChange: 'transform',
            zIndex: 1,
          }}
        >
          {discartUrl ? (
            <img
              src={discartUrl}
              alt=""
              className="h-full w-full rounded-full object-contain"
              style={{ filter: extraido ? 'drop-shadow(0 14px 22px rgba(0, 0, 0, 0.8))' : 'none', transition: 'filter 0.4s ease' }}
              loading="lazy"
            />
          ) : (
            /* Sin disco: un disco liso con el título, sin efectos de color. */
            <div className="flex h-full w-full flex-col items-center justify-between rounded-full bg-gradient-to-tr from-zinc-900 via-zinc-800 to-zinc-950 p-6 text-center ring-1 ring-white/20">
              <div className="text-[10px] font-black uppercase tracking-widest text-white/55">{es4k ? '4K Ultra HD Blu-ray' : 'Blu-ray Disc'}</div>
              <div className="max-w-[140px] truncate text-xs font-bold tracking-tight text-white/95">{title}</div>
              <div className="text-[9px] font-semibold uppercase tracking-wider text-amber-400/70">Collector Edition</div>
            </div>
          )}
        </div>

        {/* ============================================================== */}
        {/* CAJA FÍSICA / ESTUCHE DE METACRILATO CON PROFUNDIDAD 3D        */}
        {/* ============================================================== */}
        <div
          className="relative w-full h-full overflow-hidden rounded-[10px] border border-white/25 bg-ink-950 shadow-[0_28px_50px_-10px_rgba(0,0,0,0.92),-12px_14px_30px_rgba(0,0,0,0.7)] transition-all duration-300 group-hover:border-accent/60 group-hover:shadow-[0_0_0_2px_rgba(56,189,248,0.4),0_30px_60px_rgba(0,0,0,0.95)]"
          style={{
            transformStyle: 'preserve-3d',
            transform: 'translateZ(6px)',
            zIndex: 2,
          }}
        >
          {/* Cabecera biselada de estuche Blu-ray en relieve con pestaña translúcida */}
          <div
            className={`absolute top-0 inset-x-0 h-6 backdrop-blur-[4px] border-b z-20 flex items-center justify-between px-3 ${
              es4k ? 'bg-ink-950/90 border-amber-300/50' : 'bg-gradient-to-b from-sky-400/40 to-sky-600/20 border-white/20'
            }`}
          >
            <div className="flex items-center gap-1 opacity-90">
              <span className={`text-[8px] font-black tracking-widest drop-shadow ${es4k ? 'text-amber-300' : 'text-white/95'}`}>
                {es4k ? '4K ULTRA HD' : 'BLU-RAY'}
              </span>
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

        {/* Rótulo de ayuda interactiva que aparece al posar el ratón */}
        <div
          className={`absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide bg-ink-950/95 border border-white/20 text-white shadow-xl pointer-events-none transition-all duration-200 z-40 ${
            extraido ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
          }`}
        >
          Edición física · Clic para abrir
        </div>
      </div>
    </div>
  );
}
