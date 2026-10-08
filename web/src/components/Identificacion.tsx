import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Panel, Select } from './Controls.tsx';
import { api } from '../lib/api.ts';

const CATEGORIAS = [
  { value: 'TP', label: 'Todos los públicos' },
  { value: '7', label: '+7' },
  { value: '12', label: '+12' },
  { value: '16', label: '+16' },
  { value: '18', label: '+18' },
];

/**
 * Estado de la identificación automática y los avisos para el administrador.
 * Solo aparece en MediaWatch Server (modo portable): en el servidor original
 * los metadatos vienen de los .nfo y esto no existe.
 */
export function useIdentificarEstado() {
  return useQuery({
    queryKey: ['identificar-estado'],
    queryFn: api.identificarEstado,
    // Un 403 (perfil sin permisos) no se reintenta ni se repinta.
    retry: false,
    refetchInterval: (q) => (q.state.data?.enCurso ? 2000 : false),
    refetchIntervalInBackground: true,
  });
}

function FilaSinClasificar({ id, title, year }: { id: number; title: string; year: number | null }) {
  const queryClient = useQueryClient();
  const [categoria, setCategoria] = useState('12');
  const [error, setError] = useState('');
  const guardar = useMutation({
    mutationFn: () => api.identificarClasificacion(id, categoria),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['identificar-estado'] }),
    onError: (e: Error) => setError(e.message),
  });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 py-2 first:border-t-0">
      <div className="min-w-0 text-[13px] text-mist-200">
        {title}
        {year ? <span className="text-mist-500"> ({year})</span> : null}
        {error && <span className="ml-2 text-red-300">{error}</span>}
      </div>
      <div className="flex items-center gap-2">
        <Select value={categoria} onChange={setCategoria} options={CATEGORIAS} />
        <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>Guardar</Button>
      </div>
    </div>
  );
}

export default function Identificacion() {
  const queryClient = useQueryClient();
  const { data } = useIdentificarEstado();
  const [mensaje, setMensaje] = useState('');

  const ejecutar = useMutation({
    mutationFn: api.identificarEjecutar,
    onSuccess: (r) => {
      setMensaje(r.arrancado ? '' : (r.motivo ?? 'No se pudo arrancar.'));
      queryClient.invalidateQueries({ queryKey: ['identificar-estado'] });
    },
    onError: (e: Error) => setMensaje(e.message),
  });

  if (!data?.portable) return null;

  return (
    <>
      <Panel
        title="Identificación automática"
        subtitle="Tras cada escaneo, MediaWatch Server busca en TMDb cada título por su nombre. Si la coincidencia es segura la aplica sola (carátulas, sinopsis, clasificación…); si hay duda, no toca nada y lo deja para que lo revises abajo. Nunca cambia ni borra tus carpetas."
      >
        <div className="grid grid-cols-3 gap-4">
          {[
            ['Identificados', data.identificados],
            ['Pendientes', data.pendientes],
            ['Dudosos', data.dudosos],
          ].map(([etiqueta, valor]) => (
            <div key={String(etiqueta)}>
              <div className="text-xl font-semibold tabular-nums">{valor}</div>
              <div className="text-[11px] text-mist-500">{etiqueta}</div>
            </div>
          ))}
        </div>
        {!data.configurada ? (
          <p className="text-[13px] text-amber-300">
            Falta la clave de API de TMDb (gratuita en themoviedb.org). Sin ella no hay identificación automática: pégala más abajo, en «Metadatos que faltan».
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <Button onClick={() => ejecutar.mutate()} disabled={data.enCurso || ejecutar.isPending}>
              {data.enCurso ? 'Identificando…' : 'Identificar ahora'}
            </Button>
            {mensaje && <span className="text-[13px] text-red-300">{mensaje}</span>}
          </div>
        )}
        {data.dudosos > 0 && (
          <p className="text-[13px] text-mist-400">
            Los {data.dudosos} dudosos aparecen en la revisión de abajo («Buscar coincidencias»). Un nombre con el año, como «Blade Runner (1982)», se identifica mucho mejor.
          </p>
        )}
      </Panel>

      {data.sinClasificar.length > 0 && (
        <Panel
          title="Sin clasificación por edades"
          subtitle="TMDb no tiene la clasificación de estos títulos para tu país. Hasta que la elijas, solo los ven los perfiles de adultos."
        >
          {data.sinClasificar.map((t) => (
            <FilaSinClasificar key={t.id} id={t.id} title={t.title} year={t.year} />
          ))}
        </Panel>
      )}
    </>
  );
}
