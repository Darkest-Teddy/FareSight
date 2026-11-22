// The upload API accepts JPEG, PNG and WebP up to 8 MiB. Phone cameras also produce HEIC and
// larger files, so those are re-encoded on the device before they are sent.
const LIMIT = 7.5 * 1024 * 1024;
const MAX_PIXELS = 64_000_000;
const attempts: [longEdge: number, quality: number][] = [[3072, 0.88], [2048, 0.82], [1440, 0.76]];

async function matchesUploadFormat(file: File) {
  const types = ['image/jpeg', 'image/png', 'image/webp'];
  if (!types.includes(file.type) || file.size < 12) return false;
  const header = new DataView(await file.slice(0, 12).arrayBuffer());
  if (file.type === 'image/jpeg') return header.getUint16(0) === 0xffd8 && header.getUint8(2) === 0xff;
  if (file.type === 'image/png') return header.getUint32(0) === 0x89504e47 && header.getUint32(4) === 0x0d0a1a0a;
  return header.getUint32(0) === 0x52494646 && header.getUint32(8) === 0x57454250; // RIFF / WEBP
}

async function decode(file: File) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    // Safari can open some HEIC files in an image element even when bitmap decoding fails.
    const image = new Image();
    const url = URL.createObjectURL(file);
    try {
      image.src = url;
      await image.decode();
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error(/\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type)
        ? 'This browser cannot open this HEIC photo. Choose a JPEG instead.'
        : 'This browser cannot read this photo.');
    }
  }
}

export async function prepareImage(file: File): Promise<File> {
  const { source, width, height, close } = await decode(file);
  try {
    if (!width || !height) throw new Error('This photo has no readable dimensions.');
    if (width * height > MAX_PIXELS) throw new Error('This photo exceeds the 64 megapixel limit.');
    if (file.size <= LIMIT && await matchesUploadFormat(file)) return file;
    for (const [longEdge, quality] of attempts) {
      const scale = Math.min(1, longEdge / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) break;
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= LIMIT) {
        const name = (file.name || 'photo').replace(/\.[^.]*$/, '') + '.jpg';
        return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
      }
    }
  } finally {
    close();
  }
  throw new Error('This photo could not be resized for upload.');
}
