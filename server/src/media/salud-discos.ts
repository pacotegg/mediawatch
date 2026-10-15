/**
 * Salud de los discos para los avisos de Ajustes -> Mantenimiento. Dos fuentes:
 *
 * 1. `Get-PhysicalDisk` de Windows (Healthy / Warning / Unhealthy). Funciona sin administrador (comprobado el
 *    15/10/2026) y se consulta con caché de 10 minutos. Es grueso: solo avisa cuando el disco ya lo dice.
 * 2. `data/salud-discos.json`, que escribe `server/scripts/salud-discos.ps1` desde una tarea programada con
 *    administrador (smartctl no puede abrir los discos sin él). Da el detalle: sectores reasignados o pendientes,
 *    temperatura, desgaste de los SSD. Los nombres de campo son los del JSON de smartctl 7.x; NO VERIFICADOS
 *    contra una salida real hasta la primera lectura con la tarea en marcha.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../config.ts';

export type Aviso = { nivel: 'error' | 'aviso'; texto: string };

// --- 1. Windows ---------------------------------------------------------------------------------------

let cacheWindows: { cuando: number; discos: { nombre: string; estado: string }[] } | null = null;
let consultando = false;

function consultarWindows() {
  if (process.platform !== 'win32' || consultando) return;
  consultando = true;
  let salida = '';
  const pwsh = 'C:/Program Files/PowerShell/7/pwsh.exe';
  const p = spawn(existsSync(pwsh) ? pwsh : 'powershell', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-PhysicalDisk | Select-Object FriendlyName,HealthStatus | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 20_000 });
  p.stdout.on('data', (d) => { salida += d; });
  p.on('error', () => { consultando = false; });
  p.on('close', () => {
    consultando = false;
    try {
      const j = JSON.parse(salida);
      const lista = (Array.isArray(j) ? j : [j]) as { FriendlyName?: string; HealthStatus?: string | number }[];
      cacheWindows = { cuando: Date.now(), discos: lista.map((d) => ({ nombre: String(d.FriendlyName ?? '?'), estado: String(d.HealthStatus ?? '') })) };
    } catch { /* sin datos esta vez */ }
  });
}

/** Lo de la última consulta (sin esperar); si es vieja, se pide otra para la próxima vez. */
export function avisosWindows(): Aviso[] {
  if (!cacheWindows || Date.now() - cacheWindows.cuando > 10 * 60_000) consultarWindows();
  if (!cacheWindows) return [];
  return cacheWindows.discos
    .filter((d) => d.estado && d.estado !== 'Healthy' && d.estado !== '0')
    .map((d) => ({ nivel: 'error' as const, texto: `Windows dice que el disco «${d.nombre}» no está sano (${d.estado}). Conviene copiar lo importante cuanto antes.` }));
}

// --- 2. SMART (tarea programada) -----------------------------------------------------------------------

type Atributo = { id: number; name?: string; raw?: { value?: number } };
type DiscoSmart = {
  model_name?: string;
  device?: { name?: string };
  smartctl?: { exit_status?: number; messages?: { string?: string }[] };
  smart_status?: { passed?: boolean };
  temperature?: { current?: number };
  ata_smart_attributes?: { table?: Atributo[] };
  nvme_smart_health_information_log?: { critical_warning?: number; media_errors?: number; percentage_used?: number };
};

/** Pura: de lo que escribe el script a avisos. Exportada para las pruebas. */
export function interpretarSmart(datos: { generado?: string; discos?: DiscoSmart[] }, ahora = Date.now()): Aviso[] {
  const avisos: Aviso[] = [];
  const horas = datos.generado ? (ahora - Date.parse(datos.generado)) / 3_600_000 : Infinity;
  if (!(horas < 26)) avisos.push({ nivel: 'aviso', texto: 'Los datos SMART de los discos tienen más de un día: ¿sigue funcionando la tarea programada?' });

  for (const d of datos.discos ?? []) {
    const nombre = d.model_name ?? d.device?.name ?? 'disco';
    const enReposo = (d.smartctl?.messages ?? []).some((m) => /standby|sleep/i.test(m.string ?? ''));
    if (enReposo) continue; // dormido: se mira la próxima vez, sin despertarlo
    if (d.smart_status?.passed === false) avisos.push({ nivel: 'error', texto: `El disco «${nombre}» dice que va a fallar (SMART). Copia lo importante ya.` });

    const attr = (id: number) => d.ata_smart_attributes?.table?.find((a) => a.id === id)?.raw?.value ?? 0;
    const reasignados = attr(5), pendientes = attr(197), incorregibles = attr(198);
    if (pendientes > 0 || incorregibles > 0) {
      avisos.push({ nivel: 'error', texto: `El disco «${nombre}» tiene sectores que no se pueden leer (${pendientes} pendientes, ${incorregibles} incorregibles).` });
    } else if (reasignados > 0) {
      avisos.push({ nivel: 'aviso', texto: `El disco «${nombre}» ha tenido que reasignar ${reasignados} sectores: vigilar si el número sube.` });
    }

    const nvme = d.nvme_smart_health_information_log;
    if (nvme) {
      if ((nvme.critical_warning ?? 0) !== 0) avisos.push({ nivel: 'error', texto: `El SSD «${nombre}» da un aviso crítico (SMART).` });
      if ((nvme.media_errors ?? 0) > 0) avisos.push({ nivel: 'aviso', texto: `El SSD «${nombre}» tiene ${nvme.media_errors} errores de datos.` });
      if ((nvme.percentage_used ?? 0) >= 90) avisos.push({ nivel: 'aviso', texto: `El SSD «${nombre}» ha gastado el ${nvme.percentage_used} % de su vida útil.` });
    }

    const t = d.temperature?.current;
    if (typeof t === 'number' && t >= 55) avisos.push({ nivel: 'aviso', texto: `El disco «${nombre}» está a ${t} °C.` });
  }
  return avisos;
}

export function avisosSmart(): Aviso[] {
  const ruta = join(DATA_DIR, 'salud-discos.json');
  try {
    statSync(ruta);
  } catch {
    return []; // sin la tarea programada no hay detalle; queda lo de Windows
  }
  try {
    // PowerShell 5 escribe UTF-8 con BOM, y JSON.parse no lo admite.
    return interpretarSmart(JSON.parse(readFileSync(ruta, 'utf8').replace(/^﻿/, '')));
  } catch {
    return [{ nivel: 'aviso', texto: 'No se pudo leer data/salud-discos.json (datos SMART).' }];
  }
}
