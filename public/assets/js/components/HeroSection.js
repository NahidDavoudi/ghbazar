import { storeConfig } from '../config/bootstrap.js';
import { pickBannerImage, pickVariantSet } from '../utils/imageUrl.js';
import Button from './Button.js';

function resolveSlideImages(data = null) {
  const { hero } = storeConfig;
  const fromApi = data?.slides || [];

  if (fromApi.length) {
    return fromApi.map((slide) => pickBannerImage(slide, 'large') || slide.image_url || slide.image || '').filter(Boolean);
  }

  const fromConfig = hero.fallbackImages || [];
  if (fromConfig.length) {
    return fromConfig.filter(Boolean);
  }

  const heroImage = pickVariantSet(hero.imageVariants, 'large') || hero.image;
  return heroImage ? [heroImage] : [];
}

const HeroSection = {
  render(data = null) {
    const { hero } = storeConfig;
    const images = resolveSlideImages(data).filter(Boolean);

    if (!images.length) return '';

    const logo = storeConfig.logo || 'assets/images/logo.png';
    const title = hero.title || 'Ghul Bazar';
    const subtitle = hero.subtitle || 'مرجع اصلی خرید و فروش اکسسوری‌های سورئال و قدمت‌دار';
    const cta1 = hero.ctaPrimary || 'کاوش مجموعه';
    const cta2 = hero.ctaSecondary || 'دسته‌بندی‌ها';

    // centered overlay reused — matches landing.html exactly
    const centeredOverlay = `
      <div class="relative z-10 text-center px-5 max-w-3xl mx-auto py-20">
        <img src="${logo}" alt="${storeConfig.name || 'غول بازار'}" class="w-28 h-28 md:w-40 md:h-40 object-contain mx-auto mb-4 drop-shadow-[0_0_24px_rgba(207,23,54,0.6)]" />
        <h1 class="font-display text-5xl md:text-7xl text-white mb-3 leading-tight" dir="ltr">${title}</h1>
        <p class="text-muted text-base md:text-xl mb-8">${subtitle}</p>
        <div class="flex gap-3 justify-center flex-wrap">
          <a href="#/shop" data-link class="px-6 py-3 md:px-8 md:py-4 rounded-lg bg-accent text-white text-sm md:text-base font-bold shadow-[0_10px_15px_-3px_rgba(207,23,54,0.3)] hover:bg-accent-hover transition-all">${cta1}</a>
          <a href="#/categories" data-link class="px-6 py-3 md:px-8 md:py-4 rounded-lg backdrop-blur-sm bg-background-subtle/50 border border-white/20 text-white text-sm md:text-base font-medium hover:bg-background-muted transition-all">${cta2}</a>
        </div>
      </div>`;

    // multi-slide: swiper with centered overlay per slide (keeps landing look + slider)
    if (images.length > 1) {
      const slidesHtml = images.map((src) => `
        <div class="swiper-slide">
          <div class="relative min-h-[500px] md:min-h-[700px] flex items-center justify-center overflow-hidden">
            <div class="absolute inset-0">
              <img src="${src}" alt="${storeConfig.name}" class="w-full h-full object-cover scale-105" />
              <div class="absolute inset-0 bg-gradient-to-t from-body via-body/60 to-transparent"></div>
              <div class="absolute inset-0 bg-black/40"></div>
            </div>
            ${centeredOverlay}
          </div>
        </div>`).join('');
      return `
        <section class="hero-slider relative w-full overflow-hidden bg-body">
          <div class="swiper hero-swiper relative">
            <div class="swiper-wrapper">${slidesHtml}</div>
            <div class="swiper-button-prev hero-swiper-prev !text-white"></div>
            <div class="swiper-button-next hero-swiper-next !text-white"></div>
            <div class="swiper-pagination hero-swiper-pagination"></div>
          </div>
        </section>`;
    }

    // single image: exact landing markup (no swiper chrome)
    return `
      <section class="relative min-h-[500px] md:min-h-[700px] flex items-center justify-center overflow-hidden">
        <div class="absolute inset-0">
          <img src="${images[0]}" alt="${storeConfig.name || 'غول بازار'}" class="w-full h-full object-cover scale-105" />
          <div class="absolute inset-0 bg-gradient-to-t from-body via-body/60 to-transparent"></div>
          <div class="absolute inset-0 bg-black/40"></div>
        </div>
        ${centeredOverlay}
      </section>`;
  },

  bind(container) {
    const root = container?.querySelector('.hero-swiper');
    if (!root || typeof Swiper === 'undefined') return null;

    const slideCount = root.querySelectorAll('.swiper-slide').length;
    if (slideCount <= 1) return null;

    const { hero } = storeConfig;
    const swiper = new Swiper(root, {
      slidesPerView: 1,
      spaceBetween: 0,
      loop: true,
      speed: hero.speed ?? 800,
      autoplay: {
        delay: hero.autoplayMs ?? 8000,
        disableOnInteraction: false,
      },
      navigation: {
        prevEl: container.querySelector('.hero-swiper-prev'),
        nextEl: container.querySelector('.hero-swiper-next'),
      },
      pagination: {
        el: container.querySelector('.hero-swiper-pagination'),
        clickable: true,
      },
    });

    container._heroSwiper = swiper;
    return swiper;
  },

  destroy(container) {
    container?._heroSwiper?.destroy?.(true, true);
    container._heroSwiper = null;
  },
};

export default HeroSection;
