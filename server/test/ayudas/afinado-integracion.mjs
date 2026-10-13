// Proceso aparte: siembra una BD temporal con una pelicula sintetica y ejecuta el afinado de verdad.
// Uso: node afinado-integracion.mjs <video> <subtitulo>   (con MEDIAWATCH_DATA_DIR ya apuntando a una carpeta temporal)
const [video, subtitulo] = process.argv.slice(2);
const { db } = await import('../../src/db.ts');
const { afinarPeliculas, jobAfinado, deshacerAfinado } = await import('../../src/media/creditos-afinado.ts');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

db.prepare("INSERT OR IGNORE INTO libraries (id,name,path,kind) VALUES (1,'t','x','movie')").run();
const it = db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, scanned_at) VALUES (1,'movie','x','Sintetica','sintetica','x') RETURNING id").get();
const f = db.prepare('INSERT INTO media_files (item_id, path, duration, width, height, probed) VALUES (?,?,1860,160,90,1) RETURNING id').get(it.id, video);
db.prepare('INSERT INTO sub_tracks (file_id, idx, codec, language, forced, external) VALUES (?,?,?,?,0,?)').run(f.id, 0, 'srt', 'spa', subtitulo);
const original = '[{"start_s":1780,"end_s":1850}]';
db.prepare("INSERT INTO pelicula_creditos (item_id, rangos, escenas, metodo, created_at) VALUES (?,?,'[]','texto-sube','x')").run(it.id, original);

const total = afinarPeliculas();
for (let i = 0; i < 240 && jobAfinado.running; i++) await esperar(500);
const afinadas = jobAfinado.afinadas; // la segunda pasada reinicia el contador
const tras = db.prepare('SELECT rangos, rangos_texto, metodo FROM pelicula_creditos WHERE item_id = ?').get(it.id);
const segunda = afinarPeliculas();
for (let i = 0; i < 40 && jobAfinado.running; i++) await esperar(500);
const vueltas = deshacerAfinado();
const final = db.prepare('SELECT rangos, metodo FROM pelicula_creditos WHERE item_id = ?').get(it.id);
console.log(JSON.stringify({ total, afinadas, tras, segunda, vueltas, final }));
process.exit(0);
