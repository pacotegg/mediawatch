import { useState } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type User } from '../lib/api.ts';

function Avatar({ user, onClick }: { user: User; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ y: -8, scale: 1.06 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      onClick={onClick}
      className="group flex flex-col items-center gap-3"
    >
      <div
        className="grid h-24 w-24 place-items-center rounded-3xl text-3xl font-semibold text-ink-950 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.9)] ring-1 ring-white/15 transition-shadow duration-300 group-hover:shadow-[0_26px_60px_-18px_rgba(0,0,0,0.95)]"
        style={{ background: `linear-gradient(140deg, ${user.color ?? '#f0a54a'}, ${user.color ?? '#f0a54a'}bb)` }}
      >
        {user.name.charAt(0).toUpperCase()}
      </div>
      <span className="text-sm text-mist-300 transition-colors group-hover:text-mist-100">{user.name}</span>
    </motion.button>
  );
}

export default function Login() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: api.users });
  const [selected, setSelected] = useState<User | null>(null);
  const [pin, setPin] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  const login = useMutation({
    mutationFn: (vars: { userId: number; pin?: string }) => api.login(vars.userId, vars.pin),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (err: Error) => setError(err.message),
  });

  const create = useMutation({
    mutationFn: () => api.createUser(newName.trim()),
    onSuccess: async (created) => {
      await api.login(created.id);
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => setError(err.message),
  });

  const pick = (user: User) => {
    setError('');
    if (user.has_pin) setSelected(user);
    else login.mutate({ userId: user.id });
  };

  if (isLoading) return <div className="grid min-h-screen place-items-center text-mist-500">Cargando…</div>;

  const setup = data?.setupNeeded;

  return (
    <div className="tinted grid min-h-screen place-items-center px-6" style={{ ['--tint' as string]: '240 165 74' }}>
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="w-full max-w-2xl text-center">
        <div className="mb-2 flex items-center justify-center gap-2.5">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" className="text-accent">
            <rect x="2" y="4" width="20" height="16" rx="3.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="M9 8.5v7l6-3.5-6-3.5Z" fill="currentColor" />
          </svg>
          <span className="text-2xl font-semibold tracking-tight">Media Watch</span>
        </div>

        {setup ? (
          <>
            <p className="mb-8 text-sm text-mist-500">Crea el primer perfil para empezar</p>
            <div className="glass mx-auto flex max-w-sm gap-2 rounded-2xl p-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && newName.trim() && create.mutate()}
                placeholder="Tu nombre"
                className="flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-mist-600"
              />
              <button
                disabled={!newName.trim() || create.isPending}
                onClick={() => create.mutate()}
                className="rounded-xl bg-mist-100 px-4 py-2 text-sm font-semibold text-ink-950 disabled:opacity-40"
              >
                Crear
              </button>
            </div>
          </>
        ) : selected ? (
          <>
            <p className="mb-6 text-sm text-mist-500">Introduce el PIN de {selected.name}</p>
            <div className="glass mx-auto flex max-w-xs gap-2 rounded-2xl p-2">
              <input
                autoFocus
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && login.mutate({ userId: selected.id, pin })}
                placeholder="PIN"
                className="flex-1 bg-transparent px-3 py-2 text-center text-lg tracking-[0.4em] outline-none placeholder:tracking-normal placeholder:text-mist-600"
              />
            </div>
            <button onClick={() => { setSelected(null); setPin(''); setError(''); }} className="mt-4 text-xs text-mist-500 hover:text-mist-100">
              ← Volver
            </button>
          </>
        ) : (
          <>
            <p className="mb-10 text-sm text-mist-500">¿Quién está viendo?</p>
            <div className="flex flex-wrap items-start justify-center gap-8">
              {data?.users.map((user) => (
                <Avatar key={user.id} user={user} onClick={() => pick(user)} />
              ))}
            </div>
          </>
        )}

        {error && <p className="mt-6 text-sm text-red-400">{error}</p>}
      </motion.div>
    </div>
  );
}
