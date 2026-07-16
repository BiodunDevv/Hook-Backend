const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#FFFFFF',
  gold: '#FFD700',
  red: '#EF4444',
  blue: '#3B82F6',
  green: '#22C55E',
  yellow: '#FACC15',
  orange: '#F97316',
  purple: '#A855F7',
  pink: '#EC4899',
  grey: '#6B7280',
  gray: '#6B7280',
  brown: '#92400E',
  beige: '#E7D7C1',
  'blue wash': '#6F8FAF',
};

export function normalizeProductColor(value: string) {
  const input = String(value || '').trim();
  const named = NAMED_COLORS[input.toLowerCase()];
  if (named) return named;
  if (/^#[0-9a-f]{3}$/i.test(input)) {
    const [r, g, b] = input.slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(input)) return input.toUpperCase();
  return null;
}

export function normalizeProductColors(values?: string[]) {
  return [...new Set((values || []).map(normalizeProductColor).filter((value): value is string => Boolean(value)))];
}
