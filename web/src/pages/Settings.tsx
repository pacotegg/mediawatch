import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Button, Field, Panel, Select, Slider, TextInput, Toggle } from '../components/Controls.tsx';
import AnalysisPanels from '../components/AnalysisPanels.tsx';
import MetadataReview from '../components/MetadataReview.tsx';
import Actividad from '../components/Actividad.tsx';
import { api, type User } from '../lib/api.ts';
import { fileSize } from '../lib/format.ts';
import { usePreferences } from '../lib/preferences.tsx';

const TABS = [
  { key: 'playback', label: 'Reproducción' },
  { key: 'audio', label: 'Audio' },
  { key: 'subtitles', label: 'Subtítulos' },
  { key: 'library', label: 'Biblioteca' },
  { key: 'analysis', label: 'Análisis' },
  { key: 'metadata', label: 'Metadatos' },
  { key: 'usuarios', label: 'Usuarios' },
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
      <Panel title="Subtítulos" subtitle="Aspecto del texto y tamaño.">
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
  const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: api.sessions, refetchInterval: 4000 });
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

const AVATAR_COLORS = ['#e8b64c', '#5ac8fa', '#ff6b6b', '#8e7cff', '#3ddc97', '#ff9f43', '#f368e0', '#54a0ff'];

function UsuariosTab() {
  const queryClient = useQueryClient();
  const { data: usersData, isLoading } = useQuery({ queryKey: ['users'], queryFn: api.users });
  const { data: yo } = useQuery({ queryKey: ['me'], queryFn: api.me });

  const FRANJAS_EDAD = [
    { key: 'TP', label: 'Todos los públicos (TP / Apta)' },
    { key: '7', label: 'Infantil (+7)' },
    { key: '12', label: 'Juvenil (+12)' },
    { key: '16', label: 'Adolescentes (+16)' },
  ] as const;

  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newIsKid, setNewIsKid] = useState(false);
  const [newKidRatings, setNewKidRatings] = useState<string[]>(['TP', '7']);

  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#e8b64c');
  const [editIsAdmin, setEditIsAdmin] = useState(false);
  const [editIsKid, setEditIsKid] = useState(false);
  const [editKidRatings, setEditKidRatings] = useState<string[]>([]);
  const [editPin, setEditPin] = useState('');
  const [quitarPin, setQuitarPin] = useState(false);
  const [aviso, setAviso] = useState('');
  const [subiendoAvatar, setSubiendoAvatar] = useState(false);

  const startEdit = (u: User) => {
    setEditing(u);
    setCreating(false);
    setEditName(u.name);
    setEditColor(u.color ?? '#e8b64c');
    setEditIsAdmin(u.is_admin === 1);
    setEditPin('');
    setQuitarPin(false);
    const tieneKid = Array.isArray(u.kid_ratings) && u.kid_ratings.length > 0;
    setEditIsKid(tieneKid);
    setEditKidRatings(tieneKid ? [...u.kid_ratings!] : ['TP', '7']);
    setAviso('');
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api.createUser(
        newName.trim(),
        newPin ? newPin.trim() : undefined,
        newIsKid && newKidRatings.length > 0 ? newKidRatings : null,
      ),
    onSuccess: () => {
      setCreating(false);
      setNewName('');
      setNewPin('');
      setNewIsKid(false);
      setNewKidRatings(['TP', '7']);
      setAviso('Usuario creado con éxito');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => setAviso(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const data: { name?: string; color?: string; isAdmin?: boolean; pin?: string | null; kidRatings?: string[] | null } = {
        name: editName.trim(),
        color: editColor,
        isAdmin: editIsKid ? false : editIsAdmin,
        kidRatings: editIsKid && editKidRatings.length > 0 ? editKidRatings : null,
      };
      if (quitarPin) {
        data.pin = null;
      } else if (editPin.length > 0) {
        data.pin = editPin;
      }
      await api.updateUser(editing.id, data);
    },
    onSuccess: () => {
      setEditing(null);
      setAviso('Usuario actualizado');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err: Error) => setAviso(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteUser(id),
    onSuccess: () => {
      setEditing(null);
      setAviso('Usuario eliminado');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => setAviso(err.message),
  });

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editing) return;
    setSubiendoAvatar(true);
    setAviso('');
    try {
      await api.uploadAvatar(editing.id, file);
      setAviso('Foto de perfil actualizada');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setEditing({ ...editing, has_avatar: 1 });
    } catch (err: any) {
      setAviso(err.message ?? 'Error subiendo la imagen');
    } finally {
      setSubiendoAvatar(false);
    }
  };

  const handleAvatarDelete = async () => {
    if (!editing) return;
    setSubiendoAvatar(true);
    try {
      await api.deleteAvatar(editing.id);
      setAviso('Foto de perfil retirada');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setEditing({ ...editing, has_avatar: 0 });
    } catch (err: any) {
      setAviso(err.message ?? 'Error retirando el avatar');
    } finally {
      setSubiendoAvatar(false);
    }
  };

  if (isLoading) return <div className="text-sm text-mist-500">Cargando usuarios…</div>;

  return (
    <Panel
      title="Usuarios y perfiles"
      subtitle="Gestiona los perfiles del servidor, sus avatares, permisos de administrador y acceso por PIN."
      action={
        !creating && !editing ? (
          <Button onClick={() => { setCreating(true); setEditing(null); setNewName(''); setNewPin(''); setAviso(''); }}>
            + Nuevo usuario
          </Button>
        ) : undefined
      }
    >
      <div className="rounded-2xl border border-white/8 bg-white/4 p-4 text-[13px] leading-relaxed text-mist-300">
        <strong className="text-mist-100">💡 Acceso desde fuera de casa:</strong> Por seguridad, al conectarse desde internet
        solo se muestran y se permite entrar a los perfiles que tienen un <strong className="text-mist-100">PIN</strong> de 6 dígitos.
        Los perfiles sin PIN solo son visibles dentro de la red local de casa.
      </div>

      {creating && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/6 p-5">
          <h3 className="text-[14px] font-semibold text-mist-100">Crear nuevo perfil</h3>
          <Field label="Nombre" hint="Identificador visible en el menú de perfiles.">
            <TextInput value={newName} onChange={setNewName} placeholder="Nombre" />
          </Field>
          <Field label="PIN (opcional)" hint="Mínimo 6 dígitos. Requerido para acceder desde fuera de casa.">
            <input
              type="password"
              inputMode="numeric"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              placeholder="6 dígitos o vacío"
              className="rounded-xl border border-white/8 bg-white/6 px-3 py-2 text-[13px] outline-none placeholder:text-mist-600 focus:border-accent/40"
            />
          </Field>
          <Field
            label="Perfil infantil (Control parental)"
            hint="Restringe el catálogo visible a las franjas de edad autorizadas."
          >
            <div className="space-y-3 pt-1">
              <Toggle checked={newIsKid} onChange={setNewIsKid} />
              {newIsKid && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {FRANJAS_EDAD.map((f) => {
                    const sel = newKidRatings.includes(f.key);
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => {
                          setNewKidRatings((prev) =>
                            sel ? prev.filter((k) => k !== f.key) : [...prev, f.key]
                          );
                        }}
                        className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                          sel ? 'bg-accent font-semibold text-ink-950' : 'bg-white/8 text-mist-400 hover:text-mist-200'
                        }`}
                      >
                        {sel ? '✓ ' : ''}{f.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </Field>
          <div className="flex gap-2 pt-2">
            <Button onClick={() => createMutation.mutate()} disabled={!newName.trim() || createMutation.isPending}>
              Crear perfil
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {editing && (
        <div className="space-y-5 rounded-2xl border border-white/10 bg-white/6 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-mist-100">Editar perfil: {editing.name}</h3>
            <button onClick={() => setEditing(null)} className="text-xs text-mist-400 hover:text-mist-200">
              ✕ Cerrar
            </button>
          </div>

          <div className="flex items-center gap-5 border-b border-white/5 pb-4">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl shadow-lg ring-1 ring-white/15">
              {editing.has_avatar ? (
                <img
                  src={`${api.userAvatarUrl(editing.id)}?t=${Date.now()}`}
                  alt={editing.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div
                  className="grid h-full w-full place-items-center text-2xl font-bold text-ink-950"
                  style={{ background: `linear-gradient(140deg, ${editColor}, ${editColor}bb)` }}
                >
                  {editName.charAt(0).toUpperCase() || '?'}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="text-[13px] text-mist-200">Foto de perfil</div>
              <div className="flex flex-wrap gap-2">
                <label className="cursor-pointer rounded-full bg-mist-100 px-3.5 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-white">
                  <span>{subiendoAvatar ? 'Subiendo…' : 'Subir foto'}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleAvatarUpload}
                    disabled={subiendoAvatar}
                  />
                </label>
                {editing.has_avatar === 1 && (
                  <Button variant="danger" onClick={handleAvatarDelete} disabled={subiendoAvatar}>
                    Quitar foto
                  </Button>
                )}
              </div>
              <p className="text-[11.5px] text-mist-500">Admite JPEG, PNG y WebP. Se muestra en web, TV y móvil.</p>
            </div>
          </div>

          <Field label="Nombre del perfil">
            <TextInput value={editName} onChange={setEditName} placeholder="Nombre" />
          </Field>

          <Field label="Color del perfil" hint="Fondo cuando no hay foto de perfil.">
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setEditColor(c)}
                  className={`h-7 w-7 rounded-full transition-transform ${editColor === c ? 'scale-125 ring-2 ring-white ring-offset-2 ring-offset-ink-900' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </Field>

          {!editIsKid && yo?.is_admin === 1 && (
            <Field label="Administrador" hint="Permite escanear bibliotecas, editar títulos y gestionar usuarios.">
              <Toggle checked={editIsAdmin} onChange={setEditIsAdmin} />
            </Field>
          )}

          <Field
            label="Perfil infantil (Control parental)"
            hint="Restringe el catálogo visible a las franjas de edad autorizadas."
          >
            <div className="space-y-3 pt-1">
              <Toggle checked={editIsKid} onChange={setEditIsKid} />
              {editIsKid && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {FRANJAS_EDAD.map((f) => {
                    const sel = editKidRatings.includes(f.key);
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => {
                          setEditKidRatings((prev) =>
                            sel ? prev.filter((k) => k !== f.key) : [...prev, f.key]
                          );
                        }}
                        className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                          sel ? 'bg-accent font-semibold text-ink-950' : 'bg-white/8 text-mist-400 hover:text-mist-200'
                        }`}
                      >
                        {sel ? '✓ ' : ''}{f.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </Field>

          <div className="border-b border-white/5 pb-4">
            <div className="text-[13.5px] text-mist-200">PIN de acceso</div>
            <div className="mt-1 text-[12px] text-mist-500">
              {editing.has_pin
                ? 'Este perfil tiene PIN actualmente (visible dentro y fuera de casa).'
                : 'Este perfil NO tiene PIN (solo se muestra en la red local de casa).'}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                type="password"
                inputMode="numeric"
                value={editPin}
                onChange={(e) => {
                  setEditPin(e.target.value.replace(/\D/g, ''));
                  setQuitarPin(false);
                }}
                placeholder="Nuevo PIN (6 cifras)"
                disabled={quitarPin}
                className="w-48 rounded-xl border border-white/8 bg-white/6 px-3 py-2 text-[13px] outline-none placeholder:text-mist-600 focus:border-accent/40 disabled:opacity-40"
              />
              {editing.has_pin === 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setQuitarPin(!quitarPin);
                    setEditPin('');
                  }}
                  className={`rounded-xl px-3 py-2 text-xs font-medium transition ${quitarPin ? 'bg-red-500/20 text-red-300' : 'bg-white/8 text-mist-400 hover:text-mist-200'}`}
                >
                  {quitarPin ? '✓ Quitar PIN al guardar' : 'Quitar PIN'}
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="flex gap-2">
              <Button
                onClick={() => updateMutation.mutate()}
                disabled={!editName.trim() || updateMutation.isPending || (editPin.length > 0 && editPin.length < 6)}
              >
                Guardar cambios
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
            </div>

            {yo?.id !== editing.id && (
              <Button
                variant="danger"
                onClick={() => {
                  if (confirm(`¿Eliminar el perfil de ${editing.name}? Se borrarán sus datos de reproducción.`)) {
                    deleteMutation.mutate(editing.id);
                  }
                }}
                disabled={deleteMutation.isPending}
              >
                Eliminar perfil
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {usersData?.users.map((u) => {
          const tienePin = u.has_pin === 1;
          return (
            <div
              key={u.id}
              className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/4 p-4 transition-colors hover:border-white/15"
            >
              <div className="flex min-w-0 items-center gap-3.5">
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl shadow-md ring-1 ring-white/10">
                  {u.has_avatar ? (
                    <img
                      src={api.userAvatarUrl(u.id)}
                      alt={u.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div
                      className="grid h-full w-full place-items-center text-lg font-semibold text-ink-950"
                      style={{ background: `linear-gradient(140deg, ${u.color ?? '#f0a54a'}, ${u.color ?? '#f0a54a'}bb)` }}
                    >
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-mist-100">{u.name}</span>
                    {u.is_admin === 1 && (
                      <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
                        Admin
                      </span>
                    )}
                    {Array.isArray(u.kid_ratings) && u.kid_ratings.length > 0 && (
                      <span className="rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-300">
                        🧒 {u.kid_ratings.map((k) => k === 'TP' ? 'TP' : `+${k}`).join(' ')}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px]">
                    {tienePin ? (
                      <span className="text-emerald-400">🟢 Con PIN (visible fuera)</span>
                    ) : (
                      <span className="text-amber-400">🟡 Sin PIN (solo casa)</span>
                    )}
                  </div>
                </div>
              </div>

              <button
                onClick={() => startEdit(u)}
                className="shrink-0 rounded-full bg-white/8 px-3 py-1.5 text-xs font-semibold text-mist-200 transition hover:bg-white/15"
              >
                Editar
              </button>
            </div>
          );
        })}
      </div>

      {aviso && <p className="text-[13px] text-accent">{aviso}</p>}
    </Panel>
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
  const queryClient = useQueryClient();
  const [actual, setActual] = useState('');
  const [nuevo, setNuevo] = useState('');
  const [repetido, setRepetido] = useState('');
  const [aviso, setAviso] = useState('');

  const guardar = useMutation({
    mutationFn: () => api.cambiarPin(yo!.id, nuevo, actual),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
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
    nuevo === repetido && (nuevo.length === 0 || nuevo.length >= 6) && (!tienePin || actual.length > 0);

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

function TabsBar({
  tabs,
  activeTab,
  onSelectTab,
}: {
  tabs: readonly { key: string; label: string }[];
  activeTab: string;
  onSelectTab: (k: Tab) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 6);
  };

  useEffect(() => {
    checkScroll();
    const handleResize = () => checkScroll();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [tabs]);

  const scroll = (direction: 'left' | 'right') => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === 'left' ? -220 : 220, behavior: 'smooth' });
    setTimeout(checkScroll, 250);
  };

  const handleWheel = (e: React.WheelEvent) => {
    const el = containerRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
      checkScroll();
    }
  };

  return (
    <div className="relative mb-6 flex items-center">
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scroll('left')}
          className="absolute left-0 z-20 flex h-7 w-7 -translate-x-1 items-center justify-center rounded-full bg-ink-900/95 text-mist-200 shadow-md ring-1 ring-white/20 backdrop-blur-md transition hover:bg-ink-800 hover:text-white"
          aria-label="Anterior"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      {canScrollLeft && (
        <div className="pointer-events-none absolute left-0 top-0 bottom-0 z-10 w-8 bg-gradient-to-r from-ink-950 to-transparent" />
      )}

      <div
        ref={containerRef}
        onScroll={checkScroll}
        onWheel={handleWheel}
        className="no-scrollbar flex flex-1 gap-1 overflow-x-auto scroll-smooth py-1 px-1"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => onSelectTab(t.key as Tab)}
            className={`relative shrink-0 rounded-full px-4 py-1.5 text-[13px] transition-colors duration-200 ${
              activeTab === t.key ? 'text-ink-950' : 'text-mist-400 hover:text-mist-100'
            }`}
          >
            {activeTab === t.key && (
              <motion.span
                layoutId="settings-tab"
                className="absolute inset-0 rounded-full bg-mist-100"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10">{t.label}</span>
          </button>
        ))}
      </div>

      {canScrollRight && (
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 z-10 w-8 bg-gradient-to-l from-ink-950 to-transparent" />
      )}

      {canScrollRight && (
        <button
          type="button"
          onClick={() => scroll('right')}
          className="absolute right-0 z-20 flex h-7 w-7 translate-x-1 items-center justify-center rounded-full bg-ink-900/95 text-mist-200 shadow-md ring-1 ring-white/20 backdrop-blur-md transition hover:bg-ink-800 hover:text-white"
          aria-label="Siguiente"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState<Tab>('playback');
  const { data: yo } = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: Infinity });
  // Solo el administrador ve gestión, escaneo, análisis y servidor. Los demás solo ven sus preferencias personales y PIN.
  const pestanas = TABS.filter((t) => {
    const soloAdmin = ['usuarios', 'actividad', 'server', 'library', 'analysis', 'metadata'];
    if (soloAdmin.includes(t.key)) return yo?.is_admin === 1;
    if (t.key === 'pin') return yo?.is_admin !== 1;
    return true;
  });

  return (
    <div className="mx-auto max-w-3xl px-4 page-pt page-pb sm:px-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Ajustes</h1>

      <TabsBar tabs={pestanas} activeTab={tab} onSelectTab={setTab} />

      {tab === 'playback' && <PlaybackTab />}
      {tab === 'audio' && <AudioTab />}
      {tab === 'subtitles' && <SubtitlesTab />}
      {tab === 'library' && <LibraryTab />}
      {tab === 'analysis' && <AnalysisPanels />}
      {tab === 'metadata' && <MetadataReview />}
      {tab === 'usuarios' && <UsuariosTab />}
      {tab === 'pin' && <PinTab />}
      {tab === 'actividad' && <Actividad />}
      {tab === 'server' && <ServerTab />}
    </div>
  );
}
