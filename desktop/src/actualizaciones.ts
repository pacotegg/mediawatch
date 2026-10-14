import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Actualización automática. El apunte `latest.yml` vive en una etiqueta fija del repo
 * (`escritorio-latest`) y dentro lleva la dirección completa del instalador de la versión nueva.
 *
 * No se usa el proveedor de GitHub a propósito: pregunta por la «última release» del repo, que es la
 * de la app Android (`v3.x`), y nunca encontraría el apunte del escritorio.
 *
 * Se descarga sola en segundo plano y se instala al salir. En desarrollo no hace nada.
 */
const CADA_HORAS = 6;

function anotar(mensaje: string) {
  try {
    appendFileSync(join(app.getPath('userData'), 'actualizaciones.log'), `${new Date().toISOString()} ${mensaje}\n`);
  } catch {
    // Sin registro no hay nada más que hacer.
  }
}

export function iniciarActualizaciones(ventana: () => BrowserWindow | null) {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  // Al salir, no mientras se está viendo algo.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (i) => anotar(`hay version ${i.version}`));
  autoUpdater.on('update-not-available', () => anotar('al dia'));
  autoUpdater.on('error', (e) => anotar(`error: ${e.message}`));
  autoUpdater.on('update-downloaded', (i) => {
    anotar(`descargada ${i.version}, se instalara al salir`);
    ventana()?.webContents.send('mw:actualizacion', { version: i.version });
  });

  const buscar = () => autoUpdater.checkForUpdates().catch((e: Error) => anotar(`error al buscar: ${e.message}`));
  setTimeout(buscar, 8_000);
  setInterval(buscar, CADA_HORAS * 3_600_000);
}
