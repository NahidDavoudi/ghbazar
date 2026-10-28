import { storeConfig } from '../config/bootstrap.js';
import { renderImageWithFallback } from '../utils/imagePlaceholder.js';
import { pickProductImage } from '../utils/imageUrl.js';
import { formatPrice } from '../utils/priceFormatter.js';
import DOM from '../utils/dom.js';

const FeaturedPosterCard = {
  render(p, options = {}) {
    const { ui, carousel } = storeConfig;
    const isCurve = options.variant === 'curve';
    const isMarquee = options.variant === 'marquee';
    const img = pickProductImage(p, 'medium');
    const href = DOM.hashHref('product', { id: p.id });
    const price = p.price ? formatPrice(p.price) : '';
    const category = p.era || p.category_name || '';
    const radius = isMarquee ? carousel.featured.curve?.cardRadius : null;
    const radiusStyle = radius != null ? `border-radius:${radius}px` : '';
    const radiusClass = isMarquee || isCurve ? '' : ui.cardRadius;
    const curveClass = isCurve ? 'featured-poster-curve' : '';
    const curveStyle = isCurve
      ? 'width:var(--curve-card-w);height:var(--curve-card-h);border-radius:var(--curve-card-radius,20px)'
      : '';

    return `
      <a href="${href}" data-link draggable="false"
         class="featured-poster group block h-full overflow-hidden select-none ${isMarquee ? 'featured-poster--marquee' : ''} ${curveClass} ${radiusClass}"
         style="${curveStyle || radiusStyle || ''}">
        <div class="featured-poster__media relative h-full bg-surface overflow-hidden ${isCurve ? 'rounded-[var(--curve-card-radius,20px)]' : ''}">
          ${renderImageWithFallback({
            src: img,
            alt: p.name,
            imgClass: 'w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05] pointer-events-none select-none',
            iconSize: 'w-12 h-12',
          })}
          <div class="featured-poster__shine" aria-hidden="true"></div>
          <div class="absolute inset-x-0 bottom-0 p-4 sm:p-5 bg-gradient-to-t from-black/90 via-black/55 to-transparent pointer-events-none">
            ${category ? `<span class="block text-[11px] text-accent/90 font-medium text-right mb-1 truncate">${category}</span>` : ''}
            <h3 class="text-white font-bold text-sm sm:text-base text-right leading-snug drop-shadow-sm line-clamp-2">${p.name}</h3>
            ${price ? `<p class="text-white/90 font-bold text-xs sm:text-sm text-right mt-2">${price}</p>` : ''}
          </div>
        </div>
      </a>`;
  },

  bind() { /* router handles links */ },
};

export default FeaturedPosterCard;