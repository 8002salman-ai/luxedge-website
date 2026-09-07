import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowsOut, X } from '@phosphor-icons/react';

interface Props {
  name: string;
  images: string[];
  imageAlts?: string[];
  selected: number;
  onSelect: (index: number) => void;
}

/** Keep original indices so variant selections still map to catalog images. */
export function galleryPhotos(images: string[], failed: string[] = []) {
  return images.map((src, index) => ({ src, index }))
    .filter((photo, index, all) => photo.src && !failed.includes(photo.src) && all.findIndex(p => p.src === photo.src) === index);
}

export default function ProductGallery({ name, images, imageAlts = [], selected, onSelect }: Props) {
  const [failed, setFailed] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const touchStart = useRef<number | null>(null);
  const photos = galleryPhotos(images, failed);
  const current = photos.find(p => p.src === images[selected]) || photos[0];
  const position = Math.max(0, photos.findIndex(p => p.index === current?.index));
  const move = (direction: number) => {
    if (photos.length > 1) onSelect(photos[(position + direction + photos.length) % photos.length].index);
  };
  const markFailed = (src: string) => setFailed(prev => prev.includes(src) ? prev : [...prev, src]);
  const alt = current ? imageAlts[current.index] || `${name} — product photo ${position + 1}` : name;

  return <section className="product-gallery" aria-label={`${name} photos`}>
    <div className="product-gallery__layout">
      {photos.length > 0 && <div className="product-gallery__thumbs" aria-label="Product thumbnails">
        {photos.map((photo, i) => <button type="button" key={photo.src} onClick={() => onSelect(photo.index)}
          aria-label={`View product photo ${i + 1}`} aria-pressed={photo.index === current?.index}>
          <img src={photo.src} alt="" width="64" height="64" loading="lazy" decoding="async" onError={() => markFailed(photo.src)} />
        </button>)}
      </div>}
      <div className="product-gallery__stage"
        onTouchStart={e => { touchStart.current = e.touches[0].clientX; }}
        onTouchEnd={e => { if (touchStart.current !== null) { const distance = e.changedTouches[0].clientX - touchStart.current; if (Math.abs(distance) > 50) move(distance < 0 ? 1 : -1); } touchStart.current = null; }}>
        {current ? <button type="button" className="product-gallery__open" aria-label="Enlarge product photo" onClick={() => dialog.current?.showModal()}>
          <img src={current.src} alt={alt} width="800" height="800" fetchPriority="high" decoding="async" onError={() => markFailed(current.src)} />
          <span className="product-gallery__zoom"><ArrowsOut size={16} aria-hidden="true" /> View larger</span>
        </button> : <div className="product-gallery__empty">Product photo unavailable</div>}
        {photos.length > 1 && <div className="product-gallery__controls">
          <button type="button" aria-label="Previous product photo" onClick={() => move(-1)}><ArrowLeft size={18} /></button>
          <span aria-live="polite">{position + 1} / {photos.length}</span>
          <button type="button" aria-label="Next product photo" onClick={() => move(1)}><ArrowRight size={18} /></button>
        </div>}
      </div>
    </div>
    <p className="product-gallery__caption">{photos.length > 1 ? 'Choose a thumbnail to explore the details. Tap the photo to enlarge.' : photos.length === 1 ? 'Tap the photo for a closer look.' : 'Please contact us if you need product imagery before ordering.'}</p>
    <dialog ref={dialog} className="product-gallery__dialog" aria-label={`${name} enlarged photo`}
      onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); move(e.key === 'ArrowRight' ? 1 : -1); } }}>
      <div className="product-gallery__dialog-header"><p>{name}</p><button type="button" aria-label="Close enlarged photo" onClick={() => dialog.current?.close()}><X size={22} /></button></div>
      {current && <img src={current.src} alt={alt} width="1200" height="1200" onError={() => markFailed(current.src)} />}
      {!current && <p>Product photo unavailable</p>}
      {photos.length > 1 && <div className="product-gallery__dialog-nav"><button type="button" aria-label="Previous enlarged photo" onClick={() => move(-1)}><ArrowLeft size={20} /></button><span>{position + 1} / {photos.length}</span><button type="button" aria-label="Next enlarged photo" onClick={() => move(1)}><ArrowRight size={20} /></button></div>}
    </dialog>
  </section>;
}
