#!/usr/bin/env node
/*
 * Generador y validador de licencias Media Watch (Ed25519)
 *
 * Uso:
 *   node src/cli/licencia.ts emitir --email usuario@dominio.com [--dias 365]
 *   node src/cli/licencia.ts verificar "<bloque-de-licencia>"
 */
import { emitirLicencia, parsearYVerificarLicencia } from '../media/licencia.ts';

// Clave privada de firma oficial (nunca se comparte con clientes, solo para emision)
const CLAVE_PRIVADA_EMISOR = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIAj1uJxo08QeHVvs9x9ptPZPjePbi2uAgIq+iSOQw/Hk
-----END PRIVATE KEY-----`.trim();

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

  const licencia = emitirLicencia({
    issuedTo: email,
    tier: 'pro',
    expiresAt,
    features: ['3d_cases', 'dialogue_search', 'themes', 'offline_downloads'],
    privateKeyPem: CLAVE_PRIVADA_EMISOR,
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
