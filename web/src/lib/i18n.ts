export type Language = 'en' | 'es';

export const TRANSLATIONS = {
  en: {
    // Navigation
    home: 'Home',
    sagas: 'Collections',
    favorites: 'Favorites',
    movies: 'Movies',
    shows: 'Series',
    platforms: 'Platforms',
    downloads: 'Downloads',
    stats: 'Statistics',
    settings: 'Settings',
    collapse: 'Collapse',
    expand: 'Expand',
    search: 'Search',
    searchPlaceholder: 'Search titles, actors...',
    switchProfile: 'Switch profile',
    signOut: 'Sign out',
    libraries: 'Libraries',

    // Home
    continueWatching: 'Continue watching',
    recentlyAdded: 'Recently added',
    play: 'Play',
    viewDetails: 'View details',

    // Detail
    trailer: 'Trailer',
    extras: 'Extras',
    cast: 'Cast',
    studio: 'Studio',
    audio: 'Audio',
    subtitles: 'Subtitles',
    directedBy: 'Directed by',
    resume: 'Resume',
    markWatched: 'Mark as watched',
    markUnwatched: 'Mark as unwatched',
    externalWatch: 'Available on',

    // Settings
    uiLanguage: 'Interface Language',
    uiLanguageHint: 'Language used for menus, buttons, and navigation.',
    playback: 'Playback',
    subtitlesSettings: 'Subtitles',
    librarySettings: 'Library',
    analysis: 'Analysis',
    metadata: 'Metadata',
    users: 'Users',
    server: 'Server',
    activity: 'Activity',

    // Common
    loading: 'Loading…',
    reload: 'Reload',
    errorLoad: 'Could not load this section',
    all: 'All',
  },
  es: {
    // Navigation
    home: 'Inicio',
    sagas: 'Sagas',
    favorites: 'Favoritos',
    movies: 'Películas',
    shows: 'Series',
    platforms: 'Plataformas',
    downloads: 'Descargas',
    stats: 'Estadísticas',
    settings: 'Ajustes',
    collapse: 'Plegar',
    expand: 'Desplegar',
    search: 'Buscar',
    searchPlaceholder: 'Buscar títulos o frases clave…',
    switchProfile: 'Cambiar de perfil',
    signOut: 'Cerrar sesión',
    libraries: 'Bibliotecas',

    // Home
    continueWatching: 'Continuar viendo',
    recentlyAdded: 'Estrenadas recientemente',
    play: 'Reproducir',
    viewDetails: 'Ver ficha',

    // Detail
    trailer: 'Tráiler',
    extras: 'Extras',
    cast: 'Reparto',
    studio: 'Estudio',
    audio: 'Audio',
    subtitles: 'Subtítulos',
    directedBy: 'Dirigida por',
    resume: 'Reanudar',
    markWatched: 'Marcar como visto',
    markUnwatched: 'Desmarcar visto',
    externalWatch: 'También en',

    // Settings
    uiLanguage: 'Idioma de la interfaz',
    uiLanguageHint: 'Idioma de los menús, botones y navegación.',
    playback: 'Reproducción',
    subtitlesSettings: 'Subtítulos',
    librarySettings: 'Biblioteca',
    analysis: 'Análisis',
    metadata: 'Metadatos',
    users: 'Usuarios',
    server: 'Servidor',
    activity: 'Actividad',

    // Common
    loading: 'Cargando…',
    reload: 'Recargar',
    errorLoad: 'No se pudo cargar esta sección',
    all: 'Todos',
  },
} as const;

export type TranslationKey = keyof typeof TRANSLATIONS.en;

export function t(key: TranslationKey, lang: Language = 'en'): string {
  return TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.en[key] ?? key;
}
