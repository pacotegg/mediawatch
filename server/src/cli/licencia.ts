#!/usr/bin/env node
/*
 * Generador y validador de licencias Media Watch (Ed25519)
 *
 * Uso:
 *   node src/cli/licencia.ts emitir --email usuario@dominio.com [--dias 365]
 *   node src/cli/licencia.ts verificar "<bloque-de-licencia>"
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../config.ts';
import { emitirLicencia, parsearYVerificarLicencia } from '../media/licencia.ts';

function obtenerClavePrivadaEmisor(): string {
  if (process.env.MEDIAWATCH_LICENSE_PRIVATE_KEY) {
    return process.env.MEDIAWATCH_LICENSE_PRIVATE_KEY.trim();
  }
  const rutaFichero = process.env.MEDIAWATCH_LICENSE_KEY_FILE || join(DATA_DIR, 'license-private.pem');
  if (existsSync(rutaFichero)) {
    return readFileSync(rutaFichero, 'utf8').trim();
  }
  throw new Error(
    `No se encontró la clave privada de emisión Ed25519.\n` +
    `Configura la variable de entorno MEDIAWATCH_LICENSE_PRIVATE_KEY o coloca el fichero en:\n` +
    `  ${rutaFichero}`
  );
}

const args = process.argv.slice(2);
const comando = args[0];

function argValor(nombre: string): string | undefined {
  const idx = args.indexOf(nombre);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

if (comando === 'emitir') {
  const email = argValor('--email') || argValor('-e');
  if (!email) {
    console.error('Uso: node src/cli/licencia.ts emitir --email usuario@correo.com [--dias 365]');
    process.exit(1);
  }

  const diasStr = argValor('--dias');
  const dias = diasStr ? Number(diasStr) : 0;
  const expiresAt = dias > 0 ? Date.now() + dias * 24 * 3600 * 1000 : 0;

  let privateKeyPem: string;
  try {
    privateKeyPem = obtenerClavePrivadaEmisor();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const licencia = emitirLicencia({
    issuedTo: email,
    tier: 'pro',
    expiresAt,
    features: ['3d_cases', 'dialogue_search', 'themes', 'offline_downloads'],
    privateKeyPem,
  });

  console.log('\n--- LICENCIA GENERADA CON ÉXITO ---');
  console.log(`Titular:    ${email}`);
  console.log(`Tipo:       ${expiresAt === 0 ? 'Vitalicia (Lifetime)' : `${dias} días (hasta ${new Date(expiresAt).toLocaleDateString('es-ES')})`}`);
  console.log(`Funciones:  3D Cases, Whisper Dialogue Search, Themes, Offline Downloads`);
  console.log('-----------------------------------\n');
  console.log(licencia);
  console.log('\n-----------------------------------');
} else if (comando === 'verificar') {
  const texto = args.slice(1).join(' ');
  const res = parsearYVerificarLicencia(texto);
  console.log(JSON.stringify(res, null, 2));
} else {
  console.log('Comandos disponibles:');
  console.log('  node src/cli/licencia.ts emitir --email <correo> [--dias <N>]');
  console.log('  node src/cli/licencia.ts verificar "<licencia>"');
}
