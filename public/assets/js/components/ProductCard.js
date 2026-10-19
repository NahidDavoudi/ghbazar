import { formatPrice } from '../utils/priceFormatter.js';
import { renderImageWithFallback } from '../utils/imagePlaceholder.js';
import { pickProductImage } from '../utils/imageUrl.js';
import { isLowStock, formatLowStockMessage } from '../utils/stockHint.js';
import DOM from '../utils/dom.js';

const ProductCard = {
  render(p) {
    const img = pickProductImage(p, 'medium');
    const price = formatPrice(p.price);
    const href = DOM.hashHref('product', { id: p.id });

    const badge = p.badge
      ? `<span class="clay-badge">${p.badge}</span>`
      : '';

    const lowStock = isLowStock(p.stock)
      ? `<span class="clay-low-stock">${formatLowStockMessage(p.stock)}</span>`
      : '';

    const outOfStock = p.stock === 0
      ? `<div class="clay-out-of-stock"><span>ناموجود</span></div>`
      : '';

    const category = p.era || p.category_name || '';

    return `
      <a href="${href}" data-link class="clay-card">
        ${outOfStock}${badge}${lowStock}
        ${renderImageWithFallback({
          src: img,
          alt: p.name,
          imgClass: 'card-img',
        })}
        <div class="card-overlay"></div>
        <div class="card-body">
          ${category ? `<span class="card-era">${category}</span>` : ''}
          <p class="card-name">${p.name}</p>
          <div class="card-footer">
            <button
              class="add-to-cart-quick cart-pill"
              data-product-id="${p.id}"
              title="افزودن به سبد"
              ${p.stock === 0 ? 'disabled' : ''}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              افزودن
            </button>
            <span class="card-price">${price}</span>
          </div>
        </div>
      </a>`;
  },

  bind(container, callbacks = {}) {
    container.querySelectorAll('.add-to-cart-quick').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
        const id = btn.dataset.productId;
        if (!id) return;
        const orig = btn.innerHTML;
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
        btn.innerHTML = '✓';
        btn.classList.add('is-success');
        try {
          await callbacks.onAddToCart?.(id);
        } catch (_) { /* page handles toast */ }
        setTimeout(() => {
          btn.disabled = false;
          btn.removeAttribute('aria-disabled');
          btn.innerHTML = orig;
          btn.classList.remove('is-success');
        }, 1800);
      });
    });
  },
};

export default ProductCard;