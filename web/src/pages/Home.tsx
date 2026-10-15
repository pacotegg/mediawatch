import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import Hero from '../components/Hero.tsx';
import Novedades from '../components/Novedades.tsx';
import Row from '../components/Row.tsx';
import { api } from '../lib/api.ts';
import { t } from '../lib/i18n.ts';
import { usePreferences } from '../lib/preferences.tsx';

function RowSkeleton() {
  return (
    <div className="px-4 sm:px-8">
      <div className="skeleton mb-3 h-5 w-40 rounded" />
      <div className="flex gap-3.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton aspect-2/3 w-[168px] shrink-0 rounded-[var(--radius-card)]" />
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const { data, isLoading } = useQuery({ queryKey: ['home'], queryFn: api.home, staleTime: 30_000 });
  const { data: libraries } = useQuery({ queryKey: ['libraries'], queryFn: api.libraries });
  const { prefs } = usePreferences();
  const lang = prefs.interface.language;

  if (isLoading) {
    return (
      <div className="space-y-10 pt-24">
        <RowSkeleton />
        <RowSkeleton />
      </div>
    );
  }

  const libraryFor = (key: string) => {
    const id = key.startsWith('lib-') ? Number(key.slice(4)) : null;
    return id ? libraries?.find((l) => l.id === id) : undefined;
  };

  const localizeTitle = (row: { kind: string; title: string }) => {
    if (row.kind === 'progress') return t('continueWatching', lang);
    const low = row.title.toLowerCase();
    if (low.includes('estrenadas') || low.includes('recient')) return t('recentlyAdded', lang);
    return row.title;
  };

  return (
    <div className="pb-24">
      {data?.hero && data.hero.length > 0 && <Hero items={data.hero} />}

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 -mt-6 space-y-9"
      >
        {/* Sin portada destacada, el contenedor que sube para solaparse con ella la dejaba cortada arriba. */}
        <Novedades sinPortada={!data?.hero?.length} />
        {data?.rows.map((row) => (
          <Row
            key={row.key}
            title={localizeTitle(row)}
            items={row.items}
            variant={row.kind === 'progress' ? 'continue' : 'poster'}
            to={libraryFor(row.key) ? `/biblioteca/${libraryFor(row.key)!.id}` : undefined}
          />
        ))}
      </motion.div>
    </div>
  );
}
