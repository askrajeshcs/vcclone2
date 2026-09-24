export interface LanguageOption {
  code: string;
  label: string;
  flag: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English', flag: 'EN' },
  { code: 'es', label: 'Spanish', flag: 'ES' },
  { code: 'fr', label: 'French', flag: 'FR' },
  { code: 'de', label: 'German', flag: 'DE' },
  { code: 'it', label: 'Italian', flag: 'IT' },
  { code: 'pt', label: 'Portuguese', flag: 'PT' },
  { code: 'cs', label: 'Czech', flag: 'CS' },
  { code: 'pl', label: 'Polish', flag: 'PL' },
  { code: 'ru', label: 'Russian', flag: 'RU' },
  { code: 'nl', label: 'Dutch', flag: 'NL' },
  { code: 'tr', label: 'Turkish', flag: 'TR' },
  { code: 'ar', label: 'Arabic', flag: 'AR' },
  { code: 'zh-cn', label: 'Chinese', flag: 'ZH' },
  { code: 'hi', label: 'Hindi', flag: 'HI' },
];
