// The upload API accepts JPEG, PNG and WebP up to 8 MiB. Phone cameras also produce HEIC and
// larger files, so those are re-encoded on the device before they are sent.
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const LIMIT = 7.5 * 1024 * 1024;
const attempts: [longEdge: number, quality: number][] = [[3072, 0.88], [2048, 0.82], [1440, 0.76]];

export async function prepareImage(file: File): Promise<File> {
  if (ACCEPTED.includes(file.type) && file.size <= LIMIT) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`${file.name || 'This file'} is not a photo this browser can read.`);
  }
  try {
    for (const [longEdge, quality] of attempts) {
      const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= LIMIT) {
        const name = (file.name || 'photo').replace(/\.[^.]*$/, '') + '.jpg';
        return new File([blob], name, { type: 'image/jpeg' });
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error(`${file.name || 'This photo'} is too large to send.`);
}
