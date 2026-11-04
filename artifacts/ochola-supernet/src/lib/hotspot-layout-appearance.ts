export type HotspotLayoutColorMap = Record<string, string>;

export type HotspotLayoutColorAppearances = Record<
  string,
  { colors?: Partial<HotspotLayoutColorMap> } | undefined
>;

export function resolveHotspotLayoutColors<T extends HotspotLayoutColorMap>(
  layoutId: string,
  activeLayoutId: string,
  appearances: Record<string, { colors?: Partial<T> } | undefined>,
  legacyColors: Partial<T>,
  defaults: T,
): T {
  const savedColors = appearances[layoutId]?.colors;
  const sourceColors = savedColors
    ?? (layoutId === activeLayoutId ? legacyColors : undefined);
  return { ...defaults, ...(sourceColors ?? {}) };
}
