import { useEffect } from 'react';
import { useConverterStore } from '../store/useConverterStore';

const findVisibleSearchInput = (hasOpenDialog: boolean): HTMLInputElement | null => {
  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[data-search-input="true"]')
  ).filter((el) => el.offsetParent !== null && !el.disabled);

  if (candidates.length === 0) return null;

  if (hasOpenDialog) {
    return candidates.find((el) => Boolean(el.closest('dialog[open]'))) ?? null;
  }

  return candidates.find((el) => !el.closest('dialog')) ?? candidates[0] ?? null;
};

export const useKeyboardShortcuts = (): void => {
  const toggleProMode = useConverterStore((state) => state.toggleProMode);
  const toggleLanguage = useConverterStore((state) => state.toggleLanguage);
  const setActiveTab = useConverterStore((state) => state.setActiveTab);
  const queueActions = useConverterStore((state) => state.queueActions);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const hasOpenDialog = Boolean(document.querySelector('dialog[open]'));
      const activeModal = useConverterStore.getState().activeModal;
      const isModalOpen = activeModal !== 'none' || hasOpenDialog;

      // 1. Search shortcut (Ctrl+F) - focuses the currently rendered [data-search-input="true"]
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        (e.code === 'KeyF' || e.key.toLowerCase() === 'f' || e.key === 'ب')
      ) {
        const searchInput = findVisibleSearchInput(hasOpenDialog);
        if (searchInput) {
          e.preventDefault();
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // 2. Escape inside text/form controls: only clear queue searchQuery when target is marked as search input
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        if (e.key === 'Escape') {
          target.blur();
          if (target.dataset.searchInput === 'true') {
            useConverterStore.getState().setSearchQuery('');
          }
        }
        return;
      }

      // Block background workspace shortcuts while any modal or native <dialog> is open
      if (isModalOpen) {
        return;
      }

      // 3. Pro Mode toggle shortcut (Ctrl+Shift+P)
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.code === 'KeyP' || e.key.toLowerCase() === 'p' || e.key === 'ح')
      ) {
        e.preventDefault();
        toggleProMode();
        return;
      }

      // 4. Settings Navigation shortcut (Ctrl+,)
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        (e.code === 'Comma' || e.key === ',' || e.key === '،')
      ) {
        e.preventDefault();
        setActiveTab('settings');
        return;
      }

      // 5. Add Files / Add Folder (Ctrl+O / Ctrl+Shift+O)
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.code === 'KeyO' || e.key.toLowerCase() === 'o' || e.key === 'خ')
      ) {
        e.preventDefault();
        if (e.shiftKey) {
          queueActions?.addFolder();
        } else {
          queueActions?.addFiles();
        }
        return;
      }

      // 6. Start Queue (Ctrl+Enter)
      if ((e.ctrlKey || e.metaKey) && (e.code === 'Enter' || e.key === 'Enter')) {
        e.preventDefault();
        queueActions?.startQueue();
        return;
      }

      // 7. Toggle Language (Ctrl+L)
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        (e.code === 'KeyL' || e.key.toLowerCase() === 'l' || e.key === 'م')
      ) {
        e.preventDefault();
        toggleLanguage();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleProMode, toggleLanguage, setActiveTab, queueActions]);
};
