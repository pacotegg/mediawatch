import { sign, verify } from 'node:crypto';
import { config } from '../config.ts';

export const CLAVE_PUBLICA_OFICIAL = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAJBEukfOIIof3vdE7fh6sBUYXLkDsTHS1nkz3+K153BY=
-----END PUBLIC KEY-----`.trim();

export type LicenciaPayload = {
  issuedTo: string;
  tier: 'free' | 'pro';
  expiresAt: number; // 0 = vitalicia
  features: string[];
};

export type ResultadoLicencia = {
  valid: boolean;
  tier: 'free' | 'pro';
  issuedTo?: string;
  issuedAt?: string;
  expiresAt?: number;
  features: string[];
  error?: string;
};

/**
 * Emite un bloque de licencia firmado con la clave privada Ed25519.
 */
export function emitirLicencia(opts: LicenciaPayload & { privateKeyPem: string }): string {
  const lineasPayload = [
    'Type: Media Watch License',
    `Tier: ${opts.tier}`,
    `Issued-To: ${opts.issuedTo.trim()}`,
    `Issued-At: ${new Date().toISOString()}`,
    `Expires-At: ${opts.expiresAt}`,
    `Features: ${opts.features.join(',')}`,
  ];
  const payloadCanonica = lineasPayload.join('\n');
  const firmaBuffer = sign(null, Buffer.from(payloadCanonica, 'utf8'), opts.privateKeyPem);
  const firmaBase64 = firmaBuffer.toString('base64');

  return [
    '-----BEGIN MEDIA WATCH LICENSE-----',
    payloadCanonica,
    `Signature: ${firmaBase64}`,
    '-----END MEDIA WATCH LICENSE-----',
  ].join('\n');
}

/**
 * Parsea y verifica una licencia de texto contra la clave pública Ed25519.
 * Comprueba integridad matemática y fecha de expiración.
 */
export function parsearYVerificarLicencia(bloqueTexto: string, clavePublicaPem = CLAVE_PUBLICA_OFICIAL): ResultadoLicencia {
  if (!bloqueTexto || typeof bloqueTexto !== 'string') {
    return { valid: false, tier: 'free', features: [], error: 'Licencia vacía o inválida' };
  }

  const inicio = bloqueTexto.indexOf('-----BEGIN MEDIA WATCH LICENSE-----');
  const fin = bloqueTexto.indexOf('-----END MEDIA WATCH LICENSE-----');
  if (inicio === -1 || fin === -1 || fin <= inicio) {
    return { valid: false, tier: 'free', features: [], error: 'Formato de licencia no reconocido' };
  }

  const contenido = bloqueTexto.slice(inicio + '-----BEGIN MEDIA WATCH LICENSE-----'.length, fin).trim();
  const lineas = contenido.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let signatureBase64 = '';
  const payloadLineas: string[] = [];
  const valores: Record<string, string> = {};

  for (const linea of lineas) {
    const colonIdx = linea.indexOf(':');
    if (colonIdx === -1) continue;
    const clave = linea.slice(0, colonIdx).trim();
    const valor = linea.slice(colonIdx + 1).trim();
    if (clave === 'Signature') {
      signatureBase64 = valor;
    } else {
      payloadLineas.push(linea);
      valores[clave] = valor;
    }
  }

  if (!signatureBase64) {
    return { valid: false, tier: 'free', features: [], error: 'Falta la firma digital en la licencia' };
  }

  const payloadCanonica = payloadLineas.join('\n');

  try {
    const firmaValida = verify(
      null,
      Buffer.from(payloadCanonica, 'utf8'),
      clavePublicaPem,
      Buffer.from(signatureBase64, 'base64'),
    );

    if (!firmaValida) {
      return { valid: false, tier: 'free', features: [], error: 'Firma digital no válida o licencia manipulada' };
    }
  } catch (err) {
    return { valid: false, tier: 'free', features: [], error: 'Error verificando firma: ' + (err as Error).message };
  }

  const tier = (valores['Tier']?.toLowerCase() === 'pro' ? 'pro' : 'free') as 'free' | 'pro';
  const issuedTo = valores['Issued-To'] || 'Desconocido';
  const issuedAt = valores['Issued-At'];
  const expiresAt = Number(valores['Expires-At'] ?? 0);
  const features = (valores['Features'] ?? '').split(',').map((f) => f.trim()).filter(Boolean);

  // Comprobar expiración si no es vitalicia (expiresAt > 0)
  if (expiresAt > 0 && Date.now() > expiresAt) {
    return {
      valid: false,
      tier: 'free',
      issuedTo,
      issuedAt,
      expiresAt,
      features,
      error: `La licencia está expirada desde el ${new Date(expiresAt).toLocaleDateString('es-ES')}`,
    };
  }

  return {
    valid: true,
    tier,
    issuedTo,
    issuedAt,
    expiresAt,
    features,
  };
}

/**
 * Devuelve el estado de licencia del servidor actual.
 */
export function estadoLicenciaServidor(): ResultadoLicencia {
  const claveGuardada = (config as unknown as { licenseKey?: string }).licenseKey;
  if (!claveGuardada) {
    // Si no hay clave pero es el HTPC de casa original (no portable), activar Pro por defecto
    const deCasa = !process.env.MEDIAWATCH_DATA_DIR;
    return {
      valid: deCasa,
      tier: deCasa ? 'pro' : 'free',
      issuedTo: deCasa ? 'Casa (Desarrollador)' : undefined,
      expiresAt: 0,
      features: deCasa ? ['3d_cases', 'dialogue_search', 'themes', 'offline_downloads'] : [],
    };
  }

  return parsearYVerificarLicencia(claveGuardada);
}
