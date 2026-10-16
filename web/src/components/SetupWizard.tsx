import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../lib/api.ts';

type LibraryEntry = {
  name: string;
  path: string;
  kind: 'movie' | 'show';
};

export default function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Paso 1: Admin
  const [adminName, setAdminName] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [errorPaso1, setErrorPaso1] = useState('');
  const [loadingPaso1, setLoadingPaso1] = useState(false);

  // Paso 2: Bibliotecas
  const [libraries, setLibraries] = useState<LibraryEntry[]>([]);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [nuevaLibNombre, setNuevaLibNombre] = useState('Películas');
  const [nuevaLibTipo, setNuevaLibTipo] = useState<'movie' | 'show'>('movie');
  const [rutaActual, setRutaActual] = useState<string>('');
  const [rutaSeleccionada, setRutaSeleccionada] = useState<string>('');
  const [errorPaso2, setErrorPaso2] = useState('');
  const [loadingPaso2, setLoadingPaso2] = useState(false);

  // Paso 3: Metadatos
  const [tmdbKey, setTmdbKey] = useState('');
  const [tmdbLang, setTmdbLang] = useState('es-ES');
  const [loadingPaso3, setLoadingPaso3] = useState(false);

  // Explorador de carpetas para el Paso 2
  const { data: browseData, isLoading: loadingBrowse } = useQuery({
    queryKey: ['browse', rutaActual],
    queryFn: () => api.systemBrowse(rutaActual || undefined),
    enabled: modalAbierto,
  });

  const handleCrearAdmin = async () => {
    if (!adminName.trim()) {
      setErrorPaso1('Escribe tu nombre');
      return;
    }
    if (!/^\d{6,}$/.test(adminPin.trim())) {
      setErrorPaso1('El PIN debe tener 6 cifras o más (solo números)');
      return;
    }
    setErrorPaso1('');
    setLoadingPaso1(true);
    try {
      await api.createUser(adminName.trim(), adminPin.trim(), null);
      setStep(2);
    } catch (err) {
      setErrorPaso1(err instanceof Error ? err.message : 'Error creando administrador');
    } finally {
      setLoadingPaso1(false);
    }
  };

  const handleGuardarBibliotecas = async () => {
    if (libraries.length === 0) {
      setErrorPaso2('Añade al menos una carpeta de películas o series para continuar');
      return;
    }
    setErrorPaso2('');
    setLoadingPaso2(true);
    try {
      await api.saveSystemLibraries(libraries);
      setStep(3);
    } catch (err) {
      setErrorPaso2(err instanceof Error ? err.message : 'Error guardando bibliotecas');
    } finally {
      setLoadingPaso2(false);
    }
  };

  const handleFinalizar = async () => {
    setLoadingPaso3(true);
    try {
      if (tmdbKey.trim()) {
        await api.saveServerSettings({ tmdbApiKey: tmdbKey.trim(), tmdbLanguage: tmdbLang });
      }
      try {
        await api.scan();
      } catch {}
      onComplete();
    } catch {
      onComplete();
    } finally {
      setLoadingPaso3(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink-950 px-4 py-12 text-mist-100 flex flex-col justify-center items-center">
      <div className="w-full max-w-xl">
        {/* Cabecera común */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent shadow-lg shadow-accent/10 ring-1 ring-accent/30">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="4" width="20" height="16" rx="3.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="M9 8.5v7l6-3.5-6-3.5Z" fill="currentColor" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Configuración de Media Watch</h1>
          <p className="mt-1 text-sm text-mist-400">Paso {step} de 3</p>

          {/* Barra de progreso */}
          <div className="mt-4 flex gap-2 w-48">
            <div className={`h-1 flex-1 rounded-full transition-all duration-300 ${step >= 1 ? 'bg-accent' : 'bg-white/10'}`} />
            <div className={`h-1 flex-1 rounded-full transition-all duration-300 ${step >= 2 ? 'bg-accent' : 'bg-white/10'}`} />
            <div className={`h-1 flex-1 rounded-full transition-all duration-300 ${step >= 3 ? 'bg-accent' : 'bg-white/10'}`} />
          </div>
        </div>

        <AnimatePresence mode="wait">
          {/* PASO 1: CREAR ADMINISTRADOR */}
          {step === 1 && (
            <motion.div
              key="step-1"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              className="rounded-3xl border border-white/10 bg-white/4 p-6 sm:p-8 backdrop-blur-xl shadow-2xl"
            >
              <h2 className="text-lg font-semibold text-white">Perfil de administrador</h2>
              <p className="mt-1 text-xs text-mist-400">
                Crea el perfil principal para administrar el servidor y configurar tus bibliotecas.
              </p>

              <div className="mt-6 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-mist-300 mb-1.5">Tu nombre</label>
                  <input
                    type="text"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    placeholder="Ej. Paco"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder-mist-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-mist-300 mb-1.5">
                    PIN de seguridad (mínimo 6 cifras)
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={12}
                    value={adminPin}
                    onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••••"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm font-mono tracking-widest text-white placeholder-mist-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <p className="mt-1.5 text-[11px] text-mist-500">
                    Necesario para acceder a los ajustes y entrar desde fuera de casa.
                  </p>
                </div>

                {errorPaso1 && (
                  <div className="rounded-xl bg-red-500/15 border border-red-500/30 p-3 text-xs text-red-200">
                    {errorPaso1}
                  </div>
                )}

                <button
                  onClick={handleCrearAdmin}
                  disabled={loadingPaso1}
                  className="mt-6 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-ink-950 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
                >
                  {loadingPaso1 ? 'Creando perfil…' : 'Continuar a bibliotecas →'}
                </button>
              </div>
            </motion.div>
          )}

          {/* PASO 2: BIBLIOTECAS */}
          {step === 2 && (
            <motion.div
              key="step-2"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              className="rounded-3xl border border-white/10 bg-white/4 p-6 sm:p-8 backdrop-blur-xl shadow-2xl"
            >
              <h2 className="text-lg font-semibold text-white">Tus bibliotecas de medios</h2>
              <p className="mt-1 text-xs text-mist-400">
                Selecciona las carpetas donde guardas tus películas y series.
              </p>

              <div className="mt-6 space-y-3">
                {libraries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-mist-500">
                    No has añadido ninguna biblioteca todavía.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {libraries.map((lib, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
                      >
                        <div className="min-w-0 flex-1 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-white truncate">{lib.name}</span>
                            <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] uppercase font-semibold text-mist-300">
                              {lib.kind === 'movie' ? 'Películas' : 'Series'}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-mist-500 font-mono truncate">{lib.path}</p>
                        </div>
                        <button
                          onClick={() => setLibraries(libraries.filter((_, i) => i !== idx))}
                          className="rounded-lg p-1.5 text-mist-400 hover:bg-white/10 hover:text-white"
                          title="Eliminar"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => {
                    setRutaActual('');
                    setRutaSeleccionada('');
                    setNuevaLibNombre(libraries.some((l) => l.kind === 'movie') ? 'Series' : 'Películas');
                    setNuevaLibTipo(libraries.some((l) => l.kind === 'movie') ? 'show' : 'movie');
                    setModalAbierto(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-semibold text-mist-200 transition hover:bg-white/10"
                >
                  <span>+</span> Añadir carpeta de medios
                </button>

                {errorPaso2 && (
                  <div className="rounded-xl bg-red-500/15 border border-red-500/30 p-3 text-xs text-red-200">
                    {errorPaso2}
                  </div>
                )}

                <button
                  onClick={handleGuardarBibliotecas}
                  disabled={loadingPaso2 || libraries.length === 0}
                  className="mt-6 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-ink-950 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
                >
                  {loadingPaso2 ? 'Guardando…' : 'Continuar a metadatos →'}
                </button>
              </div>
            </motion.div>
          )}

          {/* PASO 3: METADATOS Y LANZAMIENTO */}
          {step === 3 && (
            <motion.div
              key="step-3"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              className="rounded-3xl border border-white/10 bg-white/4 p-6 sm:p-8 backdrop-blur-xl shadow-2xl"
            >
              <h2 className="text-lg font-semibold text-white">Carátulas e información (TMDb)</h2>
              <p className="mt-1 text-xs text-mist-400">
                Media Watch puede descargar sinopsis, carátulas en alta resolución y fotos de reparto automáticamente.
              </p>

              <div className="mt-6 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-mist-300">Clave de API de TheMovieDB (opcional)</label>
                    <a
                      href="https://www.themoviedb.org/settings/api"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-accent hover:underline"
                    >
                      Conseguir clave gratuita ↗
                    </a>
                  </div>
                  <input
                    type="text"
                    value={tmdbKey}
                    onChange={(e) => setTmdbKey(e.target.value)}
                    placeholder="Pega tu clave de TMDb aquí"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder-mist-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <p className="mt-1 text-[11px] text-mist-500">
                    Si no tienes una ahora, puedes añadirla más tarde desde Ajustes.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-mist-300 mb-1.5">Idioma de las sinopsis</label>
                  <select
                    value={tmdbLang}
                    onChange={(e) => setTmdbLang(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-ink-900 px-3.5 py-2.5 text-sm text-white focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    <option value="es-ES">Español (España)</option>
                    <option value="es-MX">Español (Latinoamérica)</option>
                    <option value="en-US">English (US)</option>
                  </select>
                </div>

                <div className="rounded-2xl bg-white/4 p-4 border border-white/10 text-xs text-mist-300 space-y-2">
                  <div className="font-semibold text-white">✓ Todo listo para el primer escaneo</div>
                  <p>
                    Al pulsar comenzar, Media Watch indexará tus carpetas en segundo plano mientras navegas por la
                    aplicación.
                  </p>
                </div>

                <button
                  onClick={handleFinalizar}
                  disabled={loadingPaso3}
                  className="mt-6 w-full rounded-xl bg-accent px-4 py-3.5 text-sm font-semibold text-ink-950 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50 shadow-lg shadow-accent/20"
                >
                  {loadingPaso3 ? 'Iniciando escaneo…' : 'Comenzar a disfrutar de Media Watch 🚀'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* MODAL EXPLORADOR DE CARPETAS */}
        {modalAbierto && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg rounded-3xl border border-white/15 bg-ink-900 p-6 shadow-2xl flex flex-col max-h-[85vh]">
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <h3 className="text-base font-semibold text-white">Seleccionar carpeta de biblioteca</h3>
                <button
                  onClick={() => setModalAbierto(false)}
                  className="rounded-lg p-1 text-mist-400 hover:bg-white/10 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="py-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-mist-300 mb-1">Nombre</label>
                    <input
                      type="text"
                      value={nuevaLibNombre}
                      onChange={(e) => setNuevaLibNombre(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-mist-300 mb-1">Tipo</label>
                    <select
                      value={nuevaLibTipo}
                      onChange={(e) => setNuevaLibTipo(e.target.value as 'movie' | 'show')}
                      className="w-full rounded-xl border border-white/10 bg-ink-950 px-3 py-2 text-xs text-white focus:border-accent focus:outline-none"
                    >
                      <option value="movie">Películas</option>
                      <option value="show">Series</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-mist-300">Explorar servidor:</span>
                    {browseData?.parent && (
                      <button
                        onClick={() => {
                          setRutaActual(browseData.parent || '');
                          setRutaSeleccionada(browseData.parent || '');
                        }}
                        className="text-xs text-accent hover:underline flex items-center gap-1"
                      >
                        ↑ Subir nivel
                      </button>
                    )}
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/30 p-2 font-mono text-xs text-mist-300 truncate">
                    {rutaActual || '(Raíz del sistema)'}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-2 overflow-y-auto max-h-52 space-y-1">
                  {loadingBrowse ? (
                    <div className="py-6 text-center text-xs text-mist-500">Cargando carpetas…</div>
                  ) : browseData?.dirs && browseData.dirs.length > 0 ? (
                    browseData.dirs.map((dir) => (
                      <div
                        key={dir.path}
                        onClick={() => {
                          setRutaActual(dir.path);
                          setRutaSeleccionada(dir.path);
                        }}
                        className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer transition ${
                          rutaSeleccionada === dir.path ? 'bg-accent/20 text-accent font-semibold' : 'text-mist-200 hover:bg-white/5'
                        }`}
                      >
                        <span>📁</span>
                        <span className="truncate">{dir.name}</span>
                      </div>
                    ))
                  ) : (
                    <div className="py-6 text-center text-xs text-mist-500">
                      No hay subcarpetas aquí. Puedes seleccionar esta carpeta.
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-white/10 flex justify-end gap-2">
                <button
                  onClick={() => setModalAbierto(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-mist-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  disabled={!rutaSeleccionada || !nuevaLibNombre.trim()}
                  onClick={() => {
                    setLibraries([
                      ...libraries,
                      { name: nuevaLibNombre.trim(), path: rutaSeleccionada, kind: nuevaLibTipo },
                    ]);
                    setModalAbierto(false);
                  }}
                  className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-40"
                >
                  Añadir esta carpeta
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
