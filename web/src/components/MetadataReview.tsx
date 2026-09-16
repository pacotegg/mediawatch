import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Button, Field, Panel, Select, TextInput } from './Controls.tsx';
import { api, img, type Candidate, type Proposal } from '../lib/api.ts';

const CONFIDENCE = {
  exact: { label: 'Coincidencia exacta', tone: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25' },
  strong: { label: 'Probable', tone: 'bg-amber-500/15 text-amber-300 ring-amber-500/25' },
  weak: { label: 'Dudosa · revísala', tone: 'bg-red-500/15 text-red-300 ring-red-500/25' },
} as const;

const FIELD_KEYS: Record<string, string> = {
  póster: 'poster',
  fondo: 'fanart',
  logo: 'logo',
  sinopsis: 'plot',
  valoración: 'rating',
};

const ALL_FIELDS = [
  { key: 'poster', label: 'Póster' },
  { key: 'fanart', label: 'Fondo' },
  { key: 'logo', label: 'Logo' },
  { key: 'plot', label: 'Sinopsis' },
  { key: 'rating', label: 'Valoración' },
  { key: 'genres', label: 'Géneros' },
];

function ProposalCard({ proposal, onPick, picked }: { proposal: Proposal; onPick?: () => void; picked?: boolean }) {
  return (
    <button
      onClick={onPick}
      disabled={!onPick}
      className={`flex w-40 shrink-0 flex-col gap-2 rounded-xl p-2 text-left transition-colors ${onPick ? 'hover:bg-white/8' : ''} ${picked ? 'bg-white/10 ring-1 ring-accent/40' : ''}`}
    >
      <div className="aspect-2/3 w-full overflow-hidden rounded-lg bg-ink-800">
        {proposal.posterUrl ? (
          <img src={proposal.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center px-2 text-center text-[11px] text-mist-600">Sin póster</div>
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[12px] font-medium">{proposal.title}</div>
        <div className="text-[11px] text-mist-600">{proposal.year ?? 's/f'}</div>
      </div>
    </button>
  );
}

export function CandidateRow({
  candidate,
  onDone,
  overwriteMode = false,
}: {
  candidate: Candidate;
  onDone: () => void;
  /** Per-title correction: lets the user pick fields and replace data that already exists. */
  overwriteMode?: boolean;
}) {
  const [chosen, setChosen] = useState<Proposal | null>(candidate.proposal);
  const [searching, setSearching] = useState(overwriteMode);
  const [query, setQuery] = useState(candidate.title);
  const [results, setResults] = useState<Proposal[]>([]);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<string[]>(() =>
    overwriteMode ? candidate.missing.map((m) => FIELD_KEYS[m]).filter(Boolean) : [],
  );

  const confidence = CONFIDENCE[candidate.confidence];

  const search = useMutation({
    mutationFn: () => api.enrichSearch(query, candidate.kind, null),
    onSuccess: (r) => setResults(r.results),
    onError: (err: Error) => setError(err.message),
  });

  const apply = useMutation({
    mutationFn: () =>
      api.enrichApply({
        itemId: candidate.itemId,
        tmdbId: chosen!.tmdbId,
        kind: candidate.kind,
        fields: overwriteMode ? fields : candidate.missing.map((m) => FIELD_KEYS[m]).filter(Boolean),
        overwrite: overwriteMode,
      }),
    onSuccess: onDone,
    onError: (err: Error) => setError(err.message),
  });

  const dismiss = useMutation({ mutationFn: () => api.enrichDismiss(candidate.itemId), onSuccess: onDone });

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="rounded-2xl bg-white/4 p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-20 shrink-0">
          <div className="aspect-2/3 overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/8">
            <img src={img.poster(candidate.itemId, 200)} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.opacity = '0')} />
          </div>
          <div className="mt-1 text-center text-[10px] text-mist-600">actual</div>
        </div>

        <div className="min-w-52 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold">{candidate.title}</span>
            {candidate.year && <span className="text-[12px] text-mist-500">{candidate.year}</span>}
            <span className={`rounded-md px-2 py-0.5 text-[10.5px] font-medium ring-1 ${confidence.tone}`}>{confidence.label}</span>
          </div>
          <div className="mb-2 text-[11.5px] text-mist-600">
            {candidate.libraryName} · emparejado por {candidate.matchedBy}
          </div>
          <div className="mb-3 flex flex-wrap gap-1">
            {candidate.missing.map((m) => (
              <span key={m} className="rounded bg-white/8 px-1.5 py-0.5 text-[10.5px] text-mist-400">falta {m}</span>
            ))}
          </div>

          {chosen ? (
            <div className="rounded-xl bg-black/25 p-3">
              <div className="flex gap-3">
                {chosen.posterUrl && <img src={chosen.posterUrl} alt="" className="h-24 w-16 shrink-0 rounded-md object-cover" />}
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">
                    {chosen.title} {chosen.year ? `(${chosen.year})` : ''}
                  </div>
                  {chosen.originalTitle && chosen.originalTitle !== chosen.title && (
                    <div className="text-[11px] text-mist-600">título original: {chosen.originalTitle}</div>
                  )}
                  {chosen.overview && <p className="mt-1 line-clamp-3 text-[11.5px] leading-relaxed text-mist-500">{chosen.overview}</p>}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-mist-500">Sin propuesta automática. Búscala a mano.</p>
          )}

          {overwriteMode && (
            <div className="mt-3">
              <div className="mb-2 text-[11.5px] text-mist-500">Qué sustituir (lo marcado se sobrescribe aunque ya tenga datos):</div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_FIELDS.map((f) => {
                  const active = fields.includes(f.key);
                  return (
                    <button
                      key={f.key}
                      onClick={() => setFields((current) => (active ? current.filter((k) => k !== f.key) : [...current, f.key]))}
                      className={`rounded-full px-2.5 py-1 text-[11.5px] transition-colors ${
                        active ? 'bg-accent/20 text-accent-soft ring-1 ring-accent/40' : 'bg-white/6 text-mist-400 hover:bg-white/12'
                      }`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && <p className="mt-2 text-[12px] text-red-400">{error}</p>}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => apply.mutate()} disabled={!chosen || apply.isPending || (overwriteMode && fields.length === 0)}>
              {apply.isPending ? 'Guardando…' : overwriteMode ? 'Guardar cambios' : 'Aplicar'}
            </Button>
            <Button variant="ghost" onClick={() => { setSearching((v) => !v); if (!results.length) search.mutate(); }}>
              {overwriteMode ? 'Buscar otra' : 'No es esta'}
            </Button>
            {!overwriteMode && <Button variant="ghost" onClick={() => dismiss.mutate()}>Descartar</Button>}
          </div>

          {searching && (
            <div className="mt-3 rounded-xl bg-black/25 p-3">
              <div className="mb-3 flex gap-2">
                <TextInput value={query} onChange={setQuery} placeholder="Título a buscar" className="flex-1" />
                <Button variant="ghost" onClick={() => search.mutate()} disabled={search.isPending}>Buscar</Button>
              </div>
              {candidate.alternatives.length > 0 && results.length === 0 && (
                <div className="no-scrollbar flex gap-2 overflow-x-auto">
                  {candidate.alternatives.map((p) => (
                    <ProposalCard key={p.tmdbId} proposal={p} picked={chosen?.tmdbId === p.tmdbId} onPick={() => setChosen(p)} />
                  ))}
                </div>
              )}
              {results.length > 0 && (
                <div className="no-scrollbar flex gap-2 overflow-x-auto">
                  {results.map((p) => (
                    <ProposalCard key={p.tmdbId} proposal={p} picked={chosen?.tmdbId === p.tmdbId} onPick={() => setChosen(p)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function MetadataReview() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [limit, setLimit] = useState(25);
  const [message, setMessage] = useState('');

  const { data: status } = useQuery({
    queryKey: ['enrich-status'],
    queryFn: api.enrichStatus,
    refetchInterval: (q) => (q.state.data?.job.running ? 1200 : false),
    // Si se cambia de pestaña a media búsqueda, al volver el contador seguía
    // clavado en «0/25»: el trabajo corre en el servidor, así que se pregunta
    // igual con la pestaña de fondo.
    refetchIntervalInBackground: true,
  });

  const running = status?.job.running ?? false;

  /*
   * Las propuestas se refrescan siguiendo al estado del trabajo, no a si mismas.
   *
   * Antes el intervalo miraba `candidates.running`, que solo se entera si la
   * consulta se ha vuelto a hacer: como lanzar la busqueda no la invalidaba,
   * nunca se repetia, `running` seguia en false para siempre y la lista se
   * quedaba vacia aunque el servidor tuviera diez propuestas esperando. Era el
   * «le doy a buscar y no encuentra nada». Con `finishedAt` en la clave, acabar
   * el trabajo obliga a pedirlas de nuevo.
   */
  const { data: candidates } = useQuery({
    queryKey: ['enrich-candidates', status?.job.finishedAt ?? null],
    queryFn: api.enrichCandidates,
    refetchInterval: running ? 1500 : false,
  });

  const saveKey = useMutation({
    mutationFn: () => api.saveServerSettings({ tmdbApiKey: apiKey.trim() }),
    onSuccess: () => {
      setApiKey('');
      setMessage('Clave guardada.');
      queryClient.invalidateQueries({ queryKey: ['enrich-status'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const scan = useMutation({
    mutationFn: () => api.enrichScan(limit),
    onSuccess: () => {
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['enrich-status'] });
      queryClient.invalidateQueries({ queryKey: ['enrich-candidates'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['enrich-candidates'] });
    queryClient.invalidateQueries({ queryKey: ['enrich-status'] });
    queryClient.invalidateQueries({ queryKey: ['home'] });
  };

  const missing = status?.missing;
  const propuestas = candidates?.candidates ?? [];
  const conPropuesta = propuestas.filter((c) => c.proposal).length;
  const terminado = Boolean(status?.job.finishedAt) && !running;

  return (
    <div className="space-y-5">
      <Panel
        title="Metadatos que faltan"
        subtitle="Nada se guarda solo: cada coincidencia se te propone con su nivel de confianza y decides tú. Una coincidencia equivocada sobrescribiría datos buenos."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {[
            ['Fichas', missing?.total],
            ['Sin póster', missing?.sin_poster],
            ['Sin fondo', missing?.sin_fondo],
            ['Sin logo', missing?.sin_logo],
            ['Sin sinopsis', missing?.sin_sinopsis],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <div className="text-xl font-semibold tabular-nums">{value ?? '—'}</div>
              <div className="text-[11px] text-mist-500">{label}</div>
            </div>
          ))}
        </div>

        {!status?.configured ? (
          <Field label="Clave de API de TMDb" hint="Gratuita en themoviedb.org, con un límite muy alto. Solo se usa cuando pulsas buscar.">
            <div className="flex gap-2">
              <TextInput value={apiKey} onChange={setApiKey} placeholder="Pega aquí la clave" type="password" className="w-56" />
              <Button onClick={() => saveKey.mutate()} disabled={!apiKey.trim()}>Guardar</Button>
            </div>
          </Field>
        ) : (
          <Field label="Cuántas fichas revisar" hint="Empieza con pocas para ver qué tal acierta antes de lanzarte con toda la biblioteca.">
            <div className="flex gap-2">
              <Select value={limit} onChange={setLimit} options={[10, 25, 50, 100, 200].map((v) => ({ value: v, label: `${v} fichas` }))} />
              <Button onClick={() => scan.mutate()} disabled={running}>{running ? `Buscando ${status?.job.done}/${status?.job.total}…` : 'Buscar coincidencias'}</Button>
            </div>
          </Field>
        )}

        {status?.job.error && <p className="text-[13px] text-red-400">{status.job.error}</p>}
        {/* Decir en voz alta lo que ha pasado: el silencio se lee como «no funciona». */}
        {terminado && (
          <p className="text-[13px] text-mist-400">
            {propuestas.length === 0
              ? 'La última búsqueda no devolvió nada. Prueba a revisar más fichas de una vez.'
              : conPropuesta === 0
                ? `Revisadas ${propuestas.length} fichas y ninguna tiene coincidencia en TMDb: suelen ser grabaciones o documentales que no están en su catálogo. Puedes buscarlas a mano desde cada ficha.`
                : `${conPropuesta} de ${propuestas.length} fichas tienen propuesta.`}
          </p>
        )}
        {message && <p className="text-[13px] text-mist-400">{message}</p>}
      </Panel>

      {propuestas.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between px-1">
            <h3 className="text-[15px] font-semibold">Propuestas para revisar ({propuestas.length})</h3>
            <span className="text-[12px] text-mist-600">Aplica una a una</span>
          </div>
          {propuestas.map((candidate) => (
            <CandidateRow key={candidate.itemId} candidate={candidate} onDone={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
