type Rgb = { red: number; green: number; blue: number };

function parseHex(color: string): Rgb | undefined {
  const hex = color.trim().replace(/^#/, '');
  if (!/^[\da-f]{3,8}$/i.test(hex)) return undefined;
  const expanded =
    hex.length === 3 || hex.length === 4
      ? hex
          .slice(0, 3)
          .split('')
          .map((value) => value.repeat(2))
          .join('')
      : hex.slice(0, 6);
  if (expanded.length !== 6) return undefined;
  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function parseRgb(color: string): Rgb | undefined {
  const match =
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i.exec(
      color.trim(),
    );
  if (!match) return undefined;
  const [red, green, blue] = match.slice(1, 4).map(Number);
  if ([red, green, blue].some((value) => value < 0 || value > 255)) {
    return undefined;
  }
  return { red, green, blue };
}

function relativeLuminance({ red, green, blue }: Rgb): number {
  const linear = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function eventTextColor(background: string | undefined): string {
  const rgb = background
    ? (parseHex(background) ?? parseRgb(background))
    : undefined;
  if (!rgb) return '#ffffff';
  const luminance = relativeLuminance(rgb);
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? '#000000' : '#ffffff';
}
