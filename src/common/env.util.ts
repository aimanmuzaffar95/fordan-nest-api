export const envBool = (v: string | undefined, fallback = false): boolean => {
  if (v === undefined) return fallback;
  const s = v.trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(s);
};
