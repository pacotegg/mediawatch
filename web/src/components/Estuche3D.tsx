import { useState, useRef } from 'react';

interface Estuche3DProps {
  posterUrl: string;
  discartUrl: string | null;
  title: string;
}

/**
 * Estuche coleccionista físico en 3D interactivo con acabado AAA.
 * - Inclinación y paralaje reactivo al puntero del ratón (tilt dinámico).
 * - Reflejo especular móvil sobre el metacrilato de la caja.
 * - Volumen 3D con lomo lateral y cabecera de estuche en relieve.
 * - Extracción del disco con rotación física e iridiscencia holográfica (arcoíris Blu-ray).
 * - Núcleo central con agujero transparente y anillos de sujeción concéntricos.
 * - Sombra de contacto en suelo con atenuación dinámica.
 */
export default function Estuche3D({ posterUrl, discartUrl, title }: Estuche3DProps) {
  const [extraido, setExtraido] = useState(false);
  const [rotacion, setRotacion] = useState({ x: 3, y: -14 });
  const [brillo, setBrillo] = useState({ x: 35, y: 35, opacidad: 0 });
  const marcoRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!marcoRef.current) return;
    const r = marcoRef.current.getBoundingClientRect();
    const xRel = (e.clientX - r.left) / r.width;
    const yRel = (e.clientY - r.top) / r.height;

    const baseRotY = extraido ? -4 : -14;
    const baseRotX = extraido ? 1 : 3;

    setRotacion({
      x: baseRotX - (yRel - 0.5) * 14,
      y: baseRotY + (xRel - 0.5) * 18,
    });

    setBrillo({
      x: xRel * 100,
      y: yRel * 100,
      opacidad: 0.45,
    });
  };

  const handleMouseEnter = () => {
    setExtraido(true);
  };

  const handleMouseLeave = () => {
    setExtraido(false);
    setRotacion({ x: 3, y: -14 });
    setBrillo({ x: 35, y: 35, opacidad: 0 });
  };

  return (
    <div
      ref={marcoRef}
      className="group relative select-none cursor-pointer pr-44 sm:pr-48 py-4"
      style={{ perspective: '1200px' }}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => setExtraido((prev) => !prev)}
      title={`${title} (Haz clic o pasa el ratón para extraer el disco)`}
    >
      <div
        className="relative w-[218px] h-[324px] transition-transform duration-300 ease-out"
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateX(${rotacion.x}deg) rotateY(${rotacion.y}deg)`,
        }}
      >
        {/* Sombra de contacto en el suelo */}
        <div
          className="absolute -bottom-8 left-4 right-10 h-7 rounded-full bg-black/80 blur-xl pointer-events-none transition-all duration-500"
          style={{
            transform: `scale(${extraido ? 1.25 : 1}) translateX(${extraido ? '50px' : '0'})`,
            opacity: extraido ? 0.9 : 0.65,
          }}
        />

        {/* ============================================================== */}
        {/* DISCO ÓPTICO (DISCART) EXTRAÍBLE CON FÍSICA Y ROTACIÓN         */}
        {/* ============================================================== */}
        <div
          className="absolute top-8 bottom-8 right-0 w-[248px] h-[248px] rounded-full pointer-events-none transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{
            transform: extraido
              ? 'translateX(182px) rotate(145deg) scale(1.02)'
              : 'translateX(12px) rotate(0deg) scale(0.96)',
            zIndex: extraido ? 25 : 0,
            filter: extraido
              ? 'drop-shadow(0 20px 30px rgba(0,0,0,0.85)) drop-shadow(0 4px 10px rgba(0,0,0,0.6))'
              : 'drop-shadow(0 8px 16px rgba(0,0,0,0.5))',
          }}
        >
          {/* Superficie base del disco */}
          <div className="relative w-full h-full rounded-full overflow-hidden bg-gradient-to-tr from-slate-800 via-slate-600 to-slate-900 ring-1 ring-white/30 shadow-inner">
            {discartUrl ? (
              <img
                src={discartUrl}
                alt=""
                className="w-full h-full object-contain rounded-full"
                loading="lazy"
              />
            ) : (
              /* Fallback coleccionista de lujo si no hay discart específico */
              <div className="w-full h-full rounded-full bg-gradient-to-tr from-slate-900 via-slate-700 to-slate-900 flex flex-col items-center justify-between p-6 text-center">
                <div className="text-[10px] uppercase font-bold tracking-widest text-white/50">Blu-ray Disc</div>
                <div className="max-w-[140px] truncate text-xs font-semibold text-white/90 drop-shadow-md">
                  {title}
                </div>
                <div className="text-[9px] tracking-wider text-white/40">Collector Edition</div>
              </div>
            )}

            {/* Iridiscencia óptica / Difracción arcoíris de Blu-ray */}
            <div
              className="absolute inset-0 rounded-full pointer-events-none mix-blend-screen transition-opacity duration-500"
              style={{
                opacity: extraido ? 0.42 : 0.2,
                background:
                  'conic-gradient(from 45deg, rgba(255,0,128,0) 0%, rgba(255,0,128,0.3) 15%, rgba(0,255,255,0.4) 30%, rgba(0,255,100,0.3) 45%, rgba(255,255,0,0.35) 60%, rgba(255,0,128,0.3) 75%, rgba(0,255,255,0.4) 90%, rgba(255,0,128,0) 100%)',
              }}
            />

            {/* Reflejo especular radial en dos conos opuestos (característico de discos compactos) */}
            <div
              className="absolute inset-0 rounded-full pointer-events-none mix-blend-overlay"
              style={{
                background:
                  'conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.45) 30deg, transparent 60deg, transparent 180deg, rgba(255,255,255,0.45) 210deg, transparent 240deg)',
              }}
            />

            {/* Micro-surco circular de lectura (groove) */}
            <div className="absolute inset-[10px] rounded-full border border-white/10 pointer-events-none" />
            <div className="absolute inset-[18px] rounded-full border border-white/5 pointer-events-none" />
            <div className="absolute inset-[30px] rounded-full border border-white/5 pointer-events-none" />

            {/* ========================================================== */}
            {/* ANILLO CENTRAL Y HUECO TRANSPARENTE DEL DISCO              */}
            {/* ========================================================== */}
            {/* Pista de datos interna plateada */}
            <div className="absolute inset-[78px] rounded-full border border-white/30 bg-white/10 backdrop-blur-[1px] pointer-events-none shadow-inner" />
            {/* Anillo de sujeción de policarbonato transparente */}
            <div className="absolute inset-[88px] rounded-full border-2 border-white/40 bg-slate-900/40 backdrop-blur-[2px] pointer-events-none flex items-center justify-center">
              {/* Agujero central real (spindle) que deja ver el fondo */}
              <div className="w-[32px] h-[32px] rounded-full bg-ink-950/95 ring-2 ring-black/70 shadow-inner" />
            </div>
          </div>
        </div>

        {/* ============================================================== */}
        {/* CAJA FÍSICA / ESTUCHE DE METACRILATO CON PROFUNDIDAD 3D        */}
        {/* ============================================================== */}
        <div
          className="relative z-10 w-full h-full overflow-hidden rounded-[10px] border border-white/25 bg-ink-950 shadow-[0_28px_50px_-10px_rgba(0,0,0,0.92),-12px_14px_30px_rgba(0,0,0,0.7)] transition-all duration-300"
          style={{
            transformStyle: 'preserve-3d',
          }}
        >
          {/* Cabecera biselada de estuche Blu-ray en relieve con pestaña translúcida */}
          <div className="absolute top-0 inset-x-0 h-6 bg-gradient-to-b from-sky-400/35 to-sky-600/15 backdrop-blur-[4px] border-b border-white/20 z-20 flex items-center justify-between px-3">
            {/* Relieve metálico o logotipo sutil */}
            <div className="flex items-center gap-1 opacity-70">
              <span className="text-[8px] font-black tracking-widest text-white/90 drop-shadow">ULTRA HD</span>
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

          {/* Reflejo especular dinámico que sigue el ratón (efecto plástico brillante / cristal) */}
          <div
            className="absolute inset-0 pointer-events-none z-30 transition-opacity duration-200"
            style={{
              opacity: brillo.opacidad,
              background: `radial-gradient(circle 180px at ${brillo.x}% ${brillo.y}%, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.1) 45%, transparent 80%)`,
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
