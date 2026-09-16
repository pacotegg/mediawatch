import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Panel } from './Controls.tsx';
import { api, img, type Aparato } from '../lib/api.ts';

/** «hace 3 min», «hace 2 h», «ahora». */
function hace(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'ahora';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

function reloj(seg: number): string {
  const t = Math.max(0, Math.floor(seg));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

const MODO: Record<string, string> = {
  raw: 'directo',
  direct: 'directo',
  remux: 'reempaquetando',
  'remux-audio': 'convirtiendo el audio',
  transcode: 'transcodificando',
};

/**
 * Quién está conectado y qué ve cada aparato, con mensaje y parar. Lo de
 * Plex. Se refresca cada cinco segundos, que es lo que tardan los
 * reproductores en informar y en recoger los avisos.
 */
export default function Actividad() {
  const queryClient = useQueryClient();
  const [mensajePara, setMensajePara] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [nota, setNota] = useState('');

  const { data: aparatos } = useQuery({ queryKey: ['actividad'], queryFn: api.actividad, refetchInterval: 5000 });

  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['actividad'] });
  const enviar = useMutation({
    mutationFn: ({ sesion, texto }: { sesion: string; texto: string }) => api.actividadMensaje(sesion, texto),
    onSuccess: () => { setNota('Mensaje enviado: le llega en cinco segundos como mucho.'); setMensajePara(null); setTexto(''); },
    onError: (e: Error) => setNota(e.message),
  });
  const parar = useMutation({ mutationFn: (sesion: string) => api.actividadParar(sesion), onSuccess: () => { setNota('Parado.'); refrescar(); }, onError: (e: Error) => setNota(e.message) });
  const cerrar = useMutation({ mutationFn: (sesion: string) => api.actividadCerrar(sesion), onSuccess: () => { setNota('Sesión cerrada: tendrá que volver a entrar.'); refrescar(); }, onError: (e: Error) => setNota(e.message) });

  const viendo = (aparatos ?? []).filter((a) => a.viendo);
  const resto = (aparatos ?? []).filter((a) => !a.viendo);

  const Fila = ({ a }: { a: Aparato }) => (
    <div className="flex flex-col gap-3 rounded-2xl bg-white/4 p-4 ring-1 ring-white/6">
      <div className="flex items-start gap-4">
        {a.viendo && (
          <img src={img.poster(a.viendo.itemId, 120)} alt="" className="h-20 w-14 shrink-0 rounded-md object-cover bg-ink-700" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold text-mist-100">{a.usuario}</span>
            <span className="text-[12px] text-mist-500">{a.dispositivo ?? 'aparato'} · {a.sesion} · {hace(a.ultimaVez)}</span>
            {a.esAdmin === 1 && <span className="text-[11px] text-mist-500">administrador</span>}
          </div>
          {a.viendo ? (
            <>
              <div className="mt-1 truncate text-[14px] text-mist-200">
                {a.viendo.titulo}
                {a.viendo.episodio && <span className="text-mist-400"> · {a.viendo.episodio}</span>}
              </div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-ink-600">
                <div className="h-full rounded-full bg-accent" style={{ width: `${a.viendo.duracion ? Math.min(100, (a.viendo.posicion / a.viendo.duracion) * 100) : 0}%` }} />
              </div>
              <div className="mt-1 text-[12px] text-mist-500 tabular-nums">
                {reloj(a.viendo.posicion)}{a.viendo.duracion ? ` / ${reloj(a.viendo.duracion)}` : ''} · {MODO[a.viendo.modo ?? ''] ?? a.viendo.modo ?? '—'} · {a.viendo.cliente ?? ''}
              </div>
            </>
          ) : (
            <div className="mt-1 text-[13px] text-mist-500">Sin reproducir nada</div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => { setMensajePara(a.sesion); setTexto(''); }}>Mensaje</Button>
        {a.viendo && <Button variant="danger" onClick={() => parar.mutate(a.sesion)}>Parar reproducción</Button>}
        <Button variant="ghost" onClick={() => cerrar.mutate(a.sesion)}>Cerrar sesión</Button>
      </div>
      {mensajePara === a.sesion && (
        <div className="flex gap-2">
          <input
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && texto.trim()) enviar.mutate({ sesion: a.sesion, texto: texto.trim() }); }}
            placeholder="Escribe el mensaje…"
            className="flex-1 rounded-xl bg-white/6 px-4 py-2 text-[14px] outline-none ring-1 ring-white/10 focus:ring-white/25"
          />
          <Button onClick={() => texto.trim() && enviar.mutate({ sesion: a.sesion, texto: texto.trim() })} disabled={!texto.trim()}>Enviar</Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <Panel title="Viendo ahora" subtitle={viendo.length ? `${viendo.length} ${viendo.length === 1 ? 'aparato' : 'aparatos'} reproduciendo` : 'Nadie está viendo nada ahora mismo.'}>
        <div className="space-y-3">{viendo.map((a) => <Fila key={a.sesion} a={a} />)}</div>
      </Panel>
      <Panel title="Conectados" subtitle="Aparatos con sesión que han hablado con el servidor en las últimas 24 horas.">
        <div className="space-y-3">
          {resto.map((a) => <Fila key={a.sesion} a={a} />)}
          {resto.length === 0 && <p className="text-[13px] text-mist-500">Ninguno.</p>}
        </div>
      </Panel>
      {nota && <p className="text-[13px] text-mist-400">{nota}</p>}
    </div>
  );
}
