import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { api } from '../lib/api.ts';

/**
 * Destino del QR que muestra la televisión. Se abre en el móvil, empareja sola
 * y no hay que teclear el código a mano ni salir de la app en la tele.
 */
export default function Pair() {
  const [params] = useSearchParams();
  const code = params.get('c') ?? '';
  const [estado, setEstado] = useState<'pidiendo' | 'hecho' | 'error'>('pidiendo');
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    if (!code) {
      setEstado('error');
      setMensaje('El enlace no trae ningún código.');
      return;
    }
    api
      .pairDevice(code)
      .then((r) => {
        setEstado('hecho');
        setMensaje(`Televisión conectada al perfil de ${r.user}.`);
      })
      .catch((err: Error) => {
        setEstado('error');
        setMensaje(err.message);
      });
  }, [code]);

  return (
    <div className="grid min-h-screen place-items-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="glass w-full max-w-md rounded-[var(--radius-panel)] p-8 text-center"
      >
        <div className="mb-5 grid place-items-center">
          {estado === 'pidiendo' && <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-white/90" />}
          {estado === 'hecho' && (
            <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500/20 text-emerald-300">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12.5 9.5 18 20 6.5" />
              </svg>
            </div>
          )}
          {estado === 'error' && (
            <div className="grid h-14 w-14 place-items-center rounded-full bg-red-500/20 text-red-300 text-2xl">!</div>
          )}
        </div>

        <h1 className="text-xl font-semibold tracking-tight">
          {estado === 'pidiendo' ? 'Conectando la televisión…' : estado === 'hecho' ? 'Ya está' : 'No se pudo conectar'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-mist-400">{mensaje}</p>

        {estado === 'hecho' && (
          <p className="mt-5 text-[13px] text-mist-500">Ya puedes soltar el móvil: la tele entra sola en tu biblioteca.</p>
        )}
        {estado === 'error' && (
          <p className="mt-5 text-[13px] text-mist-500">
            Los códigos caducan a los diez minutos. Vuelve a la pantalla de la tele para que genere uno nuevo.
          </p>
        )}
      </motion.div>
    </div>
  );
}
