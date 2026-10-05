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
      {user.has_avatar ? (
        <div className="relative h-24 w-24 overflow-hidden rounded-3xl shadow-[0_18px_40px_-16px_rgba(0,0,0,0.9)] ring-1 ring-white/15 transition-shadow duration-300 group-hover:shadow-[0_26px_60px_-18px_rgba(0,0,0,0.95)]">
          <img
            src={api.userAvatarUrl(user.id)}
            alt={user.name}
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div
          className="grid h-24 w-24 place-items-center rounded-3xl text-3xl font-semibold text-ink-950 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.9)] ring-1 ring-white/15 transition-shadow duration-300 group-hover:shadow-[0_26px_60px_-18px_rgba(0,0,0,0.95)]"
          style={{ background: `linear-gradient(140deg, ${user.color ?? '#f0a54a'}, ${user.color ?? '#f0a54a'}bb)` }}
        >
          {user.name.charAt(0).toUpperCase()}
        </div>
      )}
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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (pin) login.mutate({ userId: selected.id, pin });
            }}
            className="mx-auto max-w-xs"
          >
            <div className="mb-4 flex flex-col items-center gap-2">
              {selected.has_avatar ? (
                <img
                  src={api.userAvatarUrl(selected.id)}
                  alt={selected.name}
                  className="h-16 w-16 rounded-2xl object-cover ring-1 ring-white/15"
                />
              ) : (
                <div
                  className="grid h-16 w-16 place-items-center rounded-2xl text-2xl font-semibold text-ink-950 ring-1 ring-white/15"
                  style={{ background: `linear-gradient(140deg, ${selected.color ?? '#f0a54a'}, ${selected.color ?? '#f0a54a'}bb)` }}
                >
                  {selected.name.charAt(0).toUpperCase()}
                </div>
              )}
              <p className="text-sm text-mist-400">
                Introduce el PIN de <strong className="text-mist-100">{selected.name}</strong>
              </p>
            </div>
            <div className="glass flex gap-2 rounded-2xl p-2">
              <input
                autoFocus
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                value={pin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setPin(val);
                  if (val.length === 6) {
                    login.mutate({ userId: selected.id, pin: val });
                  }
                }}
                placeholder="PIN"
                className="flex-1 bg-transparent px-3 py-2 text-center text-lg tracking-[0.4em] outline-none placeholder:tracking-normal placeholder:text-mist-600"
              />
              <button
                type="submit"
                disabled={login.isPending || !pin}
                className="rounded-xl bg-mist-100 px-4 py-2 text-sm font-semibold text-ink-950 disabled:opacity-40"
              >
                Entrar
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setPin('');
                setError('');
              }}
              className="mt-4 text-xs text-mist-500 hover:text-mist-100"
            >
              ← Volver
            </button>
          </form>
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
