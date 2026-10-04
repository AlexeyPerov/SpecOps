function rgb(hex: string): number[] | null {
  if (!/^#[\da-f]{6}$/i.test(hex)) return null;
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}
function luminance(channels: number[]): number {
  const c = channels.map(value => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
export function contrastRatio(foreground: string, background: string): number {
  const fg = rgb(foreground), bg = rgb(background);
  if (!fg || !bg) return 0;
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
/** Retains the palette hue where possible, moving toward black/white only as needed. */
export function readableColor(foreground: string, backgrounds: string[], minimum = 4.5): string {
  const fg = rgb(foreground);
  if (!fg || backgrounds.some(bg => !rgb(bg))) return foreground;
  if (backgrounds.every(bg => contrastRatio(foreground, bg) >= minimum)) return foreground;
  const target = backgrounds.reduce((sum, bg) => sum + luminance(rgb(bg)!), 0) / backgrounds.length > 0.4 ? 0 : 255;
  for (let step = 1; step <= 100; step++) {
    const hex = '#' + fg.map(channel => Math.round(channel + (target - channel) * step / 100).toString(16).padStart(2, '0')).join('');
    if (backgrounds.every(bg => contrastRatio(hex, bg) >= minimum)) return hex;
  }
  return target === 0 ? '#000000' : '#ffffff';
}
