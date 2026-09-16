/**
 * Estadísticas del servidor.
 *
 * Tres preguntas, tres bloques: qué tengo, qué se ve y qué está mal.
 *
 * Todas las barras miden lo mismo dentro de cada gráfica —cuántos ficheros, o
 * cuánto ocupan— así que van de un solo color: el color aquí no identifica a
 * nadie, solo dibuja la magnitud, y repartir tonos distintos sugeriría una
 * diferencia que no existe. Cada barra lleva su cifra escrita al lado, de modo
 * que la gráfica se puede leer también como tabla.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { api } from '../lib/api.ts';
import { languageName } from '../lib/format.ts';

const RANGOS: [number, string][] = [
  [7, '7 días'],
  [30, '30 días'],
  [90, '90 días'],
  [365, 'Un año'],
];

function tamano(bytes: number) {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${Math.round(bytes / 1e9)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${bytes} B`;
}

function horas(segundos: number) {
  const h = segundos / 3600;
  if (h >= 100) return `${Math.round(h).toLocaleString('es')} h`;
  if (h >= 1) return `${h.toFixed(1)} h`;
  return `${Math.round(segundos / 60)} min`;
}

/** «1 ficheros» canta; el plural se decide con el número, no se pega y ya. */
const plural = (n: number, singular: string, plural_: string) => `${n.toLocaleString('es')} ${n === 1 ? singular : plural_}`;

function Tarjeta({ titulo, valor, pie }: { titulo: string; valor: string; pie?: string }) {
  return (
    <div className="glass rounded-[var(--radius-card)] p-4">
      <div className="text-[12px] text-mist-600">{titulo}</div>
      <div className="mt-1 text-[26px] leading-none font-semibold tracking-tight tabular-nums">{valor}</div>
      {pie && <div className="mt-1 text-[12px] text-mist-500">{pie}</div>}
    </div>
  );
}

type Fila = { etiqueta: string; valor: number; nota?: string; a?: string };

/** Barras horizontales de una sola serie: la longitud es el dato, el color no dice nada. */
function Barras({ titulo, filas, formato }: { titulo: string; filas: Fila[]; formato: (n: number) => string }) {
  const maximo = Math.max(1, ...filas.map((f) => f.valor));
  if (filas.length === 0) return null;

  return (
    <div className="glass rounded-[var(--radius-panel)] p-4">
      <h3 className="mb-3 text-[13px] font-semibold tracking-tight">{titulo}</h3>
      <div className="space-y-2">
        {filas.map((f) => {
          const fila = (
            <>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="truncate text-mist-300">{f.etiqueta}</span>
                <span className="shrink-0 tabular-nums text-mist-500">
                  {formato(f.valor)}
                  {f.nota ? <span className="ml-2 text-mist-600">{f.nota}</span> : null}
                </span>
              </div>
              <div className="h-2 rounded-full bg-white/6">
                <div
                  className="h-2 rounded-full bg-accent transition-[width] duration-500 ease-[var(--ease-out)]"
                  style={{ width: `${Math.max(1.5, (f.valor / maximo) * 100)}%` }}
                />
              </div>
            </>
          );
          return f.a ? (
            <Link key={f.etiqueta} to={f.a} className="block rounded-lg p-1 -m-1 transition-colors hover:bg-white/5">
              {fila}
            </Link>
          ) : (
            <div key={f.etiqueta} className="p-1 -m-1">
              {fila}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Horas vistas por día. Con una sola serie no hace falta leyenda: la nombra el título. */
function PorDia({ datos }: { datos: { dia: string; segundos: number }[] }) {
  const [encima, setEncima] = useState<number | null>(null);
  const ancho = 640;
  const alto = 130;

  const puntos = useMemo(() => {
    const maximo = Math.max(1, ...datos.map((d) => d.segundos));
    const paso = datos.length > 1 ? ancho / (datos.length - 1) : ancho;
    return datos.map((d, i) => ({ ...d, x: i * paso, y: alto - (d.segundos / maximo) * (alto - 12) }));
  }, [datos]);

  if (datos.length === 0) return null;

  const linea = puntos.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `0,${alto} ${linea} ${ancho},${alto}`;
  const activo = encima != null ? puntos[encima] : null;

  return (
    <div className="glass rounded-[var(--radius-panel)] p-4">
      <h3 className="mb-3 text-[13px] font-semibold tracking-tight">Horas vistas por día</h3>
      <div className="relative">
        <svg viewBox={`0 0 ${ancho} ${alto}`} className="w-full" preserveAspectRatio="none" style={{ height: 130 }}>
          <polygon points={area} fill="var(--color-accent)" opacity="0.16" />
          <polyline points={linea} fill="none" stroke="var(--color-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {activo && (
            <>
              <line x1={activo.x} y1="0" x2={activo.x} y2={alto} stroke="var(--color-mist-600)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <circle cx={activo.x} cy={activo.y} r="4" fill="var(--color-accent)" stroke="var(--color-ink-900)" strokeWidth="2" />
            </>
          )}
          {puntos.map((p, i) => (
            <rect
              key={p.dia}
              x={p.x - ancho / (puntos.length * 2)}
              y="0"
              width={ancho / puntos.length}
              height={alto}
              fill="transparent"
              onMouseEnter={() => setEncima(i)}
              onMouseLeave={() => setEncima(null)}
            />
          ))}
        </svg>
        {activo && (
          <div className="pointer-events-none absolute -top-1 rounded-lg bg-ink-800 px-2 py-1 text-[11.5px] shadow-[var(--shadow-2)]" style={{ left: `${(activo.x / ancho) * 100}%` }}>
            {new Date(activo.dia).toLocaleDateString('es', { day: 'numeric', month: 'short' })} · {horas(activo.segundos)}
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11.5px] text-mist-600">
        <span>{new Date(datos[0].dia).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</span>
        <span>{new Date(datos[datos.length - 1].dia).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</span>
      </div>
    </div>
  );
}

export default function Estadisticas() {
  const [dias, setDias] = useState(30);
  const { data, isLoading, error } = useQuery({ queryKey: ['estadisticas', dias], queryFn: () => api.estadisticas(dias), retry: false });

  if (isLoading) return <div className="p-8 text-[13px] text-mist-500">Calculando…</div>;
  if (error) return <div className="p-8 text-[13px] text-red-400">{(error as Error).message}</div>;
  if (!data) return null;

  const { biblioteca: b, actividad: a, salud: s } = data;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto max-w-[1300px] px-4 py-8 sm:px-8"
    >
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Estadísticas</h1>
      <p className="mb-6 text-[13px] text-mist-500">Qué hay en la biblioteca, qué se está viendo y qué está incompleto.</p>

      <section className="mb-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tarjeta titulo="Títulos" valor={b.titulos.toLocaleString('es')} pie={`${b.peliculas} películas · ${b.series} series`} />
          <Tarjeta titulo="Ficheros" valor={b.ficheros.toLocaleString('es')} pie={`${b.episodios.toLocaleString('es')} episodios`} />
          <Tarjeta titulo="Ocupado" valor={tamano(b.bytes)} />
          <Tarjeta titulo="Duración total" valor={horas(b.segundos)} pie={`${Math.round(b.segundos / 86400)} días seguidos`} />
        </div>
      </section>

      <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Qué hay</h2>
      <section className="mb-8 grid gap-3 lg:grid-cols-2">
        <Barras
          titulo="Resolución"
          formato={(n) => plural(n, 'fichero', 'ficheros')}
          filas={b.resolucion.map((r) => ({ etiqueta: r.etiqueta, valor: r.n, nota: tamano(r.bytes) }))}
        />
        <Barras
          titulo="Códec de vídeo"
          formato={(n) => plural(n, 'fichero', 'ficheros')}
          filas={b.codec.map((r) => ({ etiqueta: r.etiqueta, valor: r.n, nota: tamano(r.bytes) }))}
        />
        <Barras titulo="Rango dinámico" formato={(n) => plural(n, 'fichero', 'ficheros')} filas={b.hdr.map((r) => ({ etiqueta: r.etiqueta, valor: r.n }))} />
        <Barras titulo="Códec de audio" formato={(n) => plural(n, 'pista', 'pistas')} filas={b.audio.map((r) => ({ etiqueta: r.etiqueta, valor: r.n }))} />
        <Barras
          titulo="Idiomas de audio"
          formato={(n) => plural(n, 'fichero', 'ficheros')}
          filas={b.idiomasAudio.map((r) => ({ // `und` es la marca de «indeterminado» de Matroska: es lo mismo que no marcarlo.
            etiqueta: r.etiqueta === 'sin marcar' || r.etiqueta.toLowerCase() === 'und' ? 'Sin marcar' : languageName(r.etiqueta), valor: r.n }))}
        />
        <Barras
          titulo="Espacio por biblioteca"
          formato={tamano}
          filas={b.porBiblioteca.map((r) => ({ etiqueta: r.nombre, valor: r.bytes, nota: plural(r.titulos, 'título', 'títulos') }))}
        />
      </section>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Qué se ve</h2>
        <div className="flex gap-1.5">
          {RANGOS.map(([valor, texto]) => (
            <button
              key={valor}
              onClick={() => setDias(valor)}
              className={`rounded-full px-3 py-1.5 text-[12.5px] transition-colors ${
                dias === valor ? 'bg-mist-100 font-semibold text-ink-950' : 'bg-white/8 hover:bg-white/14'
              }`}
            >
              {texto}
            </button>
          ))}
        </div>
      </div>

      <section className="mb-8">
        {a.sesiones === 0 ? (
          <div className="glass rounded-[var(--radius-panel)] p-6 text-[13px] text-mist-500">
            Todavía no hay nada visto en este periodo. El historial empieza a contar en cuanto alguien le dé a reproducir; hasta entonces
            no hay datos que inventar.
          </div>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Tarjeta titulo="Tiempo visto" valor={horas(a.segundos)} pie={`en ${dias} días`} />
              <Tarjeta titulo="Sesiones" valor={a.sesiones.toLocaleString('es')} />
              <Tarjeta titulo="Títulos distintos" valor={a.titulos.toLocaleString('es')} />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <PorDia datos={a.porDia} />
              <Barras titulo="Por quién" formato={horas} filas={a.porUsuario.map((r) => ({ etiqueta: r.nombre, valor: r.segundos, nota: plural(r.sesiones, 'sesión', 'sesiones') }))} />
              <Barras titulo="Desde dónde" formato={horas} filas={a.porCliente.map((r) => ({ etiqueta: r.nombre, valor: r.segundos, nota: plural(r.sesiones, 'sesión', 'sesiones') }))} />
              <Barras
                titulo="Cómo se sirvió"
                formato={(n) => plural(n, 'sesión', 'sesiones')}
                filas={a.porModo.map((r) => ({
                  etiqueta: { raw: 'Fichero original', direct: 'Directo', remux: 'Remultiplexado', transcode: 'Transcodificado' }[r.nombre] ?? r.nombre,
                  valor: r.sesiones,
                }))}
              />
              <Barras
                titulo="Más vistos"
                formato={horas}
                filas={a.masVistos.map((r) => ({ etiqueta: r.titulo, valor: r.segundos, nota: `${r.sesiones}×`, a: `/titulo/${r.itemId}` }))}
              />

              <div className="glass rounded-[var(--radius-panel)] p-4">
                <h3 className="mb-3 text-[13px] font-semibold tracking-tight">Lo último</h3>
                <div className="space-y-1.5">
                  {a.reciente.map((r, i) => (
                    <Link key={`${r.itemId}-${i}`} to={`/titulo/${r.itemId}`} className="flex items-baseline justify-between gap-3 rounded-lg px-1 py-1 text-[12.5px] hover:bg-white/5">
                      <span className="truncate text-mist-300">
                        {r.titulo}
                        {r.episodio && <span className="ml-1.5 text-mist-600">{r.episodio}</span>}
                      </span>
                      <span className="shrink-0 text-mist-600">
                        {r.usuario} · {new Date(r.cuando).toLocaleDateString('es', { day: 'numeric', month: 'short' })}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      <h2 className="mb-3 text-[15px] font-semibold tracking-tight">Qué está incompleto</h2>
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="grid grid-cols-2 gap-3">
          <Tarjeta titulo="Sin metadatos" valor={s.sinMetadatos.toLocaleString('es')} pie="falta portada, fondo o sinopsis" />
          <Tarjeta titulo="Sin subtítulos" valor={s.sinSubtitulos.toLocaleString('es')} pie="ficheros sin ninguna pista" />
          <Tarjeta titulo="Sin analizar" valor={s.sinAnalizar.toLocaleString('es')} pie="ffprobe no ha pasado" />
          <Tarjeta titulo="Episodios sin fichero" valor={s.episodiosSinFichero.toLocaleString('es')} pie="están en la ficha pero no en disco" />
        </div>

        <div className="glass rounded-[var(--radius-panel)] p-4">
          <h3 className="mb-2 text-[13px] font-semibold tracking-tight">Posibles duplicados</h3>
          {s.duplicados.length === 0 ? (
            <p className="text-[12.5px] text-mist-500">Ninguno: no hay dos títulos con el mismo nombre y año.</p>
          ) : (
            <div className="space-y-1">
              {s.duplicados.map((d) => (
                <div key={`${d.titulo}-${d.anio}`} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="truncate text-mist-300">{d.titulo}</span>
                  <span className="shrink-0 text-mist-600">
                    {d.anio ?? 's/f'} · {plural(d.n, 'copia', 'copias')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {s.sinFichero.length > 0 && (
            <>
              <h3 className="mt-4 mb-2 text-[13px] font-semibold tracking-tight">Fichas sin ningún fichero</h3>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {s.sinFichero.map((f) => (
                  <Link key={f.id} to={`/titulo/${f.id}`} className="block truncate text-[12.5px] text-mist-400 hover:text-mist-100">
                    {f.titulo}
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </motion.div>
  );
}
