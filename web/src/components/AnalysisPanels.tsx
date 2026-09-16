import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Field, Panel, Select, TextInput } from './Controls.tsx';
import { api } from '../lib/api.ts';

function DialoguePanel() {
  const queryClient = useQueryClient();
  const [language, setLanguage] = useState('spa');
  const [message, setMessage] = useState('');

  const { data: stats } = useQuery({
    queryKey: ['dialogue-status', language],
    queryFn: () => api.dialogueStatus(language),
    // Mientras indexa, cada segundo para que la barra se mueva; si no, cada cuatro.
    refetchInterval: (q) => (q.state.data?.indexado.enCurso ? 1000 : 4000),
  });

  const index = useMutation({
    mutationFn: (reset: boolean) => api.indexDialogue(language, reset),
    onSuccess: () => {
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['dialogue-status'] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const pending = stats?.pendientes ?? 0;
  const marcha = stats?.indexado;
  const enCurso = marcha?.enCurso ?? false;
  const porcentaje = marcha && marcha.total > 0 ? Math.round((marcha.hechos / marcha.total) * 100) : 0;

  return (
    <Panel
      title="Búsqueda por frase de diálogo"
      subtitle="Indexa los subtítulos para poder buscar «esa peli donde dicen…». Al pulsar un resultado, la película arranca en esa frase."
    >
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{(stats?.frases ?? 0).toLocaleString('es-ES')}</div>
          <div className="text-xs text-mist-500">frases indexadas</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{stats?.ficheros ?? 0}</div>
          <div className="text-xs text-mist-500">ficheros</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{pending > 0 ? pending : 0}</div>
          <div className="text-xs text-mist-500">sin indexar</div>
        </div>
      </div>

      <Field label="Idioma a indexar" hint="Puedes indexar varios idiomas: cada pasada añade los que falten.">
        <div className="flex gap-2">
          <Select
            value={language}
            onChange={setLanguage}
            options={[
              { value: 'spa', label: 'Español' },
              { value: 'eng', label: 'Inglés' },
              { value: 'todos', label: 'Todos' },
            ]}
          />
          <Button onClick={() => index.mutate(false)} disabled={enCurso || pending === 0}>
            {pending === 0 ? 'Nada pendiente' : `Indexar ${pending}`}
          </Button>
          <Button variant="ghost" onClick={() => index.mutate(true)} disabled={enCurso}>Rehacer</Button>
        </div>
      </Field>

      {marcha && (enCurso || marcha.terminadoEn) && (
        <div className="space-y-1.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-600">
            <div
              className={`h-full rounded-full transition-[width] duration-700 ${enCurso ? 'bg-accent' : 'bg-mist-600'}`}
              style={{ width: `${enCurso ? porcentaje : 100}%` }}
            />
          </div>
          <p className="text-[13px] text-mist-400 tabular-nums">
            {enCurso
              ? `Indexando ${marcha.hechos} de ${marcha.total} ficheros · ${marcha.frases.toLocaleString('es-ES')} frases nuevas. Sigue aunque cierres esta página.`
              : marcha.error
                ? `Falló: ${marcha.error}`
                : `Última pasada: ${marcha.hechos} ficheros, ${marcha.frases.toLocaleString('es-ES')} frases nuevas.`}
          </p>
        </div>
      )}

      {message && <p className="text-[13px] text-red-300">{message}</p>}
    </Panel>
  );
}

function SkipPanel() {
  const [showId, setShowId] = useState<number>(0);
  const [kind, setKind] = useState<'cabecera' | 'creditos'>('cabecera');
  const [filter, setFilter] = useState('');

  const { data: shows } = useQuery({
    queryKey: ['shows-for-skip'],
    queryFn: () => api.items({ kind: 'show', limit: 300, sort: 'title' }),
  });

  const { data: status } = useQuery({
    queryKey: ['skip-status'],
    queryFn: api.skipStatus,
    refetchInterval: (q) => (q.state.data?.job.running ? 3000 : 15000),
  });

  const detect = useMutation({ mutationFn: () => api.detectSkips(showId, kind) });

  const matching = (shows?.items ?? []).filter((s) => s.title.toLowerCase().includes(filter.toLowerCase()));
  const running = status?.job.running;

  return (
    <Panel
      title="Saltar cabeceras y créditos"
      subtitle="La cabecera es el único tramo de audio que se repite igual en todos los episodios de una temporada, así que se busca comparando sus huellas acústicas. Hacen falta al menos dos episodios."
    >
      <Field label="Serie" hint="Se analizan todas sus temporadas, una detrás de otra.">
        <div className="flex flex-wrap justify-end gap-2">
          <TextInput value={filter} onChange={setFilter} placeholder="Filtrar" className="w-32" />
          <select
            value={showId}
            onChange={(e) => setShowId(Number(e.target.value))}
            className="max-w-56 rounded-xl border border-white/8 bg-white/6 px-3 py-1.5 text-[13px] text-mist-200 outline-none"
          >
            <option value={0} className="bg-ink-800">Elige una serie…</option>
            {matching.map((s) => (
              <option key={s.id} value={s.id} className="bg-ink-800">
                {s.title}
              </option>
            ))}
          </select>
        </div>
      </Field>

      <Field label="Qué buscar">
        <div className="flex gap-2">
          <Select
            value={kind}
            onChange={setKind}
            options={[
              { value: 'cabecera', label: 'Cabecera' },
              { value: 'creditos', label: 'Créditos finales' },
            ]}
          />
          <Button onClick={() => detect.mutate()} disabled={!showId || running}>
            {running ? 'Analizando…' : 'Detectar'}
          </Button>
        </div>
      </Field>

      {status?.job.running && (
        <p className="text-[13px] text-mist-400">
          Analizando {status.job.showTitle}
          {status.job.season ? `, temporada ${status.job.season}` : ''}… {status.job.found} episodios resueltos.
        </p>
      )}
      {status?.job.error && <p className="text-[13px] text-red-400">{status.job.error}</p>}

      {status && status.shows.length > 0 && (
        <div className="space-y-1.5">
          {status.shows.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-xl bg-white/4 px-3 py-2 text-[13px]">
              <span>{s.title}</span>
              <span className="text-mist-500">
                {s.intros > 0 && `${s.intros} cabeceras`}
                {s.intros > 0 && s.credits > 0 && ' · '}
                {s.credits > 0 && `${s.credits} créditos`}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function TranscribePanel() {
  const [model, setModel] = useState('small');
  const [language, setLanguage] = useState('es');
  const [batch, setBatch] = useState(10);

  const { data: missing } = useQuery({
    queryKey: ['subs-missing'],
    queryFn: () => api.missingSubtitles(60),
    refetchInterval: 20000,
  });

  /*
   * El intervalo depende de `running`, que solo cambia si esta consulta se
   * vuelve a hacer: sin invalidarla al arrancar, se quedaba en `false` para
   * siempre y pulsar «generar» no enseñaba nada. Es el mismo fallo que tenía la
   * pantalla de metadatos.
   */
  const trabajo = useQueryClient();
  const { data: job } = useQuery({
    queryKey: ['transcribe-job'],
    queryFn: api.transcribeJob,
    refetchInterval: (q) => (q.state.data?.running ? 4000 : 20000),
    refetchIntervalInBackground: true,
  });

  const refrescarTrabajo = () => trabajo.invalidateQueries({ queryKey: ['transcribe-job'] });
  const start = useMutation({
    mutationFn: () => api.transcribe({ fileIds: (missing?.files ?? []).slice(0, batch).map((f) => f.id), model, language }),
    onSuccess: refrescarTrabajo,
  });
  const stop = useMutation({ mutationFn: api.stopTranscribe, onSuccess: refrescarTrabajo });

  // Con el modelo equilibrado va a ~9,6x el tiempo real, medido en este equipo.
  const horasPendientes = missing?.stats.horas ?? 0;
  const estimacion = Math.round((horasPendientes / 9.6) * 10) / 10;

  return (
    <Panel
      title="Subtítulos generados por IA"
      subtitle="Solo para los ficheros que no tienen ningún subtítulo. Transcribe lo que se habla: no traduce, así que de un audio inglés salen subtítulos en inglés."
    >
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{missing?.stats.ficheros ?? 0}</div>
          <div className="text-xs text-mist-500">sin subtítulos</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{horasPendientes}</div>
          <div className="text-xs text-mist-500">horas de vídeo</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{estimacion}</div>
          <div className="text-xs text-mist-500">horas de proceso</div>
        </div>
      </div>

      <Field
        label="Calidad"
        hint="«Equilibrado» es la buena opción: va a 9,6 veces el tiempo real y acierta. «Preciso» va a 0,9x —más lento que la propia película— y apenas mejora."
      >
        <Select
          value={model}
          onChange={setModel}
          options={[
            { value: 'small', label: 'Equilibrado (recomendado)' },
            { value: 'medium', label: 'Preciso · 10 veces más lento' },
          ]}
        />
      </Field>

      <Field label="Idioma del audio">
        <Select
          value={language}
          onChange={setLanguage}
          options={[
            { value: 'es', label: 'Pista española' },
            { value: 'en', label: 'Pista inglesa' },
            { value: '', label: 'La primera que haya' },
          ]}
        />
      </Field>

      <Field label="Cuántos procesar" hint="Van de uno en uno, empezando por los más cortos. Puedes parar cuando quieras.">
        <div className="flex gap-2">
          <Select value={batch} onChange={setBatch} options={[1, 5, 10, 25, 60].map((v) => ({ value: v, label: `${v}` }))} />
          <Button onClick={() => start.mutate()} disabled={job?.running || !missing?.files.length}>
            {job?.running ? 'Transcribiendo…' : 'Generar'}
          </Button>
          {job?.running && (
            <Button variant="ghost" onClick={() => stop.mutate()}>
              Parar tras este
            </Button>
          )}
        </div>
      </Field>

      {job && (job.running || job.log.length > 0) && (
        <div className="rounded-xl bg-black/40 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="font-medium">{job.title || 'Sin trabajo'}</span>
            {job.running && <span className="h-3 w-3 animate-spin rounded-full border border-white/25 border-t-white/90" />}
            {(job.done > 0 || job.failed > 0) && (
              <span className="text-mist-400">
                {job.done} hechos{job.failed ? `, ${job.failed} sin diálogo o fallidos` : ''}
                {job.queue.length ? ` · ${job.queue.length} en cola` : ''}
              </span>
            )}
            {job.result && <span className="text-emerald-400">{job.result.frases} frases ({job.result.idioma})</span>}
            {job.error && <span className="text-amber-400">{job.error}</span>}
          </div>
          <pre className="max-h-48 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-mist-500">
            {job.log.slice(-20).join('\n')}
          </pre>
        </div>
      )}

      {missing && missing.files.length > 0 && !job?.running && (
        <div className="max-h-52 space-y-1 overflow-y-auto">
          {missing.files.slice(0, batch).map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded-lg bg-white/4 px-3 py-1.5 text-[12px]">
              <span className="truncate">
                {f.title}
                {f.season ? ` · T${f.season}E${f.episode}` : ''}
              </span>
              <span className="shrink-0 text-mist-600">{Math.round((f.duration ?? 0) / 60)} min</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export default function AnalysisPanels() {
  return (
    <div className="space-y-5">
      <DialoguePanel />
      <SkipPanel />
      <TranscribePanel />
    </div>
  );
}
