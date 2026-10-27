import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Field, Panel, TextInput } from './Controls.tsx';
import Identificacion from './Identificacion.tsx';
import { api } from '../lib/api.ts';

/*
 * Ajustes del scraper: de dónde saca los datos. La clave de TMDb es lo único imprescindible (las de fanart.tv, TVDB y OMDb mejoran el arte y las
 * valoraciones y se ponen en el servidor). Antes estaba escondida en Ajustes → Metadatos.
 */
export default function AjustesScraper() {
  const qc = useQueryClient();
  const { data: estado } = useQuery({ queryKey: ['enrich-status'], queryFn: api.enrichStatus });
  const [clave, setClave] = useState('');
  const [mensaje, setMensaje] = useState('');
  const guardar = useMutation({
    mutationFn: () => api.saveServerSettings({ tmdbApiKey: clave.trim() }),
    onSuccess: () => { setClave(''); setMensaje('Clave guardada.'); qc.invalidateQueries({ queryKey: ['enrich-status'] }); },
    onError: (e: Error) => setMensaje(e.message),
  });

  return (
    <div className="space-y-5">
      <Panel title="Proveedores de datos" subtitle="Títulos, sinopsis, reparto, estudios, valoraciones y arte salen de TMDb; el arte extra, de fanart.tv y TheTVDB.">
        <div className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-[13.5px] ring-1 ${estado?.configured ? 'bg-emerald-400/8 text-emerald-200 ring-emerald-400/20' : 'bg-red-400/8 text-red-200 ring-red-400/25'}`}>
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${estado?.configured ? 'bg-emerald-400 shadow-[0_0_10px_rgb(52_211_153/0.8)]' : 'bg-red-400 shadow-[0_0_10px_rgb(248_113_113/0.8)]'}`} />
          <span className="font-medium">{estado?.configured ? 'TMDb configurado' : 'Falta la clave de TMDb: sin ella el scraper no puede buscar'}</span>
        </div>
        <Field label={estado?.configured ? 'Cambiar la clave de API de TMDb' : 'Clave de API de TMDb'} hint="Gratuita en themoviedb.org. Solo se usa cuando escrapeas; no se muestra ni se registra en ningún sitio.">
          <div className="flex gap-2">
            <TextInput value={clave} onChange={setClave} placeholder="Pega aquí la clave" type="password" className="w-64" />
            <Button onClick={() => guardar.mutate()} disabled={!clave.trim() || guardar.isPending}>Guardar</Button>
          </div>
        </Field>
        {mensaje && <p className="text-[13px] text-mist-400">{mensaje}</p>}
        <p className="text-[11.5px] leading-relaxed text-mist-600">
          Este producto usa la API de TMDb pero no está avalado ni certificado por TMDb.
        </p>
      </Panel>
      <Identificacion />
    </div>
  );
}
