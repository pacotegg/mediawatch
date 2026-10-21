import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { img, type ItemDetail } from '../lib/api.ts';
import { audioLabel } from '../lib/format.ts';

interface ModalColeccionistaProps {
  item: ItemDetail;
  es4k?: boolean;
  onClose: () => void;
}

export default function ModalColeccionista({ item, es4k = false, onClose }: ModalColeccionistaProps) {
  const [abierto, setAbierto] = useState(false);
  // Apertura terminada (tapa y disco en su sitio): arranca el movimiento de reposo.
  const [reposo, setReposo] = useState(false);
  const [rotY, setRotY] = useState(-6);
  const [rotX, setRotX] = useState(2);
  const escenarioRef = useRef<HTMLDivElement>(null);

  // Cerrar con Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Apertura cinemática inicial de la tapa (1,6 s) y del disco (de 0,65 s a 1,75 s); a los 2 s, reposo. Ver styles.css.
  useEffect(() => {
    const t = window.setTimeout(() => setAbierto(true), 120);
    const r = window.setTimeout(() => setReposo(true), 2120);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(r);
    };
  }, []);

  // Inclinación 3D fluida siguiendo el ratón
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!abierto) return;
    const { innerWidth, innerHeight } = window;
    const xRel = (e.clientX / innerWidth - 0.5) * 2; // -1 a 1
    const yRel = (e.clientY / innerHeight - 0.5) * 2; // -1 a 1

    setRotY(Math.round(xRel * 18));
    setRotX(Math.round(-yRel * 8));
  };

  // Metadatos y ficha técnica para el libreto interior
  const nombresDe = (rolRegex: RegExp, tope: number) =>
    (item.cast || [])
      .filter((p) => rolRegex.test(p.role || ''))
      .slice(0, tope)
      .map((p) => p.name)
      .join(', ');

  const direccion = nombresDe(/director/i, 2);
  const reparto = nombresDe(/actor|actress/i, 6) || (item.cast || []).slice(0, 6).map((p) => p.name).join(', ');
  const generos = (item.genres || []).slice(0, 3).join(', ');

  const mejorFichero = (item.files || [])
    .filter((f) => f.height)
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0];

  const textoVideo = mejorFichero
    ? `${mejorFichero.width || '?'}×${mejorFichero.height} ${mejorFichero.video_codec ? mejorFichero.video_codec.toUpperCase() : ''}${mejorFichero.hdr ? ` · ${mejorFichero.hdr}` : ''}`
    : '';

  const audios = mejorFichero?.audio || [];
  const textoAudio = audios.length
    ? audios.slice(0, 2).map((a) => audioLabel(a.codec, a.channels)).join(' · ')
    : 'Stereo';

  const horas = item.runtime ? Math.floor(item.runtime / 60) : 0;
  const minutos = item.runtime ? Math.round(item.runtime % 60) : 0;
  const textoDuracion = horas > 0 ? `${horas} h ${minutos} min` : minutos > 0 ? `${minutos} min` : '';

  // Chips de calidad al pie
  const chips: string[] = [];
  chips.push(es4k ? '4K ULTRA HD' : 'BLU-RAY 1080P');
  if (mejorFichero?.hdr) chips.push(mejorFichero.hdr);
  if (audios.some((a) => /atmos/i.test(a.codec) || a.channels === 8)) chips.push('DOLBY ATMOS');
  else if (audios.some((a) => /truehd/i.test(a.codec))) chips.push('TRUEHD');
  else if (audios.some((a) => /dts/i.test(a.codec))) chips.push('DTS-HD');
  else if (audios.some((a) => (a.channels || 0) >= 6)) chips.push('5.1 SURROUND');
  if (textoDuracion) chips.push(textoDuracion);

  const posterSrc = img.poster(item.id, 1000, item.arte_actualizado);
  const fondoSrc = item.has_fanart ? img.fanart(item.id, 1920, item.arte_actualizado) : null;
  const discartSrc = item.has_discart === 1 ? img.discart(item.id, 800, item.arte_actualizado) : null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/92 p-4 select-none backdrop-blur-md animar-siempre"
        onMouseMove={handleMouseMove}
        onClick={onClose}
      >
        {/* Fondo cinemático de fanart con atmósfera oscura */}
        {fondoSrc && (
          <img
            src={fondoSrc}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-18 blur-md pointer-events-none"
          />
        )}

        {/* Botón cerrar */}
        <button
          onClick={onClose}
          aria-label="Cerrar edición física"
          className="absolute top-6 right-6 z-50 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/80 transition-transform duration-200 hover:scale-110 hover:bg-white/20 active:scale-95"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* ============================================================== */}
        {/* ESCENARIO 3D INTERACTIVO                                       */}
        {/* ============================================================== */}
        <div
          ref={escenarioRef}
          onClick={(e) => e.stopPropagation()}
          className="relative flex items-center justify-center pt-2 pb-6 max-w-full max-h-[82vh]"
          style={{ perspective: '1800px' }}
        >
          <div
            className="relative will-change-transform"
            style={{
              transformStyle: 'preserve-3d',
              transform: `rotateY(${rotY}deg) rotateX(${rotX}deg)`,
              // Siguiendo al ratón con frenada larga: con 0,2 s la caja daba saltitos.
              transition: 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
          {/* Cerrada, la caja es solo la hoja derecha: se centra corriendo el libro media hoja a la izquierda. */}
          <div
            style={{
              transformStyle: 'preserve-3d',
              transform: abierto ? 'translateX(0)' : 'translateX(calc(-25% - 3.5px))',
              transition: 'transform 1.6s cubic-bezier(0.45, 0.05, 0.55, 0.95)',
            }}
          >
          <div
            className={`coleccionista-flotar-web relative flex items-stretch ${reposo ? 'reposo' : ''}`}
            style={{ transformStyle: 'preserve-3d' }}
          >
            {/* ========================================================== */}
            {/* HOJA IZQUIERDA: TAPA QUE GIRA TIPO LIBRO (2 CARAS)         */}
            {/* ========================================================== */}
            <div
              className={`coleccionista-tapa-web relative w-[280px] h-[410px] sm:w-[340px] sm:h-[500px] md:w-[380px] md:h-[550px] ${abierto ? 'abriendo' : ''}`}
              style={{
                transformStyle: 'preserve-3d',
                transformOrigin: 'calc(100% + 7px) center',
              }}
            >
              {/* CARA EXTERIOR (Carátula física 4K / Blu-ray) - visible cuando la caja está cerrada */}
              <div
                className="absolute inset-0 rounded-[10px] overflow-hidden border border-white/25 bg-ink-950 shadow-[0_24px_50px_rgba(0,0,0,0.9)]"
                style={{
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)',
                }}
              >
                {/* Cabecera superior metalizada con relieve */}
                <div
                  className={`h-7 px-3.5 flex items-center justify-between border-b ${
                    es4k
                      ? 'bg-zinc-950/95 border-amber-400/60 text-amber-300'
                      : 'bg-gradient-to-b from-sky-400/50 to-sky-600/30 border-white/30 text-white'
                  }`}
                >
                  <span className="text-[10px] font-black tracking-widest uppercase drop-shadow">
                    {es4k ? '4K ULTRA HD' : 'BLU-RAY DISC'}
                  </span>
                  <div className="w-10 h-1.5 rounded-full bg-white/30 shadow-inner" />
                </div>

                {/* Póster de alta resolución */}
                <img
                  src={posterSrc}
                  alt={item.title}
                  className="w-full h-[calc(100%-28px)] object-cover"
                />

                {/* Reflejo y brillo de metacrilato */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.04) 45%, transparent 60%, rgba(0,0,0,0.35) 100%)',
                  }}
                />
              </div>

              {/* CARA INTERIOR (Libreto físico de coleccionista con fondo editorial) - visible cuando la caja está abierta */}
              <div
                className="absolute inset-0 rounded-[10px] overflow-hidden border border-white/20 bg-[#0d0f14] p-5 sm:p-7 flex flex-col justify-between text-white shadow-[inset_0_2px_20px_rgba(0,0,0,0.8)]"
                style={{
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden',
                  transform: 'rotateY(0deg)',
                }}
              >
                <div>
                  {/* Encabezado editorial */}
                  <div className="flex items-center justify-between border-b border-white/15 pb-2.5 mb-3 text-[10px] font-black tracking-widest text-white/55">
                    <span>TVWATCH ARCHIVE</span>
                    <span>{item.year || ''}</span>
                  </div>

                  <h3 className="text-lg sm:text-xl font-bold tracking-tight text-white mb-3 line-clamp-2 drop-shadow">
                    {item.title}
                  </h3>

                  {item.tagline && (
                    <p className="mb-2 text-xs italic text-mist-100 border-l-2 border-[#e2b755] pl-2 line-clamp-2">
                      «{item.tagline}»
                    </p>
                  )}

                  {/* Ficha artística */}
                  <div className="space-y-1.5 text-xs text-mist-300">
                    {direccion && (
                      <p className="line-clamp-1">
                        <strong className="text-white/80 font-semibold mr-1.5">Dirección:</strong>
                        {direccion}
                      </p>
                    )}
                    {reparto && (
                      <p className="line-clamp-2">
                        <strong className="text-white/80 font-semibold mr-1.5">Reparto:</strong>
                        {reparto}
                      </p>
                    )}
                    {generos && (
                      <p className="line-clamp-1">
                        <strong className="text-white/80 font-semibold mr-1.5">Género:</strong>
                        {generos}
                      </p>
                    )}
                    {item.studio && (
                      <p className="line-clamp-1">
                        <strong className="text-white/80 font-semibold mr-1.5">Estudio:</strong>
                        {item.studio}
                      </p>
                    )}
                  </div>
                </div>

                {/* Ficha técnica al pie del libreto */}
                <div className="rounded-lg bg-white/5 border border-white/10 p-2.5 sm:p-3 text-[10.5px] sm:text-[11.5px] text-mist-300 space-y-1 mt-3">
                  {textoVideo && (
                    <div className="flex justify-between">
                      <span className="text-white/60">Vídeo</span>
                      <span className="font-medium text-white/95">{textoVideo}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-white/60">Audio</span>
                    <span className="font-medium text-white/95">{textoAudio}</span>
                  </div>
                  {textoDuracion && (
                    <div className="flex justify-between">
                      <span className="text-white/60">Duración</span>
                      <span className="font-medium text-white/95">{textoDuracion}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ========================================================== */}
            {/* BISAGRA CENTRAL DEL ESTUCHE                                */}
            {/* ========================================================== */}
            <div
              className="w-3.5 sm:w-4 bg-gradient-to-r from-zinc-800 via-zinc-700 to-zinc-900 border-y border-white/20 shadow-inner"
              style={{
                boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)',
              }}
            />

            {/* ========================================================== */}
            {/* HOJA DERECHA: BANDEJA INTERIOR CON DISCO ÓPTICO GIRATORIO  */}
            {/* ========================================================== */}
            <div
              className="relative w-[280px] h-[410px] sm:w-[340px] sm:h-[500px] md:w-[380px] md:h-[550px] rounded-[10px] overflow-hidden border border-white/25 bg-[#08090d] shadow-[0_24px_50px_rgba(0,0,0,0.9)] flex items-center justify-center p-6"
              style={{
                transform: 'translateZ(1px)',
              }}
            >
              {/* Fondo de bandeja oscurecido */}
              {fondoSrc && (
                <img
                  src={fondoSrc}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-12 blur-xs pointer-events-none"
                />
              )}

              {/* Hendidura circular de sujeción del disco */}
              <div className="absolute w-[240px] h-[240px] sm:w-[290px] sm:h-[290px] md:w-[330px] md:h-[330px] rounded-full border-2 border-white/10 bg-black/40 shadow-inner" />

              {/* ======================================================== */}
              {/* DISCO ÓPTICO (DISCART)                                    */}
              {/* ======================================================== */}
              <div
                className="relative w-[230px] h-[230px] sm:w-[280px] sm:h-[280px] md:w-[320px] md:h-[320px] rounded-full overflow-hidden shadow-[0_12px_35px_rgba(0,0,0,0.9)]"
                style={{
                  // Quieto mientras la tapa lo cubre; al abrirse se asienta con un cuarto de vuelta (0,65 s) y se queda recto, en su posición natural. Sin giro en reposo.
                  transform: abierto ? 'rotate(0deg) scale(1)' : 'rotate(-75deg) scale(0.94)',
                  transition: 'transform 1.1s cubic-bezier(0.22, 1, 0.36, 1) 0.65s',
                }}
              >
                <div className="absolute inset-0">
                {discartSrc ? (
                  <img
                    src={discartSrc}
                    alt="Disco serigrafiado"
                    className="w-full h-full object-contain rounded-full"
                  />
                ) : (
                  /* Fallback serigrafiado de lujo si no hay discart */
                  <div className="w-full h-full rounded-full bg-gradient-to-tr from-zinc-950 via-zinc-800 to-zinc-950 flex flex-col items-center justify-between p-6 sm:p-8 text-center shadow-inner">
                    <span className="text-[10px] sm:text-xs font-black tracking-widest text-white/55 uppercase">
                      {es4k ? '4K Ultra HD Blu-ray' : 'Blu-ray Disc'}
                    </span>
                    <span className="text-sm sm:text-base font-bold text-white/95 max-w-[180px] truncate drop-shadow">
                      {item.title}
                    </span>
                    <span className="text-[9px] sm:text-[10px] font-semibold tracking-wider text-amber-400/80 uppercase">
                      Collector Edition
                    </span>
                  </div>
                )}
                </div>

              </div>

              {/* Pivote central plástico de la bandeja */}
              <div className="absolute w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-gradient-to-b from-white/30 to-black/80 border border-white/40 shadow-md pointer-events-none" />
            </div>
          </div>
          </div>
          </div>
        </div>

        {/* ============================================================== */}
        {/* BARRA INFERIOR DE CHIPS TÉCNICOS Y AYUDA                       */}
        {/* ============================================================== */}
        <div className="mt-4 flex flex-col items-center gap-2.5 z-50">
          <div className="flex flex-wrap items-center justify-center gap-2">
            {chips.map((c, i) => (
              <span
                key={i}
                className={`rounded-full px-3 py-1 text-xs font-semibold tracking-wide ${
                  c.indexOf('4K') >= 0
                    ? 'bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/40 shadow-sm'
                    : 'bg-white/10 text-white/90 ring-1 ring-white/15'
                }`}
              >
                {c}
              </span>
            ))}
          </div>
          <p className="text-[11.5px] text-mist-400 tracking-wide text-center">
            Mueve el ratón para inclinar en 3D · Haz clic o pulsa Esc para cerrar
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
