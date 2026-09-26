import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Button, Field, Panel, Select, Slider, TextInput, Toggle } from '../components/Controls.tsx';
import AnalysisPanels from '../components/AnalysisPanels.tsx';
import MetadataReview from '../components/MetadataReview.tsx';
import Actividad from '../components/Actividad.tsx';
import { api } from '../lib/api.ts';
import { fileSize } from '../lib/format.ts';
import { usePreferences } from '../lib/preferences.tsx';

const TABS = [
  { key: 'playback', label: 'Reproducción' },
  { key: 'audio', label: 'Audio' },
  { key: 'subtitles', label: 'Subtítulos' },
  { key: 'library', label: 'Biblioteca' },
  { key: 'analysis', label: 'Análisis' },
  { key: 'metadata', label: 'Metadatos' },
  { key: 'pin', label: 'PIN' },
  { key: 'actividad', label: 'Actividad' },
  { key: 'server', label: 'Servidor' },
] as const;

type Tab = (typeof TABS)[number]['key'];

const LANGUAGES = [
  { value: 'spa', label: 'Español' },
  { value: 'eng', label: 'Inglés' },
  { value: 'cat', label: 'Catalán' },
  { value: 'glg', label: 'Gallego' },
  { value: 'eus', label: 'Euskera' },
  { value: 'fre', label: 'Francés' },
  { value: 'ger', label: 'Alemán' },
  { value: 'ita', label: 'Italiano' },
  { value: 'por', label: 'Portugués' },
  { value: 'jpn', label: 'Japonés' },
  { value: 'original', label: 'Idioma original' },
];

function PlaybackTab() {
  const { prefs, update } = usePreferences();
  const p = prefs.playback;
  return (
    <Panel title="Reproducción" subtitle="Cómo empieza y se comporta el vídeo en este perfil.">
      <Field label="Calidad máxima" hint="Original reproduce sin recodificar cuando el dispositivo puede. Bajarla obliga a transcodificar, útil en móviles o wifi flojo.">
        <Select
          value={p.maxHeight}
          onChange={(maxHeight) => update('playback', { maxHeight })}
          options={[
            { value: 0, label: 'Original' },
            { value: 1080, label: '1080p' },
            { value: 720, label: '720p' },
            { value: 480, label: '480p' },
          ]}
        />
      </Field>
      <Field
        label="Adaptar la calidad a la red"
        hint="Fuera de casa el vídeo se parte en trozos de 4 s y se ofrecen tres calidades: si la línea baja, el reproductor cambia solo, y si falla un trozo se reintenta ese trozo en vez de cortarse la película. En la red local no hace falta, porque la tubería directa no recodifica nada."
      >
        <Select
          value={p.adaptativo}
          onChange={(adaptativo) => update('playback', { adaptativo })}
          options={[
            { value: 'auto', label: 'Solo fuera de casa' },
            { value: 'siempre', label: 'Siempre' },
            { value: 'nunca', label: 'Nunca' },
          ]}
        />
      </Field>
      <Field label="Reanudar donde lo dejaste" hint="Si se desactiva, todo empieza desde el principio.">
        <Toggle checked={p.resume} onChange={(resume) => update('playback', { resume })} />
      </Field>
      <Field label="Siguiente episodio automático" hint="Al terminar un episodio salta al siguiente de la temporada.">
        <Toggle checked={p.autoPlayNext} onChange={(autoPlayNext) => update('playback', { autoPlayNext })} />
      </Field>
      <Field label="Salto corto" hint="Flechas izquierda y derecha.">
        <Select
          value={p.seekStep}
          onChange={(seekStep) => update('playback', { seekStep })}
          options={[5, 10, 15, 30].map((v) => ({ value: v, label: `${v} segundos` }))}
        />
      </Field>
      <Field label="Salto largo" hint="Mayúsculas + flechas.">
        <Select
          value={p.seekStepLarge}
          onChange={(seekStepLarge) => update('playback', { seekStepLarge })}
          options={[30, 60, 120, 300].map((v) => ({ value: v, label: v >= 60 ? `${v / 60} minuto${v > 60 ? 's' : ''}` : `${v} segundos` }))}
        />
      </Field>
    </Panel>
  );
}

function AudioTab() {
  const { prefs, update } = usePreferences();
  const a = prefs.audio;
  return (
    <Panel title="Audio" subtitle="Se aplica al elegir pista y al transcodificar.">
      <Field label="Idioma preferido" hint="Se selecciona sola esta pista si la película la tiene.">
        <Select value={a.preferredLanguage} onChange={(preferredLanguage) => update('audio', { preferredLanguage })} options={LANGUAGES} />
      </Field>
      <Field
        label="Mezcla de diálogos"
        hint="Al bajar un 5.1 a estéreo el canal central queda enterrado bajo música y efectos. «Diálogos» lo realza (+8 dB medidos); «Noche» además comprime las escenas fuertes para no despertar a nadie."
      >
        <Select
          value={a.mode}
          onChange={(mode) => update('audio', { mode })}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'dialogue', label: 'Diálogos realzados' },
            { value: 'night', label: 'Modo noche' },
          ]}
        />
      </Field>
      <Field
        label="Mezclar a estéreo"
        hint="Recomendado: los navegadores manejan mal el 5.1 y suelen dejar los diálogos bajos. Desactívalo solo si escuchas por un equipo con decodificador."
      >
        <Toggle checked={a.downmixStereo} onChange={(downmixStereo) => update('audio', { downmixStereo })} />
      </Field>
      <Field label="Normalizar volumen" hint="Iguala el nivel entre películas para que no haya que tocar el mando de noche. Requiere transcodificar el audio.">
        <Toggle checked={a.normalize} onChange={(normalize) => update('audio', { normalize })} />
      </Field>
      <Field label="Volumen inicial">
        <Slider value={Math.round(a.defaultVolume * 100)} min={10} max={100} step={5} suffix="%" onChange={(v) => update('audio', { defaultVolume: v / 100 })} />
      </Field>
    </Panel>
  );
}

function SubtitlesTab() {
  const { prefs, update } = usePreferences();
  const s = prefs.subtitles;
  const [fetchFor, setFetchFor] = useState('');

  const { data: available } = useQuery({ queryKey: ['subs-available'], queryFn: api.subtitlesAvailable });
  // Igual que en la transcripción: si no se invalida al arrancar, el estado se
  // queda congelado y parece que el botón no hace nada.
  const cola = useQueryClient();
  const { data: job } = useQuery({
    queryKey: ['subs-job'],
    queryFn: api.subtitlesJob,
    refetchInterval: (q) => (q.state.data?.running ? 1500 : 20000),
    refetchIntervalInBackground: true,
  });

  const start = useMutation({
    mutationFn: () => api.subtitlesFetch({ fileId: Number(fetchFor), languages: 'es,en', forced: true }),
    onSuccess: () => cola.invalidateQueries({ queryKey: ['subs-job'] }),
  });

  return (
    <div className="space-y-5">
      <Panel title="Subtítulos" subtitle="Selección automática y aspecto del texto.">
        <Field label="Idioma preferido">
          <Select value={s.preferredLanguage} onChange={(preferredLanguage) => update('subtitles', { preferredLanguage })} options={LANGUAGES} />
        </Field>
        <Field
          label="Cuándo activarlos"
          hint="«Si el audio está en otro idioma» los enciende solo cuando ves algo que no está en tu idioma preferido."
        >
          <Select
            value={s.mode}
            onChange={(mode) => update('subtitles', { mode })}
            options={[
              { value: 'auto', label: 'Si el audio está en otro idioma' },
              { value: 'always', label: 'Siempre' },
              { value: 'never', label: 'Nunca' },
            ]}
          />
        </Field>
        <Field label="Preferir forzados" hint="Solo rótulos y diálogo en otro idioma.">
          <Toggle checked={s.preferForced} onChange={(preferForced) => update('subtitles', { preferForced })} />
        </Field>
        <Field label="Tamaño del texto">
          <Slider value={s.size} min={60} max={220} step={10} suffix="%" onChange={(size) => update('subtitles', { size })} />
        </Field>
        <Field label="Color">
          <div className="flex gap-2">
            {['#ffffff', '#f5e663', '#9ad5ff', '#c9ffc9'].map((color) => (
              <button
                key={color}
                onClick={() => update('subtitles', { color })}
                className={`h-7 w-7 rounded-full ring-2 transition-transform hover:scale-110 ${s.color === color ? 'ring-accent' : 'ring-white/20'}`}
                style={{ background: color }}
                aria-label={color}
              />
            ))}
          </div>
        </Field>
        <Field label="Fondo" hint="La sombra se lee bien sin tapar la imagen; la caja es más legible sobre escenas claras.">
          <Select
            value={s.background}
            onChange={(background) => update('subtitles', { background })}
            options={[
              { value: 'shadow', label: 'Sombra' },
              { value: 'box', label: 'Caja negra' },
              { value: 'none', label: 'Ninguno' },
            ]}
          />
        </Field>
      </Panel>

      <Panel
        title="Buscar subtítulos que faltan"
        subtitle="Usa el buscador del pipeline: mira primero en tu propia biblioteca, luego OpenSubtitles por hash del fichero, y comprueba la sincronía contra el audio antes de aceptar nada. Si no puede demostrar que encaja, lo rechaza."
      >
        {available?.available === false ? (
          <p className="text-[13px] text-mist-500">No se encuentra subsfetch.py en C:\scripts\webpanel.</p>
        ) : (
          <>
            <Field label="Identificador del fichero" hint="Lo ves en la ficha de la película, en el panel «Fichero».">
              <div className="flex gap-2">
                <TextInput value={fetchFor} onChange={setFetchFor} placeholder="p. ej. 4" className="w-24" />
                <Button onClick={() => start.mutate()} disabled={!fetchFor || job?.running}>
                  {job?.running ? 'Buscando…' : 'Buscar'}
                </Button>
              </div>
            </Field>

            {job && (job.running || job.log.length > 0) && (
              <div className="rounded-xl bg-black/40 p-3">
                <div className="mb-2 flex items-center gap-2 text-[12px]">
                  <span className="font-medium">{job.title || 'Sin trabajo'}</span>
                  {job.running && <span className="h-3 w-3 animate-spin rounded-full border border-white/25 border-t-white/90" />}
                  {job.outcome && <span className={job.exitCode === 0 ? 'text-emerald-400' : job.exitCode === 2 ? 'text-amber-400' : 'text-red-400'}>{job.outcome}</span>}
                </div>
                <pre className="max-h-64 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-mist-500">
                  {job.log.slice(-60).join('\n')}
                </pre>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

function LibraryTab() {
  const queryClient = useQueryClient();
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const { data: libraries } = useQuery({ queryKey: ['libraries'], queryFn: api.libraries });
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: api.users });
  const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: api.sessions, refetchInterval: 4000 });
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('');
  const [pairResult, setPairResult] = useState('');

  const pair = useMutation({
    mutationFn: () => api.pairDevice(code),
    onSuccess: (r) => {
      setPairResult(`Televisión conectada al perfil de ${r.user}.`);
      setCode('');
    },
  });

  const scan = useMutation({ mutationFn: api.scan, onSuccess: () => setMessage('Escaneo iniciado. Tarda alrededor de medio minuto.') });
  const addUser = useMutation({
    mutationFn: () => api.createUser(name.trim(), pin || undefined),
    onSuccess: () => {
      setName('');
      setPin('');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  return (
    <div className="space-y-5">
      <Panel title="Biblioteca" action={<Button onClick={() => scan.mutate()} disabled={scan.isPending}>Volver a escanear</Button>}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ['Películas', stats?.movies],
            ['Series', stats?.shows],
            ['Episodios', stats?.episodes],
            ['Tamaño', stats ? fileSize(stats.bytes) : ''],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <div className="text-2xl font-semibold tabular-nums">{typeof value === 'number' ? value.toLocaleString('es-ES') : (value ?? '—')}</div>
              <div className="text-xs text-mist-500">{label}</div>
            </div>
          ))}
        </div>
        <div className="space-y-1.5 pt-2">
          {libraries?.map((lib) => (
            <div key={lib.id} className="flex items-center justify-between rounded-xl bg-white/4 px-3 py-2 text-[13px]">
              <span>{lib.name}</span>
              <span className="text-mist-500">{lib.count} · {lib.kind === 'movie' ? 'películas' : 'series'}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Reproducciones activas" subtitle="Qué está sirviendo el servidor ahora mismo y en qué modo.">
        {sessions && sessions.length > 0 ? (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div key={s.id} className="rounded-xl bg-white/4 px-3 py-2.5 text-[13px]">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.title}</span>
                  <span className="rounded-md bg-accent/18 px-2 py-0.5 text-[11px] text-accent-soft">{s.mode}</span>
                </div>
                {s.reasons.length > 0 && <div className="mt-1 text-[11px] text-mist-600">{s.reasons.join(' · ')}</div>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-mist-500">Nadie está viendo nada ahora mismo.</p>
        )}
      </Panel>

      <Panel title="Perfiles">
        <div className="space-y-1.5">
          {users?.users.map((user) => (
            <div key={user.id} className="flex items-center gap-3 rounded-xl bg-white/4 px-3 py-2 text-[13px]">
              <span className="grid h-7 w-7 place-items-center rounded-full text-xs font-semibold text-ink-950" style={{ background: user.color ?? '#f0a54a' }}>
                {user.name.charAt(0).toUpperCase()}
              </span>
              <span className="flex-1">{user.name}</span>
              {user.is_admin === 1 && <span className="text-[11px] text-mist-500">administrador</span>}
              {user.has_pin ? <span className="text-[11px] text-mist-600">con PIN</span> : null}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <TextInput value={name} onChange={setName} placeholder="Nombre del nuevo perfil" className="flex-1" />
          <TextInput value={pin} onChange={setPin} placeholder="PIN (6 cifras o más)" className="w-44" />
          <Button onClick={() => addUser.mutate()} disabled={!name.trim() || addUser.isPending}>Añadir</Button>
        </div>
      </Panel>

      <Panel
        title="Emparejar televisión"
        subtitle="La app de la tele muestra un código de seis cifras. Escríbelo aquí y quedará conectada a tu perfil, sin tener que teclear contraseñas con el mando."
      >
        <Field label="Código de la televisión">
          <div className="flex gap-2">
            <TextInput value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} placeholder="000000" className="w-28 text-center font-mono tracking-widest" />
            <Button onClick={() => pair.mutate()} disabled={code.length !== 6 || pair.isPending}>
              {pair.isPending ? 'Conectando…' : 'Conectar'}
            </Button>
          </div>
        </Field>
        {pairResult && <p className="text-[13px] text-emerald-400">{pairResult}</p>}
        {pair.error && <p className="text-[13px] text-red-400">{(pair.error as Error).message}</p>}
      </Panel>

      {message && <p className="text-center text-sm text-mist-400">{message}</p>}
    </div>
  );
}

/**
 * El PIN del perfil.
 *
 * Existe por una razon concreta: sin PIN, este perfil **no vale fuera de casa**.
 * El servidor se niega a dejarlo entrar desde internet y ni siquiera lo lista,
 * porque es administrador y puede borrar peliculas con su carpeta. Dentro de
 * casa da igual y se puede seguir sin ninguno.
 */
function PinTab() {
  const { data: yo } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [actual, setActual] = useState('');
  const [nuevo, setNuevo] = useState('');
  const [repetido, setRepetido] = useState('');
  const [aviso, setAviso] = useState('');

  const guardar = useMutation({
    mutationFn: () => api.cambiarPin(yo!.id, nuevo, actual),
    onSuccess: (r) => {
      setActual('');
      setNuevo('');
      setRepetido('');
      setAviso(
        r.tienePin
          ? `PIN guardado. Ya puedes entrar desde fuera de casa.${r.sesionesCerradas ? ` Se han cerrado ${r.sesionesCerradas} sesiones abiertas en otros aparatos.` : ''}`
          : 'PIN quitado. Este perfil vuelve a ser solo para la red de casa.',
      );
    },
    onError: (err: Error) => setAviso(err.message),
  });

  const tienePin = yo?.has_pin === 1;
  const puedeGuardar =
    nuevo === repetido && (nuevo.length === 0 || nuevo.length >= 4) && (!tienePin || actual.length > 0);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-1 text-[15px] font-semibold text-mist-200">PIN de {yo?.name ?? 'tu perfil'}</h2>
        <p className="text-[12.5px] text-mist-500">
          {tienePin
            ? 'Este perfil tiene PIN, asi que se puede usar desde fuera de casa.'
            : 'Este perfil no tiene PIN. Dentro de casa entra solo; desde fuera, el servidor no lo deja entrar ni lo enseña en la lista.'}
        </p>
      </div>

      <div className="space-y-3">
        {tienePin && (
          <input
            type="password"
            inputMode="numeric"
            value={actual}
            onChange={(e) => setActual(e.target.value.replace(/\D/g, ''))}
            placeholder="PIN actual"
            className="w-full rounded-xl bg-white/6 px-4 py-2.5 text-[14px] outline-none ring-1 ring-white/10 focus:ring-white/25"
          />
        )}
        <input
          type="password"
          inputMode="numeric"
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value.replace(/\D/g, ''))}
          placeholder="PIN nuevo (seis cifras o más)"
          className="w-full rounded-xl bg-white/6 px-4 py-2.5 text-[14px] outline-none ring-1 ring-white/10 focus:ring-white/25"
        />
        <input
          type="password"
          inputMode="numeric"
          value={repetido}
          onChange={(e) => setRepetido(e.target.value.replace(/\D/g, ''))}
          placeholder="Reptelo"
          className="w-full rounded-xl bg-white/6 px-4 py-2.5 text-[14px] outline-none ring-1 ring-white/10 focus:ring-white/25"
        />
        {nuevo !== repetido && repetido.length > 0 && (
          <p className="text-[12.5px] text-accent">Los dos PIN no coinciden.</p>
        )}
      </div>

      <button
        onClick={() => guardar.mutate()}
        disabled={!puedeGuardar || guardar.isPending}
        className="rounded-full bg-white/10 px-4 py-2 text-[13px] font-medium transition-colors hover:bg-white/18 disabled:opacity-40"
      >
        {nuevo.length === 0 ? 'Quitar el PIN' : 'Guardar el PIN'}
      </button>

      {aviso && <p className="text-[12.5px] text-mist-400">{aviso}</p>}

      <p className="text-[12px] text-mist-600">
        Cambiar el PIN cierra las sesiones abiertas de este perfil en los demas aparatos: la tele y el movil
        pediran entrar otra vez. Es a proposito.
      </p>
    </div>
  );
}

function tamano(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${bytes} B`;
}

function MantenimientoPanel() {
  const queryClient = useQueryClient();
  const [mensaje, setMensaje] = useState('');
  const { data: estado } = useQuery({ queryKey: ['mantenimiento'], queryFn: api.mantenimientoEstado });

  const limpiar = useMutation({
    mutationFn: api.mantenimientoLimpiar,
    onSuccess: (r) => {
      setMensaje(`Retirados ${r.trickplayHuerfano} carpetas de miniaturas huérfanas y ${r.cacheImagenes} imágenes de caché sin usar.`);
      queryClient.invalidateQueries({ queryKey: ['mantenimiento'] });
    },
  });

  const optimizar = useMutation({
    mutationFn: api.mantenimientoOptimizar,
    onSuccess: (r) => {
      setMensaje(`Base de datos optimizada: ${tamano(r.antes)} → ${tamano(r.despues)}.`);
      queryClient.invalidateQueries({ queryKey: ['mantenimiento'] });
    },
  });

  const copia = useMutation({
    mutationFn: api.mantenimientoCopia,
    onSuccess: () => {
      setMensaje('Copia de seguridad guardada en data/copias.');
      queryClient.invalidateQueries({ queryKey: ['mantenimiento'] });
    },
  });

  const trabajando = limpiar.isPending || optimizar.isPending || copia.isPending;

  return (
    <Panel
      title="Mantenimiento"
      subtitle="Miniaturas huérfanas, caché sin usar y copias de la base de datos se retiran solas cada semana; aquí se puede forzar ahora mismo."
    >
      <div className="grid gap-2 text-[13px] sm:grid-cols-3">
        <div><span className="text-mist-600">Base de datos: </span>{estado ? tamano(estado.baseDeDatos.bytes) : '—'}</div>
        <div><span className="text-mist-600">Caché de imágenes: </span>{estado ? `${tamano(estado.cacheImagenes.bytes)} (${estado.cacheImagenes.ficheros})` : '—'}</div>
        <div><span className="text-mist-600">Miniaturas: </span>{estado ? `${tamano(estado.trickplay.bytes)} (${estado.trickplay.ficheros})` : '—'}</div>
      </div>
      <p className="text-[12px] text-mist-600">
        Copias de seguridad: {estado?.copias.total ?? 0} guardadas
        {estado?.copias.ultima ? `, la última ${estado.copias.ultima.replace(/^tvwatch-|\.db$/g, '')}` : ''}.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="ghost" onClick={() => limpiar.mutate()} disabled={trabajando}>
          {limpiar.isPending ? 'Limpiando…' : 'Vaciar caché y huérfanos'}
        </Button>
        <Button variant="ghost" onClick={() => copia.mutate()} disabled={trabajando}>
          {copia.isPending ? 'Guardando…' : 'Copia de seguridad ahora'}
        </Button>
        <Button variant="ghost" onClick={() => optimizar.mutate()} disabled={trabajando}>
          {optimizar.isPending ? 'Optimizando (puede tardar)…' : 'Optimizar base de datos'}
        </Button>
      </div>
      {mensaje && <p className="text-[12.5px] text-mist-400">{mensaje}</p>}
    </Panel>
  );
}

function ServerTab() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['server-settings'], queryFn: api.serverSettings });
  const [caps, setCaps] = useState<Awaited<ReturnType<typeof api.capabilities>> | null>(null);
  const [message, setMessage] = useState('');

  const detect = useMutation({
    mutationFn: () => api.capabilities(true),
    onSuccess: setCaps,
    onError: (err: Error) => setMessage(err.message),
  });

  const applyBest = useMutation({
    mutationFn: api.applyCapabilities,
    onSuccess: (r) => {
      setMessage(`Aplicado: ${r.applied.encoder}, calidad ${r.applied.transcodeQuality}, tonemapping ${r.applied.tonemap ? 'activado' : 'desactivado'}.`);
      queryClient.invalidateQueries({ queryKey: ['server-settings'] });
    },
  });

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.saveServerSettings(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['server-settings'] }),
  });

  if (settings?.readOnly) {
    return <Panel title="Servidor"><p className="text-sm text-mist-500">Solo un administrador puede ver y cambiar estos ajustes.</p></Panel>;
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Hardware"
        subtitle="Prueba de verdad cada codificador con una película tuya, en vez de fiarse de lo que ffmpeg dice traer compilado."
        action={<Button variant="ghost" onClick={() => detect.mutate()} disabled={detect.isPending}>{detect.isPending ? 'Probando…' : 'Detectar'}</Button>}
      >
        {detect.isPending && <p className="text-[13px] text-mist-500">Codificando fragmentos de prueba. Tarda entre medio minuto y dos minutos.</p>}

        {caps && (
          <>
            <div className="grid gap-2 text-[13px] sm:grid-cols-2">
              <div><span className="text-mist-600">Procesador: </span>{caps.cpu.model} · {caps.cpu.cores} hilos · {caps.cpu.memoryGb} GB</div>
              <div><span className="text-mist-600">Gráficas: </span>{caps.gpus.map((g) => g.name).join(', ') || '—'}</div>
            </div>

            <div className="space-y-1.5 pt-2">
              {caps.encoders.map((e) => (
                <div key={e.name} className="flex items-center gap-3 rounded-xl bg-white/4 px-3 py-2 text-[12.5px]">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${e.working ? 'bg-emerald-400' : 'bg-mist-600'}`} />
                  <span className="flex-1">{e.label}</span>
                  {e.realtimeFactor && <span className="font-mono text-mist-400 tabular-nums">{e.realtimeFactor}× tiempo real</span>}
                  {!e.working && <span className="max-w-64 truncate text-[11px] text-mist-600">{e.note}</span>}
                </div>
              ))}
            </div>

            <div className="rounded-xl bg-white/4 px-3 py-2.5 text-[12.5px]">
              <span className={caps.tonemap.supported ? 'text-emerald-400' : 'text-amber-400'}>
                Tonemapping HDR: {caps.tonemap.supported ? 'disponible' : 'no disponible'}
              </span>
              <span className="text-mist-600"> — {caps.tonemap.note}</span>
            </div>

            {caps.notes.map((n) => (
              <p key={n} className="text-[12.5px] leading-relaxed text-mist-500">· {n}</p>
            ))}

            <div className="pt-1">
              <Button onClick={() => applyBest.mutate()} disabled={applyBest.isPending}>Aplicar configuración recomendada</Button>
            </div>
          </>
        )}

        {!caps && !detect.isPending && <p className="text-[13px] text-mist-500">Sin datos todavía. Pulsa «Detectar» para medir este equipo.</p>}
      </Panel>

      <Panel title="Transcodificación">
        <Field label="Aceleración por hardware" hint="Quick Sync usa la GPU Intel. Sin ella, todo recae en la CPU.">
          <Select
            value={settings?.hwaccel ?? 'qsv'}
            onChange={(hwaccel) => save.mutate({ hwaccel })}
            options={[
              { value: 'qsv', label: 'Intel Quick Sync' },
              { value: 'none', label: 'Solo CPU' },
            ]}
          />
        </Field>
        <Field label="Calidad" hint="Número más bajo, más calidad y más tamaño. En red local sale a cuenta bajarlo.">
          <Slider value={settings?.transcodeQuality ?? 20} min={14} max={30} onChange={(transcodeQuality) => save.mutate({ transcodeQuality })} />
        </Field>
        <Field label="Convertir HDR a SDR" hint="Sin esto, el contenido HDR se ve desvaído en pantallas normales al transcodificar.">
          <Toggle checked={settings?.tonemap ?? true} onChange={(tonemap) => save.mutate({ tonemap })} />
        </Field>
        <Field label="Carpeta temporal">
          <span className="font-mono text-[12px] text-mist-500">{settings?.transcodeDir}</span>
        </Field>
      </Panel>

      <MantenimientoPanel />

      {message && <p className="text-center text-sm text-mist-400">{message}</p>}
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState<Tab>('playback');
  const { data: yo } = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: Infinity });
  // «Actividad» es cosa del administrador: quién ve qué, mensajes, parar.
  const pestanas = TABS.filter((t) => t.key !== 'actividad' || yo?.is_admin === 1);

  return (
    <div className="mx-auto max-w-3xl px-4 pt-24 pb-24 sm:px-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Ajustes</h1>

      <div className="no-scrollbar mb-6 flex gap-1 overflow-x-auto">
        {pestanas.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative shrink-0 rounded-full px-4 py-1.5 text-[13px] transition-colors duration-200 ${
              tab === t.key ? 'text-ink-950' : 'text-mist-400 hover:text-mist-100'
            }`}
          >
            {tab === t.key && <motion.span layoutId="settings-tab" className="absolute inset-0 rounded-full bg-mist-100" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <span className="relative z-10">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'playback' && <PlaybackTab />}
      {tab === 'audio' && <AudioTab />}
      {tab === 'subtitles' && <SubtitlesTab />}
      {tab === 'library' && <LibraryTab />}
      {tab === 'analysis' && <AnalysisPanels />}
      {tab === 'metadata' && <MetadataReview />}
      {tab === 'pin' && <PinTab />}
      {tab === 'actividad' && <Actividad />}
      {tab === 'server' && <ServerTab />}
    </div>
  );
}
