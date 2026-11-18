import React, { useState } from 'react';
import { clsx } from 'clsx';
import { motion } from 'motion/react';
import {
  Video,
  Music,
  Image as ImageIcon,
  Cpu,
  Settings,
  Info,
  Sliders,
  Moon,
  Sun,
  Languages,
  History,
  Bookmark,
  Scissors,
  Copy,
  Type,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useConverterStore } from '../../store/useConverterStore';
import { useI18n } from '../../i18n/useI18n';
import { Badge } from '../common/Badge';
import { BdiText } from '../common/BdiText';
import { APP_METADATA } from '../../constants/app';

export const Sidebar: React.FC = () => {
  const { t } = useI18n();
  const activeTab = useConverterStore((state) => state.activeTab);
  const setActiveTab = useConverterStore((state) => state.setActiveTab);
  const setActiveModal = useConverterStore((state) => state.setActiveModal);
  const theme = useConverterStore((state) => state.theme);
  const toggleTheme = useConverterStore((state) => state.toggleTheme);
  const toggleLanguage = useConverterStore((state) => state.toggleLanguage);
  const isProMode = useConverterStore((state) => state.isProMode);
  const toggleProMode = useConverterStore((state) => state.toggleProMode);
  const hardwareProfile = useConverterStore((state) => state.hardwareProfile);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const navItems = [
    { id: 'video' as const, label: t.nav.video, icon: Video },
    { id: 'audio' as const, label: t.nav.audio, icon: Music },
    { id: 'image' as const, label: t.nav.image, icon: ImageIcon },
    { id: 'history' as const, label: t.nav.history, icon: History },
    { id: 'presets' as const, label: t.nav.presets, icon: Bookmark },
    { id: 'hardware' as const, label: t.nav.hardware, icon: Cpu },
    { id: 'settings' as const, label: t.nav.settings, icon: Settings },
    { id: 'about' as const, label: t.nav.about, icon: Info },
  ];

  const handleTabChange = (tabId: (typeof navItems)[number]['id']) => {
    if (tabId === activeTab) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const docWithTransition = document as Document & {
      startViewTransition?: (cb: () => void) => unknown;
    };

    if (!prefersReducedMotion && typeof docWithTransition.startViewTransition === 'function') {
      try {
        docWithTransition.startViewTransition(() => {
          setActiveTab(tabId);
        });
        return;
      } catch {
        // Fallback to direct tab switch
      }
    }
    setActiveTab(tabId);
  };

  const languageShortLabel = t.sidebar.toggleLanguage.replace(/\s*\([^)]*\)/, '').trim();

  return (
    <aside
      className={clsx(
        'h-full flex flex-col justify-between border-e border-[var(--border-subtle)] bg-[var(--surface-mica)] backdrop-blur-xl select-none shrink-0 z-20 transition-all duration-300',
        isCollapsed ? 'w-16 p-2 items-center' : 'w-56 lg:w-60 xl:w-64 p-3 lg:p-4'
      )}
    >
      {/* Top Scrollable Area: Brand + Navigation + Special Tools */}
      <div className="w-full flex-1 min-h-0 overflow-y-auto scrollbar-none">
        {/* Brand Header */}
        <div className={clsx('flex items-center gap-3 mb-4', isCollapsed ? 'justify-center py-2' : 'px-2 py-2')}>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20 text-white font-bold text-lg shrink-0">
            G
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0 flex-1">
              <span className="font-bold text-sm tracking-tight text-[var(--text-primary)] truncate">
                {t.appTitle}
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <BdiText dir="ltr" mono className="text-[10px] text-[var(--text-muted)]">
                  v{APP_METADATA.version} {t.sidebar.proBadge}
                </BdiText>
                {hardwareProfile && hardwareProfile.recommended_backend !== 'cpu' && (
                  <Badge variant="primary" className="text-[9px] py-0 px-1">
                    {hardwareProfile.recommended_backend.toUpperCase()}
                  </Badge>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Navigation Items */}
        <nav className="space-y-1 w-full" aria-label={t.appTitle}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleTabChange(item.id)}
                title={item.label}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={clsx(
                  'w-full flex items-center rounded-xl font-medium text-xs transition-all duration-200 focus-studio relative group',
                  isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2',
                  isActive
                    ? 'text-[var(--accent-primary)] font-semibold bg-sky-500/10'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-slate-500/5'
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="sidebarActivePill"
                    className="absolute inset-0 rounded-xl bg-sky-500/10 border border-sky-500/25 shadow-sm"
                    transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  />
                )}
                <Icon
                  className={clsx(
                    'w-4 h-4 shrink-0 transition-transform group-hover:scale-110 z-10',
                    isActive ? 'text-sky-600 dark:text-sky-400' : 'text-[var(--text-muted)]'
                  )}
                />
                {!isCollapsed && <span className="truncate z-10">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Special Tools Section (always visible, adapts to collapsed rail) */}
        <div
          className={clsx(
            'pt-3 mt-3 border-t border-[var(--border-subtle)] space-y-1 w-full',
            isCollapsed && 'flex flex-col items-center'
          )}
        >
          {!isCollapsed && (
            <span className="text-[10px] font-semibold text-[var(--text-muted)] px-2 block uppercase tracking-wider">
              {t.sidebar.specialTools}
            </span>
          )}
          <button
            type="button"
            onClick={() => setActiveModal('social_splitter')}
            title={t.socialSplitter.title}
            aria-label={t.socialSplitter.title}
            className={clsx(
              'w-full flex items-center rounded-lg text-xs text-[var(--text-secondary)] hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-500/10 transition-all focus-studio',
              isCollapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-1.5'
            )}
          >
            <Scissors className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
            {!isCollapsed && <span className="truncate">{t.socialSplitter.title}</span>}
          </button>
          <button
            type="button"
            onClick={() => setActiveModal('duplicate_scanner')}
            title={t.duplicates.title}
            aria-label={t.duplicates.title}
            className={clsx(
              'w-full flex items-center rounded-lg text-xs text-[var(--text-secondary)] hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-500/10 transition-all focus-studio',
              isCollapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-1.5'
            )}
          >
            <Copy className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            {!isCollapsed && <span className="truncate">{t.duplicates.title}</span>}
          </button>
          <button
            type="button"
            onClick={() => setActiveModal('subtitle_fixer')}
            title={t.subtitleFixer.title}
            aria-label={t.subtitleFixer.title}
            className={clsx(
              'w-full flex items-center rounded-lg text-xs text-[var(--text-secondary)] hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-500/10 transition-all focus-studio',
              isCollapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-1.5'
            )}
          >
            <Type className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            {!isCollapsed && <span className="truncate">{t.subtitleFixer.title}</span>}
          </button>
        </div>
      </div>

      {/* Footer Controls */}
      <div className={clsx('pt-3 border-t border-[var(--border-subtle)] space-y-2 w-full shrink-0', isCollapsed && 'items-center')}>
        {/* Rail Collapse Toggle */}
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          title={isCollapsed ? t.sidebar.expandRail : t.sidebar.collapseRail}
          aria-label={isCollapsed ? t.sidebar.expandRail : t.sidebar.collapseRail}
          aria-expanded={!isCollapsed}
          className={clsx(
            'w-full flex items-center rounded-lg text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-slate-500/5 transition-all focus-studio',
            isCollapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-1'
          )}
        >
          {!isCollapsed && <span>{t.sidebar.collapseRail}</span>}
          {isCollapsed ? (
            <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
          ) : (
            <ChevronLeft className="w-3.5 h-3.5 rtl:rotate-180" />
          )}
        </button>

        {/* Pro Mode Toggle (always visible, adapts to collapsed rail) */}
        <button
          type="button"
          onClick={toggleProMode}
          title={t.settings.proMode}
          aria-label={t.settings.proMode}
          aria-pressed={isProMode}
          className={clsx(
            'w-full flex items-center rounded-xl text-xs font-medium border transition-all duration-200 focus-studio relative',
            isCollapsed ? 'justify-center p-2' : 'justify-between px-3 py-1.5',
            isProMode
              ? 'bg-gradient-to-r from-sky-500/15 to-indigo-500/15 border-sky-500/35 text-sky-600 dark:text-sky-400 font-semibold'
              : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-slate-500/5'
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Sliders className="w-3.5 h-3.5 shrink-0" />
            {!isCollapsed && <span className="truncate">{t.settings.proMode}</span>}
          </div>
          {!isCollapsed ? (
            <span
              className={clsx(
                'w-2 h-2 rounded-full shrink-0',
                isProMode ? 'bg-sky-500 dark:bg-sky-400 animate-pulse' : 'bg-slate-400 dark:bg-slate-600'
              )}
            />
          ) : (
            isProMode && (
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500 dark:bg-sky-400 absolute top-1 end-1" />
            )
          )}
        </button>

        {/* Language & Theme switch */}
        <div className={clsx('flex items-center gap-1.5', isCollapsed && 'flex-col')}>
          <button
            type="button"
            onClick={toggleLanguage}
            title={t.sidebar.toggleLanguage}
            aria-label={t.sidebar.toggleLanguage}
            className={clsx(
              'rounded-xl text-xs font-medium border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-slate-500/5 transition-all flex items-center justify-center gap-1.5 focus-studio',
              isCollapsed ? 'w-full p-2' : 'flex-1 min-w-0 px-2.5 py-1.5'
            )}
          >
            <Languages className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
            {!isCollapsed && <span className="truncate text-[11px]">{languageShortLabel}</span>}
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            title={t.sidebar.toggleTheme}
            aria-label={t.sidebar.toggleTheme}
            className={clsx(
              'rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-slate-500/5 transition-all flex items-center justify-center focus-studio',
              isCollapsed ? 'w-full p-2' : 'p-2'
            )}
          >
            {theme === 'dark' ? (
              <Sun className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-sky-600" />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
};
