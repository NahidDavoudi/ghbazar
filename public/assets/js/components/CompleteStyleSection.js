import { storeConfig } from '../config/bootstrap.js';
import RelatedProductCard from './RelatedProductCard.js';
import SectionHeader from './SectionHeader.js';

const CompleteStyleSection = {
  render({ products = [], viewAllHref = '#/shop' } = {}) {
    const t = storeConfig.texts.product;
    if (!products.length) return '';

    const cards = products.map((p) => RelatedProductCard.render(p)).join('');

    return `
      <section class="border-t border-border pt-12 md:pt-16 mt-12 md:mt-16">
        ${SectionHeader.render({
          title: t.completeStyle,
          href: viewAllHref,
          label: t.viewAll,
          titleClass: 'text-xl md:text-2xl font-bold text-body',
          linkClass: 'text-sm text-muted hover:text-body transition-colors flex items-center gap-1',
          iconClass: 'w-6 h-6 text-accent'
        })}
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">${cards}</div>
      </section>`;
  },

  bind(container) {
    /* router handles links */
  },
};

export default CompleteStyleSection;
