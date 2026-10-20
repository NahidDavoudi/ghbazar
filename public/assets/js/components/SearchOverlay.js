/**
 * components/SearchOverlay.js — Search modal overlay
 */
import api from '../core/api.js';
import { formatPrice } from '../utils/priceFormatter.js';

const RECENT_KEY = 'gb_recent_searches';
const MAX_RECENT = 6;
const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;
const MAX_PREVIEW = 8;

const SearchOverlay = {
  _mounted: false,
  _els: {},
  _state: {
    isOpen: false,
    query: '',
    normalizedQuery: '',
    items: [],
    total: 0,
    loading: false,
    error: null,
    activeIndex: -1,
    tookMs: null,
    reqId: 0,
  },
  _debounce: null,
  _onGlobalKey: null,
  _onHashChange: null,

  render() {
    return `
      <div id="search-overlay" class="fixed inset-0 z-[100] hidden" role="dialog" aria-modal="true" aria-label="جستجو">
        <div id="search-overlay-backdrop" class="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>
        <div class="search-overlay-panel relative max-w-2xl mx-auto mt-[8vh] md:mt-[10vh] px-4">
          <div class="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
            <div class="flex items-center gap-3 px-5 py-4 border-b border-border">
              <i data-lucide="search" class="w-5 h-5 text-muted shrink-0"></i>
              <input
                type="text"
                id="search-overlay-input"
                placeholder="جستجو در محصولات..."
                autocomplete="off"
                autocorrect="off"
                autocapitalize="off"
                spellcheck="false"
                dir="rtl"
                class="flex-1 bg-transparent text-body text-base md:text-lg focus:outline-none placeholder:text-muted/60"
              />
              <button type="button" id="search-overlay-clear"
                      class="hidden text-muted hover:text-body text-xs px-2 py-1 rounded hover:bg-white/5 transition-colors">
                پاک کردن
              </button>
              <button type="button" id="search-overlay-close"
                      class="text-muted hover:text-body p-1 rounded-full hover:bg-white/5 transition-colors"
                      aria-label="بستن">
                <i data-lucide="x" class="w-4 h-4"></i>
              </button>
            </div>
            <div id="search-overlay-body" class="max-h-[60vh] overflow-y-auto"></div>
            <div id="search-overlay-footer" class="hidden px-5 py-3 border-t border-border flex items-center justify-between gap-3 text-xs">
              <span id="search-overlay-count" class="text-muted"></span>
              <a href="#" id="search-overlay-viewall" class="text-accent hover:underline font-medium whitespace-nowrap">
                مشاهده همه نتایج ←
              </a>
            </div>
          </div>
        </div>
      </div>`;
  },

  bind(container) {
    if (this._mounted) return;
    this._mounted = true;

    const root = container.querySelector('#search-overlay');
    this._els = {
      root,
      backdrop: root.querySelector('#search-overlay-backdrop'),
      input: root.querySelector('#search-overlay-input'),
      clear: root.querySelector('#search-overlay-clear'),
      close: root.querySelector('#search-overlay-close'),
      body: root.querySelector('#search-overlay-body'),
      footer: root.querySelector('#search-overlay-footer'),
      count: root.querySelector('#search-overlay-count'),
      viewAll: root.querySelector('#search-overlay-viewall'),
    };

    this._els.backdrop.addEventListener('click', () => this.close());
    this._els.close.addEventListener('click', () => this.close());
    this._els.clear.addEventListener('click', () => this._clearQuery());
    this._els.input.addEventListener('input', (e) => this._onInput(e.target.value));
    this._els.input.addEventListener('keydown', (e) => this._onKeyDown(e));

    this._els.viewAll.addEventListener('click', (e) => {
      e.preventDefault();
      const q = this._state.normalizedQuery || this._state.query.trim();
      if (q) {
        this._remember(this._state.query);
        window.location.hash = `#/shop?q=${encodeURIComponent(q)}`;
      }
      this.close();
    });

    // Delegated click inside results area
    this._els.body.addEventListener('click', (e) => {
      const resultEl = e.target.closest('[data-search-result]');
      if (resultEl) {
        const id = resultEl.dataset.searchResult;
        if (id) {
          this._remember(this._state.query);
          window.location.hash = `#/product?id=${id}`;
          this.close();
        }
        return;
      }
      const recentEl = e.target.closest('[data-recent]');
      if (recentEl) {
        const q = recentEl.dataset.recent;
        this._els.input.value = q;
        this._onInput(q);
        this._els.input.focus();
        return;
      }
      const clearRecent = e.target.closest('#search-overlay-clear-recent');
      if (clearRecent) {
        this._clearRecent();
        this._renderRecent();
      }
    });

    this._onGlobalKey = (e) => {
      if (!this._state.isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    };
    document.addEventListener('keydown', this._onGlobalKey);

    // اگر کاربر با back/forward ناوبری کرد، ببند
    this._onHashChange = () => {
      if (this._state.isOpen) this.close();
    };
    window.addEventListener('hashchange', this._onHashChange);
  },

  open(initialQuery = '') {
    if (!this._mounted) return;

    // reset
    this._state.items = [];
    this._state.total = 0;
    this._state.activeIndex = -1;
    this._state.tookMs = null;
    this._state.normalizedQuery = '';
    this._state.error = null;
    this._state.query = '';
    this._state.reqId++;

    this._state.isOpen = true;
    this._els.root.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    if (initialQuery) {
      this._els.input.value = initialQuery;
      this._onInput(initialQuery);
    } else {
      this._els.input.value = '';
      this._els.clear.classList.add('hidden');
      if (this._getRecent().length) this._renderRecent();
      else this._renderHint();
    }

    // فوکوس بعد از رندر
    requestAnimationFrame(() => this._els.input.focus());
    if (window.lucide) lucide.createIcons();
  },

  close() {
    if (!this._mounted) return;
    this._state.isOpen = false;
    this._state.reqId++;
    this._els.root.classList.add('hidden');
    document.body.style.overflow = '';
    if (this._debounce) {
      clearTimeout(this._debounce);
      this._debounce = null;
    }
  },

  // ─── Input handling ──────────────────────────────────────────

  _onInput(value) {
    this._state.query = value;
    this._els.clear.classList.toggle('hidden', !value);

    const q = value.trim();
    if (q.length < MIN_QUERY) {
      this._clearQueryResults();
      if (!q) {
        if (this._getRecent().length) this._renderRecent();
        else this._renderHint();
      } else {
        this._renderShortQueryHint();
      }
      return;
    }

    this._scheduleSearch(q);
  },

  _onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._moveActive(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._moveActive(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = this._state.items[this._state.activeIndex];
      if (active) {
        this._remember(this._state.query);
        window.location.hash = `#/product?id=${active.id}`;
        this.close();
      } else if (this._state.query.trim()) {
        this._remember(this._state.query);
        const q = this._state.normalizedQuery || this._state.query.trim();
        window.location.hash = `#/shop?q=${encodeURIComponent(q)}`;
        this.close();
      }
    }
  },

  _moveActive(delta) {
    const n = this._state.items.length;
    if (!n) return;
    let next = this._state.activeIndex + delta;
    if (next < 0) next = -1;
    else if (next >= n) next = n - 1;
    this._state.activeIndex = next;
    this._renderResults();

    // scroll into view
    if (next >= 0) {
      const el = this._els.body.querySelector(`[data-search-result][data-index="${next}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }
  },

  // ─── Search execution ────────────────────────────────────────

  _scheduleSearch(q) {
    if (this._debounce) clearTimeout(this._debounce);
    this._state.loading = true;
    this._renderLoading();
    this._debounce = setTimeout(() => this._runSearch(q), DEBOUNCE_MS);
  },

  async _runSearch(q) {
    const reqId = ++this._state.reqId;
    try {
      const data = await api.search.query(q, MAX_PREVIEW);
      if (reqId !== this._state.reqId) return; // stale
      this._state.items = data?.items || [];
      this._state.total = data?.total || 0;
      this._state.tookMs = data?.took_ms ?? null;
      this._state.normalizedQuery = data?.normalized_query || q;
      this._state.error = null;
      this._state.loading = false;
      this._state.activeIndex = -1;
      this._renderResults();
    } catch (err) {
      if (reqId !== this._state.reqId) return;
      this._state.items = [];
      this._state.total = 0;
      this._state.loading = false;
      this._state.error = err?.message || 'خطا در جستجو';
      this._renderResults();
    }
  },

  // ─── Rendering ───────────────────────────────────────────────

  _renderLoading() {
    this._els.footer.classList.add('hidden');
    this._els.body.innerHTML = `
      <div class="p-5 space-y-3">
        ${Array.from({ length: 3 }).map(() => `
          <div class="flex items-center gap-3 animate-pulse">
            <div class="w-14 h-14 rounded-lg bg-surface shrink-0"></div>
            <div class="flex-1 space-y-2">
              <div class="h-3 bg-surface rounded w-3/4"></div>
              <div class="h-3 bg-surface rounded w-1/3"></div>
            </div>
          </div>
        `).join('')}
      </div>`;
  },

  _renderHint() {
    this._els.footer.classList.add('hidden');
    this._els.body.innerHTML = `
      <div class="p-10 text-center text-muted">
        <i data-lucide="search" class="w-10 h-10 mx-auto mb-3 text-muted/60"></i>
        <p class="text-sm">برای شروع جستجو تایپ کنید</p>
      </div>`;
    if (window.lucide) lucide.createIcons();
  },

  _renderShortQueryHint() {
    this._els.footer.classList.add('hidden');
    this._els.body.innerHTML = `
      <div class="p-8 text-center text-muted">
        <p class="text-sm">حداقل ${MIN_QUERY} کاراکتر وارد کنید</p>
      </div>`;
  },

  _renderRecent() {
    const recent = this._getRecent();
    this._els.footer.classList.add('hidden');
    if (!recent.length) {
      this._renderHint();
      return;
    }
    this._els.body.innerHTML = `
      <div class="p-3">
        <div class="flex items-center justify-between px-2 py-2 mb-1">
          <span class="text-xs text-muted font-medium">جستجوهای اخیر</span>
          <button type="button" id="search-overlay-clear-recent"
                  class="text-xs text-muted hover:text-accent transition-colors">
            پاک کردن
          </button>
        </div>
        ${recent.map((q) => `
          <button type="button" data-recent="${this._esc(q)}"
                  class="w-full text-right flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors">
            <i data-lucide="clock" class="w-4 h-4 text-muted shrink-0"></i>
            <span class="text-sm text-body flex-1">${this._esc(q)}</span>
            <i data-lucide="arrow-up-left" class="w-3.5 h-3.5 text-muted/60 shrink-0"></i>
          </button>
        `).join('')}
      </div>`;
    if (window.lucide) lucide.createIcons();
  },

  _renderResults() {
    if (this._state.error) {
      this._els.footer.classList.add('hidden');
      this._els.body.innerHTML = `
        <div class="p-10 text-center">
          <i data-lucide="alert-circle" class="w-10 h-10 mx-auto mb-3 text-accent/70"></i>
          <p class="text-sm text-muted">${this._esc(this._state.error)}</p>
        </div>`;
      if (window.lucide) lucide.createIcons();
      return;
    }

    const items = this._state.items;
    if (!items.length) {
      this._els.footer.classList.add('hidden');
      this._els.body.innerHTML = `
        <div class="p-10 text-center">
          <i data-lucide="package-search" class="w-10 h-10 mx-auto mb-3 text-muted/60"></i>
          <p class="text-sm text-body mb-1">نتیجه‌ای یافت نشد</p>
          <p class="text-xs text-muted">عبارت دیگری را امتحان کنید</p>
        </div>`;
      if (window.lucide) lucide.createIcons();
      return;
    }

    const rows = items.map((p, i) => {
      const active = i === this._state.activeIndex;
      const finalPrice = p.final_price ?? p.price;
      const hasSale = p.sale_price && p.sale_price > 0 && p.sale_price < p.price;
      const img = p.main_image || '';
      const outOfStock = p.in_stock === false;
      return `
        <div data-search-result="${p.id}" data-index="${i}"
             class="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${active ? 'bg-white/5' : 'hover:bg-white/5'}">
          <div class="w-14 h-14 rounded-lg bg-surface border border-border overflow-hidden shrink-0 flex items-center justify-center">
            ${img
              ? `<img src="${this._esc(img)}" alt="${this._esc(p.name)}" class="w-full h-full object-cover" loading="lazy" />`
              : `<i data-lucide="image" class="w-5 h-5 text-muted/60"></i>`}
          </div>
          <div class="flex-1 min-w-0 text-right">
            <p class="text-sm text-body font-medium truncate">${this._esc(p.name)}</p>
            <div class="flex items-center gap-2 mt-0.5 flex-row-reverse justify-end">
              ${p.category_name ? `<span class="text-[10px] text-muted truncate">${this._esc(p.category_name)}</span>` : ''}
              ${outOfStock ? `<span class="text-[10px] text-accent">ناموجود</span>` : ''}
            </div>
          </div>
          <div class="text-left shrink-0">
            ${hasSale
              ? `<p class="text-[11px] text-muted line-through ltr">${formatPrice(p.price)}</p>
                 <p class="text-sm text-accent font-bold ltr">${formatPrice(finalPrice)}</p>`
              : `<p class="text-sm text-body font-bold ltr">${formatPrice(finalPrice)}</p>`}
          </div>
        </div>`;
    }).join('');

    this._els.body.innerHTML = `<div class="p-2 space-y-0.5">${rows}</div>`;

    // Footer
    this._els.footer.classList.remove('hidden');
    const total = this._state.total;
    const shown = items.length;
    const took = this._state.tookMs;
    let countText = '';
    if (total > shown) {
      countText = `${shown.toLocaleString('fa-IR')} از ${total.toLocaleString('fa-IR')} نتیجه`;
    } else {
      countText = `${total.toLocaleString('fa-IR')} نتیجه`;
    }
    if (took != null) countText += ` • ${took}ms`;
    this._els.count.textContent = countText;

    // Hide "view all" if all shown
    this._els.viewAll.classList.toggle('hidden', total <= shown);

    if (window.lucide) lucide.createIcons();
  },

  // ─── Helpers ─────────────────────────────────────────────────

  _clearQuery() {
    this._els.input.value = '';
    this._onInput('');
    this._els.input.focus();
  },

  _clearQueryResults() {
    this._state.items = [];
    this._state.total = 0;
    this._state.tookMs = null;
    this._state.normalizedQuery = '';
    this._els.footer.classList.add('hidden');
  },

  _getRecent() {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(0, MAX_RECENT) : [];
    } catch { return []; }
  },

  _remember(q) {
    const val = (q || '').trim();
    if (val.length < MIN_QUERY) return;
    try {
      const arr = this._getRecent().filter((x) => x !== val);
      arr.unshift(val);
      localStorage.setItem(RECENT_KEY, JSON.stringify(arr.slice(0, MAX_RECENT)));
    } catch { /* quota / private mode */ }
  },

  _clearRecent() {
    try { localStorage.removeItem(RECENT_KEY); } catch { /* noop */ }
  },

  _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  },
};

export default SearchOverlay;