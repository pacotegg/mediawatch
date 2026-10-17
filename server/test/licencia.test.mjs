/*
 * Pruebas del sistema de licencias criptograficas offline Ed25519:
 * - Generacion y validacion matematica de firmas digitales.
 * - Rechazo de claves falsificadas o con payload manipulado.
 * - Deteccion de licencias expiradas vs vitalicias (lifetime).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { CLAVE_PUBLICA_OFICIAL, emitirLicencia, parsearYVerificarLicencia, tieneFuncionLicencia } from '../src/media/licencia.ts';

test('sistema de licencias Ed25519', async () => {
  // Comprobar que la clave publica oficial esta presente y bien formada
  assert.ok(CLAVE_PUBLICA_OFICIAL.includes('-----BEGIN PUBLIC KEY-----'));
  assert.ok(CLAVE_PUBLICA_OFICIAL.includes('-----END PUBLIC KEY-----'));

  // Generar par de prueba temporal
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  // 1. Licencia vitalicia valida
  const licValida = emitirLicencia({
    issuedTo: 'usuario@prueba.com',
    tier: 'pro',
    expiresAt: 0,
    features: ['3d_cases', 'dialogue_search', 'themes'],
    privateKeyPem: privPem,
  });

  assert.ok(licValida.includes('-----BEGIN MEDIA WATCH LICENSE-----'));
  assert.ok(licValida.includes('-----END MEDIA WATCH LICENSE-----'));

  const verif1 = parsearYVerificarLicencia(licValida, pubPem);
  assert.equal(verif1.valid, true);
  assert.equal(verif1.tier, 'pro');
  assert.equal(verif1.issuedTo, 'usuario@prueba.com');
  assert.equal(verif1.expiresAt, 0);
  assert.deepEqual(verif1.features, ['3d_cases', 'dialogue_search', 'themes']);

  // 2. Licencia manipulada (cambio de email con misma firma)
  const licManipulada = licValida.replace('usuario@prueba.com', 'hacker@prueba.com');
  const verif2 = parsearYVerificarLicencia(licManipulada, pubPem);
  assert.equal(verif2.valid, false);
  assert.ok(verif2.error?.includes('Firma digital'));

  // 3. Licencia expirada
  const haceUnMes = Date.now() - 30 * 24 * 3600 * 1000;
  const licExpirada = emitirLicencia({
    issuedTo: 'caducado@prueba.com',
    tier: 'pro',
    expiresAt: haceUnMes,
    features: ['3d_cases'],
    privateKeyPem: privPem,
  });
  const verif3 = parsearYVerificarLicencia(licExpirada, pubPem);
  assert.equal(verif3.valid, false);
  assert.ok(verif3.error?.includes('expirada'));

  // 4. Clave de texto basura o malformada
  const verif4 = parsearYVerificarLicencia('MWPRO-1234-FAKE-KEY', pubPem);
  assert.equal(verif4.valid, false);
  assert.ok(verif4.error);

  // 5. Verificacion de tieneFuncionLicencia en entorno de desarrollo/pruebas
  assert.equal(tieneFuncionLicencia('themes'), true);
  assert.equal(tieneFuncionLicencia('dialogue_search'), true);
  assert.equal(tieneFuncionLicencia('3d_cases'), true);
  assert.equal(tieneFuncionLicencia('offline_downloads'), true);
  assert.equal(tieneFuncionLicencia('funcion_inexistente'), true); // Tier Pro autoriza todas
});

