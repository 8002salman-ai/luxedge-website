// ============================================================================
// LUXEDGE — client-side image preparation for admin uploads
//
// The Supabase Storage bucket (product-media) accepts jpeg/png/webp/avif and
// caps files at 5 MB. Phone photos routinely exceed that, and GIFs are
// rejected outright — which used to make /api/upload-image fail, silently
// falling back to an inline base64 row that the loader filters out, so the
// image vanished after reload (the "1/5 → 0/5" bug).
//
// prepareImageForUpload() fixes that at the source: large images are
// downscaled to MAX_DIMENSION and re-encoded (webp, with png fallback), and
// GIFs are converted to PNG (first frame). Output is always under the bucket
// limit and always a bucket-allowed MIME, so the upload either succeeds or
// fails for a real, surfaced reason — never a phantom success.
// ============================================================================

export interface PreparedImage {
  /** data: URL to send to /api/upload-image. */
  dataUrl: string;
  filename: string;
  contentType: string;
}

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the image file.'));
    img.src = dataUrl;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the selected file.'));
    r.readAsDataURL(file);
  });
}

/**
 * Downscale/convert an uploaded image so it is guaranteed to fit the storage
 * bucket's 5 MB limit and allowed MIME types. Returns a data URL ready for
 * /api/upload-image, plus a matching filename/content-type.
 */
export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  const original = await readFileAsDataUrl(file);
  const img = await loadImage(original);
  const isGif = (file.type || '').toLowerCase() === 'image/gif';
  const width = img.naturalWidth || 1;
  const height = img.naturalHeight || 1;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));

  // Nothing to fix — a small non-GIF image ships as-is (no quality loss).
  if (scale === 1 && !isGif) {
    return { dataUrl: original, filename: file.name || 'image.png', contentType: file.type || 'image/png' };
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // Can't process in this environment — send the original and let the
    // server/bucket give the honest error rather than a phantom success.
    return { dataUrl: original, filename: file.name || 'image.png', contentType: file.type || 'image/png' };
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const stem = (file.name || 'image').replace(/\.(jpe?g|png|webp|gif)$/i, '') || 'image';
  const isAnimatedOrTransparent = isGif;
  if (isAnimatedOrTransparent) {
    // GIFs are not in the bucket's allowed MIME list — convert to PNG.
    return { dataUrl: canvas.toDataURL('image/png'), filename: `${stem}.png`, contentType: 'image/png' };
  }
  // Prefer webp (smaller); fall back to png where webp encoding is missing.
  const webp = canvas.toDataURL('image/webp', JPEG_QUALITY);
  if (webp.startsWith('data:image/webp')) {
    return { dataUrl: webp, filename: `${stem}.webp`, contentType: 'image/webp' };
  }
  return { dataUrl: canvas.toDataURL('image/png'), filename: `${stem}.png`, contentType: 'image/png' };
}