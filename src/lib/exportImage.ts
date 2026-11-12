// Saves a rendered dashboard panel as an SVG or PNG file, without a library: the element is cloned with
// its computed styles inlined, placed in an SVG <foreignObject>, and for PNG drawn onto a canvas.

const SKIPPED_PROPERTIES = new Set(['transition', 'animation', 'cursor', 'will-change']);

function inlineStyles(source: Element, target: Element) {
  const computed = window.getComputedStyle(source);
  const declarations: string[] = [];
  for (let index = 0; index < computed.length; index += 1) {
    const property = computed[index];
    if (SKIPPED_PROPERTIES.has(property) || property.startsWith('--')) continue;
    declarations.push(`${property}:${computed.getPropertyValue(property)}`);
  }
  (target as HTMLElement).setAttribute('style', declarations.join(';'));
  const sourceChildren = source.children;
  const targetChildren = target.children;
  for (let index = 0; index < sourceChildren.length; index += 1) {
    if (targetChildren[index]) inlineStyles(sourceChildren[index], targetChildren[index]);
  }
}

/** The element as a standalone SVG document, at its on-screen size (ignoring any parent transform). */
export function elementToSvg(element: HTMLElement): { svg: string; width: number; height: number } {
  const width = Math.ceil(element.offsetWidth);
  const height = Math.ceil(element.offsetHeight);
  const clone = element.cloneNode(true) as HTMLElement;
  inlineStyles(element, clone);
  clone.querySelectorAll('[data-export-ignore]').forEach((node) => node.remove());
  clone.style.margin = '0';
  const background = window.getComputedStyle(element).backgroundColor || window.getComputedStyle(document.body).backgroundColor;
  const xhtml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="100%" height="100%" fill="${background}"/>`
    + `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  return { svg, width, height };
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function saveElementAsSvg(element: HTMLElement, fileName: string) {
  const { svg } = elementToSvg(element);
  download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), fileName);
}

/** PNG at `scale` × the on-screen size. Rejects if the browser refuses to draw the SVG (some Safari versions). */
export async function saveElementAsPng(element: HTMLElement, fileName: string, scale = 2) {
  const { svg, width, height } = elementToSvg(element);
  const image = new Image();
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The browser could not render this panel as an image.'));
    image.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available.');
  context.scale(scale, scale);
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The browser could not export this panel as PNG.');
  download(blob, fileName);
}

/** Rows as CSV with every field quoted, so commas, quotes and line breaks survive. */
export function rowsToCsv(columns: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const quote = (value: string | number | null | undefined) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [columns.map(quote).join(','), ...rows.map((row) => row.map(quote).join(','))].join('\n');
}

export function saveCsv(columns: string[], rows: Array<Array<string | number | null | undefined>>, fileName: string) {
  download(new Blob([rowsToCsv(columns, rows)], { type: 'text/csv;charset=utf-8' }), fileName);
}

export function saveText(text: string, fileName: string, type = 'text/plain;charset=utf-8') {
  download(new Blob([text], { type }), fileName);
}

/** A file-name-safe slug: "Concentration of views" -> "concentration-of-views". */
export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'panel';
}
