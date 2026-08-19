import type { TextureData, TextureId } from '../core/types';

export type TexturePaintTool = 'brush' | 'eraser' | 'eyedropper';

export interface TexturePaintPoint {
  u: number;
  v: number;
}

export interface TexturePaintSettings {
  color: string;
  opacity: number;
  size: number;
  tool: TexturePaintTool;
}

function requireCanvas(): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('Texture Paint is available only in a browser canvas runtime.');
  }
  return document.createElement('canvas');
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function assertSettings(settings: TexturePaintSettings): void {
  if (
    !/^#[0-9a-f]{6}$/i.test(settings.color) ||
    !Number.isFinite(settings.size) ||
    settings.size <= 0 ||
    !Number.isFinite(settings.opacity) ||
    settings.opacity < 0 ||
    settings.opacity > 1
  ) {
    throw new Error('Texture Paint settings are invalid.');
  }
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  if (!dataUrl.startsWith('data:image/')) {
    throw new Error('Texture payload must be a local image data URL.');
  }
  const image = new Image();
  image.decoding = 'async';
  const loaded = new Promise<void>((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener(
      'error',
      () => reject(new Error('The local texture image could not be decoded.')),
      {
        once: true,
      },
    );
  });
  image.src = dataUrl;
  await loaded;
  if (image.naturalWidth < 1 || image.naturalHeight < 1) {
    throw new Error('The local texture image has no pixels.');
  }
  return image;
}

async function canvasFromTexture(texture: TextureData): Promise<HTMLCanvasElement> {
  const image = await loadImage(texture.dataUrl);
  const canvas = requireCanvas();
  canvas.width = texture.width;
  canvas.height = texture.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Texture Paint could not create a 2D canvas.');
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function textureFromCanvas(canvas: HTMLCanvasElement, id: TextureId, name: string): TextureData {
  return {
    colorSpace: 'srgb',
    dataUrl: canvas.toDataURL('image/png'),
    height: canvas.height,
    id,
    mimeType: 'image/png',
    name,
    width: canvas.width,
  };
}

export async function createTexturePayload(
  id: TextureId,
  name: string,
  sourceDataUrl: string,
): Promise<TextureData> {
  const image = await loadImage(sourceDataUrl);
  const maximumDimension = 2048;
  const scale = Math.min(1, maximumDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = requireCanvas();
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Texture import could not create a 2D canvas.');
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return textureFromCanvas(canvas, id, name);
}

export async function createTexturePayloadFromFile(id: TextureId, file: File): Promise<TextureData> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose a local PNG, JPEG, WebP, or other browser-readable image file.');
  }
  const sourceDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('The local texture file could not be read.'));
      }
    });
    reader.addEventListener('error', () => reject(new Error('The local texture file could not be read.')));
    reader.readAsDataURL(file);
  });
  return createTexturePayload(id, file.name || 'Imported texture', sourceDataUrl);
}

export function createBlankTexturePayload(id: TextureId, name = 'Paint layer', size = 256): TextureData {
  const dimension = clamp(Math.round(size), 16, 2048);
  const canvas = requireCanvas();
  canvas.width = dimension;
  canvas.height = dimension;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Texture Paint could not create a blank canvas.');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, dimension, dimension);
  return textureFromCanvas(canvas, id, name);
}

function drawWrappedDot(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  point: TexturePaintPoint,
  settings: TexturePaintSettings,
): void {
  const radius = settings.size / 2;
  const x = clamp(point.u, 0, 1) * canvas.width;
  const y = (1 - clamp(point.v, 0, 1)) * canvas.height;
  context.save();
  context.globalAlpha = settings.opacity;
  context.globalCompositeOperation = settings.tool === 'eraser' ? 'destination-out' : 'source-over';
  context.fillStyle = settings.color;
  for (const offsetX of [-canvas.width, 0, canvas.width]) {
    for (const offsetY of [-canvas.height, 0, canvas.height]) {
      context.beginPath();
      context.arc(x + offsetX, y + offsetY, radius, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
}

function interpolateStroke(points: TexturePaintPoint[], spacing: number): TexturePaintPoint[] {
  if (points.length < 2) {
    return points;
  }
  const output: TexturePaintPoint[] = [points[0]!];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const next = points[index]!;
    const distance = Math.hypot(next.u - previous.u, next.v - previous.v);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    for (let step = 1; step <= steps; step += 1) {
      const factor = step / steps;
      output.push({
        u: previous.u + (next.u - previous.u) * factor,
        v: previous.v + (next.v - previous.v) * factor,
      });
    }
  }
  return output;
}

export async function paintTexturePayload(
  texture: TextureData,
  id: TextureId,
  points: TexturePaintPoint[],
  settings: TexturePaintSettings,
): Promise<TextureData> {
  assertSettings(settings);
  if (settings.tool === 'eyedropper' || points.length === 0) {
    return texture;
  }
  const canvas = await canvasFromTexture(texture);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Texture Paint could not read the texture canvas.');
  }
  const normalizedPoints = points.filter((point) => Number.isFinite(point.u) && Number.isFinite(point.v));
  const spacing = Math.max(settings.size / Math.max(canvas.width, canvas.height) / 2, 1 / 2048);
  interpolateStroke(normalizedPoints, spacing).forEach((point) =>
    drawWrappedDot(context, canvas, point, settings),
  );
  return textureFromCanvas(canvas, id, texture.name);
}

export async function sampleTexturePayload(texture: TextureData, point: TexturePaintPoint): Promise<string> {
  const canvas = await canvasFromTexture(texture);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Texture Paint could not read the texture canvas.');
  }
  const x = Math.min(canvas.width - 1, Math.max(0, Math.floor(clamp(point.u, 0, 1) * canvas.width)));
  const y = Math.min(canvas.height - 1, Math.max(0, Math.floor((1 - clamp(point.v, 0, 1)) * canvas.height)));
  const [red, green, blue] = context.getImageData(x, y, 1, 1).data;
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
