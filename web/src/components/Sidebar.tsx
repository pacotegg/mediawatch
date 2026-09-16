import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type User } from '../lib/api.ts';

const STORAGE_KEY = 'cineteca.sidebar';

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z',
  movie: 'M3 5.5h18v13H3zM3 9.5h18M8 5.5v4M16 5.5v4M8 14.5h8',
  show: 'M4 8h16v11H4zM9 4l3 4 3-4',
  saga: 'M4 6h10M4 12h16M4 18h13',
  heart: 'M12 20.5s-7-4.4-8.7-8.4A5 5 0 0 1 12 6.8a5 5 0 0 1 8.7 5.3C19 16.1 12 20.5 12 20.5Z',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9h-.2a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.4-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5v-.2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1Z',
  stats: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  download: 'M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  collapse: 'M15 5 8 12l7 7',
} as const;

function Icon({ path }: { path: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d={path} />
    </svg>
  );
}

function Item({ to, icon, label, collapsed, end }: { to: string; icon: string; label: string; collapsed: boolean; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-xl py-2 text-[13.5px] transition-colors duration-200 ${
          collapsed ? 'justify-center px-2' : 'px-3'
        } ${isActive ? 'text-mist-100' : 'text-mist-400 hover:bg-white/6 hover:text-mist-100'}`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="sidebar-active"
              className="absolute inset-0 rounded-xl bg-white/10 ring-1 ring-white/10"
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            />
          )}
          <span className={`relative z-10 ${isActive ? 'text-accent' : ''}`}>
            <Icon path={icon} />
          </span>
          {!collapsed && <span className="relative z-10 truncate">{label}</span>}
        </>
      )}
    </NavLink>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { data: libraries } = useQuery({ queryKey: ['libraries'], queryFn: api.libraries });
  const movieLibs = libraries?.filter((l) => l.kind === 'movie') ?? [];
  const showLibs = libraries?.filter((l) => l.kind === 'show') ?? [];

  return (
    <aside
      className="glass-strong layer-promote fixed inset-y-0 left-0 z-50 hidden flex-col border-r border-white/6 transition-[width] duration-300 ease-[var(--ease-out)] md:flex"
      style={{ width: collapsed ? 68 : 232 }}
    >
      <div className={`flex h-14 shrink-0 items-center ${collapsed ? 'justify-center' : 'px-4'}`}>
        <NavLink to="/" className="flex items-center gap-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="shrink-0 text-accent">
            <rect x="2" y="4" width="20" height="16" rx="3.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="M9 8.5v7l6-3.5-6-3.5Z" fill="currentColor" />
          </svg>
          {!collapsed && <span className="text-[15px] font-semibold tracking-tight">Media Watch</span>}
        </NavLink>
      </div>

      <nav className="no-scrollbar flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-3">
        <Item to="/" icon={ICONS.home} label="Inicio" collapsed={collapsed} end />
        <Item to="/sagas" icon={ICONS.saga} label="Sagas" collapsed={collapsed} />
        <Item to="/favoritos" icon={ICONS.heart} label="Favoritos" collapsed={collapsed} />

        {movieLibs.length > 0 && (
          <>
            {!collapsed && <div className="px-3 pt-5 pb-1.5 text-[10.5px] font-semibold tracking-wider text-mist-600 uppercase">Películas</div>}
            {collapsed && <div className="my-3 h-px bg-white/8" />}
            {movieLibs.map((lib) => (
              <Item key={lib.id} to={`/biblioteca/${lib.id}`} icon={ICONS.movie} label={lib.name} collapsed={collapsed} />
            ))}
          </>
        )}

        {showLibs.length > 0 && (
          <>
            {!collapsed && <div className="px-3 pt-5 pb-1.5 text-[10.5px] font-semibold tracking-wider text-mist-600 uppercase">Series</div>}
            {collapsed && <div className="my-3 h-px bg-white/8" />}
            {showLibs.map((lib) => (
              <Item key={lib.id} to={`/biblioteca/${lib.id}`} icon={ICONS.show} label={lib.name} collapsed={collapsed} />
            ))}
          </>
        )}
      </nav>

      <div className="shrink-0 space-y-0.5 border-t border-white/6 px-2.5 py-2.5">
        <Item to="/descargas" icon={ICONS.download} label="Descargas" collapsed={collapsed} />
        <Item to="/estadisticas" icon={ICONS.stats} label="Estadísticas" collapsed={collapsed} />
        <Item to="/ajustes" icon={ICONS.settings} label="Ajustes" collapsed={collapsed} />
        <button
          onClick={onToggle}
          title={collapsed ? 'Desplegar menú' : 'Plegar menú'}
          className={`flex w-full items-center gap-3 rounded-xl py-2 text-[13.5px] text-mist-500 transition-colors hover:bg-white/6 hover:text-mist-100 ${
            collapsed ? 'justify-center px-2' : 'px-3'
          }`}
        >
          <span className={`transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`}>
            <Icon path={ICONS.collapse} />
          </span>
          {!collapsed && <span>Plegar</span>}
        </button>
      </div>
    </aside>
  );
}

function SearchField() {
  const [value, setValue] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!location.pathname.startsWith('/buscar')) setValue('');
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative">
      <svg className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-mist-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (e.target.value.trim().length >= 2) {
            navigate(`/buscar?q=${encodeURIComponent(e.target.value)}`, { replace: location.pathname.startsWith('/buscar') });
          }
        }}
        placeholder="Buscar títulos o frases de diálogo"
        className="w-52 rounded-full border border-white/8 bg-white/6 py-1.5 pr-3 pl-9 text-sm text-mist-100 outline-none transition-[width,background] duration-300 ease-[var(--ease-out)] placeholder:text-mist-600 focus:w-80 focus:bg-white/10"
      />
    </div>
  );
}

function ProfileMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="grid h-8 w-8 place-items-center rounded-full text-sm font-semibold text-ink-950 transition-transform duration-200 hover:scale-110"
        style={{ background: user.color ?? '#f0a54a' }}
      >
        {user.name.charAt(0).toUpperCase()}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="glass absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-2xl p-1.5"
          >
            <div className="px-3 py-2 text-xs text-mist-500">{user.name}</div>
            <button onClick={() => { setOpen(false); navigate('/ajustes'); }} className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-white/8">
              Ajustes
            </button>
            <button
              onClick={async () => {
                await api.logout();
                queryClient.clear();
                navigate('/');
              }}
              className="w-full rounded-xl px-3 py-2 text-left text-sm text-mist-300 hover:bg-white/8"
            >
              Cambiar de perfil
            </button>
          </motion.div>
        </>
      )}
    </div>
  );
}

export function TopBar({ user, left, onOpenMenu }: { user: User; left: number; onOpenMenu: () => void }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`layer-promote fixed top-0 right-0 z-40 transition-colors duration-300 ${
        scrolled ? 'glass-strong border-b border-white/6' : 'bg-linear-to-b from-ink-950/85 to-transparent'
      }`}
      style={{ left }}
    >
      <div className="flex h-14 items-center gap-3 px-4 sm:px-8">
        <button onClick={onOpenMenu} className="grid h-9 w-9 place-items-center rounded-xl text-mist-300 hover:bg-white/8 md:hidden">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <div className="flex-1" />
        <SearchField />
        <ProfileMenu user={user} />
      </div>
    </header>
  );
}

export function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: libraries } = useQuery({ queryKey: ['libraries'], queryFn: api.libraries });
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-60 md:hidden" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <motion.div
        initial={{ x: -260 }}
        animate={{ x: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="glass-strong absolute inset-y-0 left-0 w-64 overflow-y-auto p-3"
      >
        <div className="mb-3 px-2 py-2 text-[15px] font-semibold">Media Watch</div>
        <div className="space-y-0.5" onClick={onClose}>
          <Item to="/" icon={ICONS.home} label="Inicio" collapsed={false} end />
          <Item to="/sagas" icon={ICONS.saga} label="Sagas" collapsed={false} />
          <Item to="/favoritos" icon={ICONS.heart} label="Favoritos" collapsed={false} />
          <div className="px-3 pt-4 pb-1.5 text-[10.5px] font-semibold tracking-wider text-mist-600 uppercase">Bibliotecas</div>
          {libraries?.map((lib) => (
            <Item key={lib.id} to={`/biblioteca/${lib.id}`} icon={lib.kind === 'movie' ? ICONS.movie : ICONS.show} label={lib.name} collapsed={false} />
          ))}
          <div className="pt-4">
            <Item to="/descargas" icon={ICONS.download} label="Descargas" collapsed={false} />
            <Item to="/estadisticas" icon={ICONS.stats} label="Estadísticas" collapsed={false} />
            <Item to="/ajustes" icon={ICONS.settings} label="Ajustes" collapsed={false} />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export function useSidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'collapsed';
    } catch {
      return false;
    }
  });

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'open');
      } catch {
        /* private mode: the choice just will not persist */
      }
      return next;
    });
  };

  return { collapsed, toggle, width: collapsed ? 68 : 232 };
}
