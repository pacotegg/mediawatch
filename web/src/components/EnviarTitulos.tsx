import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from './Controls.tsx';
import { api } from '../lib/api.ts';

/*
 * Enviar a la biblioteca: llevar títulos preparados en la carpeta de entrada (C:\Videos) a la biblioteca que elijas (E:\Películas).
 * Entre discos es una COPIA que se comprueba (por defecto, que cada fichero pese lo mismo; opcionalmente SHA-256 completo); solo si coincide, el título pasa a la otra biblioteca
 * conservando sus datos, y entonces el original se quita de la entrada (traslado); si no, no se toca. Se ve el plan antes de confirmar.
 */
const gb = (n: number) => (n / 1e9).toFixed(1) + ' GB';
const FASES: Record<string, string> = { preparando: 'Preparando', copiando: 'Copiando', verificando: 'Comprobando la copia', actualizando: 'Actualizando la biblioteca', terminando: 'Terminando' };

export default function EnviarTitulos({ ids, kind }: { ids: number[]; kind: 'movie' | 'show' }) {
  const qc = useQueryClient();
  const { data: fuentes } = useQuery({ queryKey: ['scraper-destinos'], queryFn: api.scraperDestinos });
  const destinos = (fuentes ?? []).filter((f) => f.kind === kind);
  const [destino, setDestino] = useState('');
  const [conservar, setConservar] = useState(false);
  const [completa, setCompleta] = useState(false);
  const [error, setError] = useState('');
  const elegido = destino || destinos[0]?.path || '';
  const plan = useQuery({ queryKey: ['scraper-envio-plan', ids.join(','), elegido], queryFn: () => api.scraperEnvioPlan(ids, elegido), enabled: ids.length > 0 && Boolean(elegido), staleTime: 0, retry: false });
  const estado = useQuery({ queryKey: ['scraper-envio'], queryFn: api.scraperEnvio, refetchInterval: (q) => (q.state.data?.corriendo ? 1000 : false), refetchIntervalInBackground: true });
  const enviar = useMutation({
    mutationFn: () => api.scraperEnviar(posibles.map((p) => p.itemId), elegido, !conservar, completa ? 'completa' : 'rapida'),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['scraper-envio'] }); qc.invalidateQueries({ queryKey: ['scraper-lista'] }); qc.invalidateQueries({ queryKey: ['scraper-titulo'] }); },
    onError: (e: Error) => setError(e.message),
  });
  const planes = plan.data?.planes ?? [];
  const posibles = planes.filter((p) => !p.error);
  const bytes = posibles.reduce((s, p) => s + p.bytes, 0);
  const e = estado.data;

  return (
    <div className="space-y-3 text-[12.5px]">
      <label className="flex flex-wrap items-center gap-2 text-mist-400">
        Enviar a la biblioteca:
        <select value={elegido} onChange={(ev) => setDestino(ev.target.value)} className="rounded-xl border border-white/8 bg-white/6 px-3 py-2 text-[13px]">
          {destinos.map((d) => <option key={d.path} value={d.path} className="bg-ink-900">{d.name} · {d.path}</option>)}
        </select>
      </label>
      {destinos.length === 0 && <p className="text-mist-500">No hay ninguna biblioteca de este tipo configurada (Ajustes → Biblioteca → Añadir carpeta).</p>}
      {plan.isLoading && <p className="text-mist-500">Calculando…</p>}
      {planes.length > 0 && (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {planes.map((p) => (
            <li key={p.itemId} className="rounded-lg bg-black/20 px-2.5 py-1.5">
              <span className="font-medium">{p.titulo}</span>{' '}
              {p.error ? <span className="text-red-400">· no se puede: {p.error}</span> : <span className="text-emerald-300">→ {p.destino} · {gb(p.bytes)}{p.mismoDisco ? ' · mismo disco (se mueve al instante)' : ' · se copia y se comprueba'}</span>}
            </li>
          ))}
        </ul>
      )}
      {posibles.length > 0 && (
        <>
          <p className="text-mist-400">En total <b>{gb(bytes)}</b>{posibles[0].libre != null ? <> · libres en el destino: <b>{gb(posibles[0].libre)}</b></> : null}. Se <b>escribe en la biblioteca</b>. Cuando la copia esté comprobada (idéntica al original), <b>el original se quita de la carpeta de entrada</b>: es un traslado.</p>
          <label className="flex items-start gap-2 text-mist-300">
            <input type="checkbox" checked={conservar} onChange={(ev) => setConservar(ev.target.checked)} className="mt-0.5 accent-[var(--color-accent,#7c8cff)]" />
            <span>Conservar una copia de seguridad del original en <span className="text-mist-200">_enviados</span> <span className="text-mist-500">(ocupa espacio en la carpeta de entrada hasta que la borres tú; normalmente no hace falta)</span></span>
          </label>
          <label className="flex items-start gap-2 text-mist-300">
            <input type="checkbox" checked={completa} onChange={(ev) => setCompleta(ev.target.checked)} className="mt-0.5 accent-[var(--color-accent,#7c8cff)]" />
            <span>Comprobación completa <span className="text-mist-500">(vuelve a leer toda la copia y la compara con el original con SHA-256; mucho más lenta, minutos por película grande. Por defecto solo se comprueba que cada fichero pese exactamente lo mismo)</span></span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="danger" onClick={() => enviar.mutate()} disabled={enviar.isPending || Boolean(e?.corriendo)}>
              {e?.corriendo ? `Enviando ${e.hechos + 1}/${e.total}…` : `Sí, enviar ${posibles.length} título${posibles.length === 1 ? '' : 's'}`}
            </Button>
            <span className="text-[11.5px] text-mist-600">Si algo falla o un fichero no pesa lo mismo que el original, el original NO se toca.</span>
          </div>
        </>
      )}
      {e?.corriendo && (
        <div className="space-y-1">
          <div className="text-mist-400">{e.actual} · {FASES[e.fase] ?? e.fase}{e.archivo ? ` · ${e.archivo}` : ''}</div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full bg-accent transition-all" style={{ width: `${e.bytesTotal ? Math.round((100 * e.bytesHechos) / e.bytesTotal) : 0}%` }} /></div>
        </div>
      )}
      {e && !e.corriendo && e.resultados.length > 0 && (
        <ul className="space-y-1">
          {e.resultados.map((r) => <li key={r.itemId} className={r.ok ? 'text-emerald-300' : 'text-red-400'}>{r.ok ? '✓' : '✗'} {r.titulo}{r.ok ? (r.copiado ? ' — copiado y comprobado' : ' — movido') : ` — ${r.error}`}</li>)}
        </ul>
      )}
      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}
