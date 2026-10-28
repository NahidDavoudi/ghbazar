import { storeConfig } from '../config/bootstrap.js';
import FeaturedPosterCard from './FeaturedPosterCard.js';
import CurveCarousel from './CurveCarousel.js';
import SectionHeader from './SectionHeader.js';

let _uid = 0;

function nextId() {
  _uid += 1;
  return `fc-${_uid}`;
}

const FeaturedCarousel = {
  render(data = {}) {
    const cfg = storeConfig.carousel.featured;
    const { home } = storeConfig.texts;
    const products = data.products || [];
    const id = data.id || nextId();
    const title = data.title || home.featured;
    const viewAllHref = data.viewAllHref || cfg.viewAllHref;
    const viewAllLabel = data.viewAllLabel || home.viewAll;

    return `
      <section class="py-14 md:py-20 featured-carousel-section overflow-x-clip" data-carousel-id="${id}"
               style="background-color:${cfg.backgroundColor}">
        <div class="max-w-[1280px] mx-auto relative">
          ${SectionHeader.render({
            title,
            href: viewAllHref,
            label: viewAllLabel,
            titleClass: 'text-2xl md:text-4xl font-bold text-body text-right',
            linkClass: 'text-muted text-xs md:text-sm hover:text-accent flex flex-row-reverse items-center gap-1 transition-colors shrink-0'
          })}
          <div class="px-2 md:px-6" data-featured-curve-wrap="${id}">
            ${CurveCarousel.render({ id, background: cfg.backgroundColor })}
          </div>
        </div>
      </section>`;
  },

  bind(container, callbacks = {}) {
    const cfg = storeConfig.carousel.featured;
    const curveRoot = container.querySelector('.curve-carousel');
    if (!curveRoot) return null;

    const products = callbacks.products || [];
    const itemsHtml = products.map((p) => FeaturedPosterCard.render(p, { variant: 'curve' }));

    return CurveCarousel.bind(curveRoot, {
      itemsHtml,
      config: cfg.curve,
      background: cfg.backgroundColor,
    });
  },

  destroy(container) {
    const curveRoot = container?.querySelector('.curve-carousel');
    CurveCarousel.destroy(curveRoot);
  },
};

export default FeaturedCarousel;