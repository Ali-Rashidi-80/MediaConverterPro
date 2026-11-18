import { useConverterStore } from '../store/useConverterStore';
import { TRANSLATIONS } from './translations';

export const useI18n = () => {
  const language = useConverterStore((state) => state.language);
  const t = language === 'fa' ? TRANSLATIONS.fa : TRANSLATIONS.en;
  return { t, language };
};

