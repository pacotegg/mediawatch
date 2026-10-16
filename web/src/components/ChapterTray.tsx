import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { clock } from '../lib/format.ts';
import { trickplaySheet, type Trickplay } from '../lib/api.ts';
import { tileCoordinates } from '../lib/trickplay.ts';

export type Chapter = {
  title: string;
  start: number;
  end: number;
};

export type ChapterTrayProps = {
  chapters: Chapter[];
  currentTime: number;
  duration: number;
  trickplay?: Trickplay | null;
  fileId: number;
  onSelect: (time: number) => void;
  onClose: () => void;
};

export function ChapterTray({
  chapters,
  currentTime,
  trickplay,
  fileId,
  onSelect,
  onClose,
}: ChapterTrayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeCardRef = useRef<HTMLButtonElement>(null);

  // Determinar índice del capítulo en reproducción
  let activeIndex = 0;
  for (let i = 0; i < chapters.length; i++) {
    if (currentTime >= chapters[i].start) {
      activeIndex = i;
    }
  }

  // Centrar el capítulo activo al abrir
  useEffect(() => {
    if (activeCardRef.current) {
      activeCardRef.current.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    }
  }, []);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const offset = direction === 'left' ? -380 : 380;
      scrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  const activeChapter = chapters[activeIndex];

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 15 }}
      transition={{ duration: 0.2 }}
      className="pointer-events-auto relative mb-3 w-full rounded-2xl border border-white/10 bg-[#0c0d12]/90 p-4 shadow-2xl backdrop-blur-2xl"
    >
      {/* Cabecera del carrusel */}
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/20 text-accent">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16M4 12h16M4 18h12" />
            </svg>
          </div>
          <div className="flex items-baseline gap-2 min-w-0">
            <h3 className="text-sm font-semibold tracking-wide text-white">Capítulos</h3>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-mist-300">
              {chapters.length}
            </span>
            {activeChapter && (
              <span className="hidden truncate text-xs text-mist-400 sm:inline">
                · Ahora: <strong className="text-white">{activeChapter.title || `Capítulo ${activeIndex + 1}`}</strong>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => scroll('left')}
            className="grid h-7 w-7 place-items-center rounded-lg bg-white/5 text-mist-300 transition-colors hover:bg-white/15 hover:text-white"
            title="Desplazar a la izquierda"
          >
            ‹
          </button>
          <button
            onClick={() => scroll('right')}
            className="grid h-7 w-7 place-items-center rounded-lg bg-white/5 text-mist-300 transition-colors hover:bg-white/15 hover:text-white"
            title="Desplazar a la derecha"
          >
            ›
          </button>
          <button
            onClick={onClose}
            className="ml-1 grid h-7 w-7 place-items-center rounded-lg text-mist-400 transition-colors hover:bg-white/10 hover:text-white"
            title="Cerrar capítulos"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Carrusel horizontal de tarjetas */}
      <div
        ref={scrollRef}
        className="flex gap-3.5 overflow-x-auto pb-1 pt-0.5 scroll-smooth snap-x snap-mandatory scrollbar-none"
      >
        {chapters.map((ch, idx) => {
          const isActive = idx === activeIndex;
          const chapterDuration = Math.max(0, ch.end - ch.start);
          const elapsedInChapter = Math.max(0, currentTime - ch.start);
          const progressPct = chapterDuration > 0
            ? Math.min(100, Math.max(0, (elapsedInChapter / chapterDuration) * 100))
            : 0;

          // Fotograma de trickplay
          let bgStyle = {};
          if (trickplay && trickplay.times.length > 0) {
            const coord = tileCoordinates(
              trickplay.times,
              ch.start,
              trickplay.columns,
              trickplay.rows,
            );
            bgStyle = {
              backgroundImage: `url(${trickplaySheet(fileId, coord.sheet)})`,
              backgroundSize: `${trickplay.columns * 100}% ${trickplay.rows * 100}%`,
              backgroundPosition: `${coord.percentX}% ${coord.percentY}%`,
            };
          }

          return (
            <button
              key={idx}
              ref={isActive ? activeCardRef : null}
              onClick={() => onSelect(ch.start)}
              className="group relative flex w-48 shrink-0 snap-start flex-col text-left focus:outline-none sm:w-56"
            >
              {/* Marco de miniatura 16:9 */}
              <div
                className={`relative aspect-video w-full overflow-hidden rounded-xl border transition-all duration-200 ${
                  isActive
                    ? 'border-accent shadow-[0_0_16px_rgba(59,130,246,0.4)] ring-2 ring-accent/50'
                    : 'border-white/10 bg-white/5 group-hover:scale-[1.03] group-hover:border-white/30'
                }`}
              >
                {trickplay && trickplay.times.length > 0 ? (
                  <div className="h-full w-full bg-cover" style={bgStyle} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1a1b26] to-[#0d0e14] text-mist-500">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="m10 9 5 3-5 3V9z" />
                    </svg>
                  </div>
                )}

                {/* Insignia activa «En reproducción» */}
                {isActive && (
                  <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white shadow-lg backdrop-blur-sm">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                    EN REPRODUCCIÓN
                  </div>
                )}

                {/* Duración del capítulo */}
                {chapterDuration > 0 && (
                  <div className="absolute bottom-1.5 left-2 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] text-mist-300 backdrop-blur-sm">
                    {clock(chapterDuration)}
                  </div>
                )}

                {/* Hora de inicio */}
                <div className="absolute bottom-1.5 right-2 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white backdrop-blur-sm">
                  {clock(ch.start)}
                </div>

                {/* Barra de progreso interior del capítulo activo */}
                {isActive && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Rótulo y minutaje */}
              <div className="mt-2 min-w-0 px-0.5">
                <div className="truncate text-xs font-medium text-white transition-colors group-hover:text-accent">
                  {ch.title || `Capítulo ${idx + 1}`}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-mist-400">
                  {clock(ch.start)} – {clock(ch.end)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
