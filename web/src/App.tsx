import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { MobileDrawer, Sidebar, TopBar, useSidebar } from './components/Sidebar.tsx';
import Home from './pages/Home.tsx';
import Library from './pages/Library.tsx';
import Login from './pages/Login.tsx';
import { api } from './lib/api.ts';

/*
 * Home and Library are what you land on, so they ship in the first chunk.
 * Everything else arrives when it is first opened — the settings screens in
 * particular drag in the metadata and analysis panels nobody needs to browse.
 */
const Detail = lazy(() => import('./pages/Detail.tsx'));
const Player = lazy(() => import('./pages/Player.tsx'));
const Search = lazy(() => import('./pages/Search.tsx'));
const Person = lazy(() => import('./pages/Person.tsx'));
const Favorites = lazy(() => import('./pages/Favorites.tsx'));
const Settings = lazy(() => import('./pages/Settings.tsx'));
const Estadisticas = lazy(() => import('./pages/Estadisticas.tsx'));
const Descargas = lazy(() => import('./pages/Descargas.tsx'));
const Pair = lazy(() => import('./pages/Pair.tsx'));
const CollectionsIndex = lazy(() => import('./pages/Collections.tsx').then((m) => ({ default: m.CollectionsIndex })));
const CollectionDetail = lazy(() => import('./pages/Collections.tsx').then((m) => ({ default: m.CollectionDetail })));

function Page({ children }: { children: React.ReactNode }) {
  // Skipping the fade entirely for reduced-motion users also guarantees the page
  // is never left invisible if the animation frame loop is throttled.
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduce ? undefined : { opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export default function App() {
  const location = useLocation();
  const { collapsed, toggle, width } = useSidebar();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { data: user, isLoading, isError } = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });

  if (isLoading) {
    return <div className="grid min-h-screen place-items-center bg-ink-950 text-mist-600">Media Watch</div>;
  }

  if (isError || !user) return <Login />;

  const isPlayer = location.pathname.startsWith('/ver/');

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-ink-950">
        {!isPlayer && <div className="grain" aria-hidden />}
        {!isPlayer && (
          <>
            <Sidebar collapsed={collapsed} onToggle={toggle} />
            <TopBar user={user} left={width} onOpenMenu={() => setDrawerOpen(true)} />
            <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
          </>
        )}
        <div
          className="transition-[margin] duration-300 ease-[var(--ease-out)]"
          style={{ ['--sidebar' as string]: `${width}px` }}
        >
          <div className={isPlayer ? '' : 'md:ml-(--sidebar)'}>
            <Suspense fallback={<div className="grid min-h-screen place-items-center text-mist-600">Cargando…</div>}>
              <AnimatePresence mode="wait">
                <Routes location={location} key={location.pathname.split('/').slice(0, 3).join('/')}>
                  <Route path="/" element={<Page><Home /></Page>} />
                  <Route path="/biblioteca/:id" element={<Page><Library /></Page>} />
                  <Route path="/titulo/:id" element={<Page><Detail /></Page>} />
                  <Route path="/persona/:id" element={<Page><Person /></Page>} />
                  <Route path="/buscar" element={<Page><Search /></Page>} />
                  <Route path="/sagas" element={<Page><CollectionsIndex /></Page>} />
                  <Route path="/saga/:name" element={<Page><CollectionDetail /></Page>} />
                  <Route path="/favoritos" element={<Page><Favorites /></Page>} />
                  <Route path="/ajustes" element={<Page><Settings /></Page>} />
                  <Route path="/estadisticas" element={<Page><Estadisticas /></Page>} />
                  <Route path="/descargas" element={<Page><Descargas /></Page>} />
                  <Route path="/emparejar" element={<Page><Pair /></Page>} />
                  <Route path="/ver/:fileId" element={<Player />} />
                  <Route path="*" element={<Page><Home /></Page>} />
                </Routes>
              </AnimatePresence>
            </Suspense>
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
