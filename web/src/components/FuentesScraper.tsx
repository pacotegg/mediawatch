import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, TextInput } from './Controls.tsx';
import { api } from '../lib/api.ts';

/*
 * Fuentes del scraper: las carpetas de ENTRADA (p. ej. C:\Videos) de donde eliges qué escrapear. NO son bibliotecas: el escaneo general no las toca,
 * los clientes no ven lo que hay en ellas, y lo que quieras mostrar lo envías a una biblioteca de verdad desde el asistente.
 * Quitar una fuente solo olvida lo que el scraper tenía anotado de ella; los ficheros del disco no se tocan.
 */
export default function FuentesScraper() {
  const qc = useQueryClient();
  const { data: fuentes } = useQuery({ queryKey: ['scraper-fuentes'], queryFn: api.scraperFuentes });
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<'movie' | 'show'>('movie');
  const [actual, setActual] = useState('');
  const [elegida, setElegida] = useState('');
  const [error, setError] = useState('');

  const explorar = useQuery({ queryKey: ['browse-fuentes', actual], queryFn: () => api.systemBrowse(actual || undefined), enabled: abierto });
  const guardar = useMutation({
    mutationFn: (lista: { name: string; path: string; kind: 'movie' | 'show' }[]) => api.scraperGuardarFuentes(lista),
    onSuccess: () => {
      setError(''); setAbierto(false);
      for (const k of ['scraper-fuentes', 'scraper-nuevos-lista', 'scraper-nuevos', 'scraper-lista']) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const actuales = (fuentes ?? []).map((f) => ({ name: f.name, path: f.path, kind: f.kind }));

  return (
    <div className="space-y-4">
      <section className="glass space-y-4 rounded-[var(--radius-panel)] p-5 sm:p-6">
        <div>
          <h3 className="text-[16px] font-semibold tracking-tight">Carpetas de entrada</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-mist-500">
            Aquí van las carpetas donde dejas lo nuevo antes de escrapearlo. <b className="text-mist-300">No son bibliotecas</b>: el escaneo general no las toca y nadie las ve desde la app.
            Lo que quieras mostrar lo envías a una biblioteca desde el asistente, cuando lo hayas escrapeado y confirmado.
          </p>
        </div>

        {(fuentes ?? []).length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/12 px-6 py-9 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-white/6 text-mist-500 ring-1 ring-white/8">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" /></svg>
            </div>
            <p className="text-[14px] font-medium text-mist-200">Aún no hay ninguna carpeta de entrada</p>
            <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-mist-500">Añade, por ejemplo, la carpeta donde descargas o preparas lo nuevo.</p>
          </div>
        )}
        <div className="space-y-1.5">
          {(fuentes ?? []).map((f) => (
            <div key={f.path} className="flex flex-wrap items-center gap-3.5 rounded-2xl bg-white/4 p-3 text-[13px] ring-1 ring-white/6">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent/25 to-accent/5 text-accent-soft ring-1 ring-accent/25">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" /></svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14.5px] font-semibold">{f.name}</span>
                  <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10.5px] font-medium text-mist-300">{f.kind === 'movie' ? 'Películas' : 'Series'}</span>
                  <span className="text-[11.5px] tabular-nums text-mist-500">{f.titulos} anotados</span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[11.5px] text-mist-600">{f.path}</div>
              </div>
              <Button
                variant="ghost"
                disabled={guardar.isPending}
                onClick={() => {
                  if (window.confirm(`¿Quitar «${f.name}» de las fuentes?\n\nSolo se olvida lo que el scraper tenía anotado de esa carpeta (lo escrapeado y aún sin enviar). Los ficheros del disco no se tocan.`)) {
                    guardar.mutate(actuales.filter((a) => a.path !== f.path));
                  }
                }}
              >
                Quitar
              </Button>
            </div>
          ))}
        </div>
        {error && <p className="text-[12.5px] text-red-400">{error}</p>}
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => { setActual(''); setElegida(''); setNombre(''); setError(''); setAbierto(true); }}>+ Añadir carpeta de entrada</Button>
        </div>
      </section>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
          <div className="glass flex max-h-[85vh] w-full max-w-lg flex-col rounded-3xl border border-white/15 bg-ink-900/95 p-6 shadow-[0_40px_90px_-20px_rgb(0_0_0/0.9)]">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-semibold text-white">Añadir carpeta de entrada</h3>
              <button onClick={() => setAbierto(false)} className="rounded-lg p-1 text-mist-400 hover:text-white">✕</button>
            </div>
            <div className="space-y-3 py-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-mist-300">Nombre
                  <TextInput value={nombre} onChange={setNombre} placeholder="Videos, Descargas…" className="mt-1 w-full" />
                </label>
                <label className="block text-xs font-medium text-mist-300">Tipo
                  <select value={tipo} onChange={(e) => setTipo(e.target.value as 'movie' | 'show')} className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white">
                    <option value="movie" className="bg-ink-900">Películas</option>
                    <option value="show" className="bg-ink-900">Series</option>
                  </select>
                </label>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-mist-300">Explorar el servidor:</span>
                  {explorar.data?.parent && <button onClick={() => { setActual(explorar.data!.parent || ''); setElegida(explorar.data!.parent || ''); }} className="text-xs text-accent hover:underline">↑ Subir nivel</button>}
                </div>
                <div className="truncate rounded-xl border border-white/10 bg-black/30 p-2 font-mono text-xs text-mist-300">{elegida || actual || '(raíz del sistema)'}</div>
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2">
                {explorar.isLoading ? <div className="py-4 text-center text-xs text-mist-500">Cargando…</div>
                  : (explorar.data?.dirs ?? []).length > 0 ? explorar.data!.dirs.map((d) => (
                    <div key={d.path} onClick={() => { setActual(d.path); setElegida(d.path); }} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition ${elegida === d.path ? 'bg-accent/20 font-semibold text-accent' : 'text-mist-200 hover:bg-white/5'}`}>
                      <span>📁</span><span className="truncate">{d.name}</span>
                    </div>
                  ))
                  : <div className="py-4 text-center text-xs text-mist-500">No hay subcarpetas aquí.</div>}
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 pt-3">
              <Button variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
              <Button disabled={!elegida || !nombre.trim() || guardar.isPending} onClick={() => guardar.mutate([...actuales, { name: nombre.trim(), path: elegida, kind: tipo }])}>Añadir</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
