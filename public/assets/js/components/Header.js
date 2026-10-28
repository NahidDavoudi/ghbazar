import { storeConfig } from '../config/bootstrap.js';
import { pickVariantSet } from '../utils/imageUrl.js';
import auth from '../core/auth.js';

const Header = {
  render() {
    const user = auth.getCurrentUser();
    const loggedIn = auth.isLoggedIn();
    const logoSrc = pickVariantSet(storeConfig.logoVariants, 'thumb') || storeConfig.logo;
    const navLinks = storeConfig.texts.nav;

    const navItems = navLinks.map((l) => `
      <a href="${l.href}" data-link
         class="header-nav-link text-sm text-dim hover:text-body transition-all duration-200 px-3.5 py-1.5 rounded-full">
        ${l.label}
      </a>`).join('');

    const userArea = loggedIn
      ? `<div class="hidden md:flex items-center gap-2.5 header-user-pill px-3.5 py-1.5 rounded-full">
           <span class="text-xs text-muted hidden sm:inline">${user?.name || user?.phone || ''}</span>
           <span class="w-px h-3.5 bg-white/10" aria-hidden="true"></span>
           <button id="header-logout-btn" class="text-xs text-body/80 hover:text-accent transition-colors font-medium">خروج</button>
         </div>`
      : `<a href="login.html" class="header-glass-icon hidden md:flex w-10 h-10 items-center justify-center rounded-full transition-all duration-200 group" title="ورود">
           <i data-lucide="user" class="w-[18px] h-[18px] text-muted group-hover:text-body transition-colors"></i>
         </a>`;

    return `
      <header class="header-floating-wrap sticky top-0 z-40">
        <div class="header-liquid-glass max-w-[1240px] mx-auto px-4 md:px-6 h-[64px] md:h-[68px] flex items-center justify-between gap-4 relative">
          <a href="#/" data-link class="header-brand shrink-0 flex items-center gap-2.5 group relative z-10">
            <div class="header-logo-orb w-10 h-10 rounded-xl flex items-center justify-center">
              <img src="${logoSrc}" alt="${storeConfig.name}" class="h-7 w-7 object-contain transition-transform duration-300 group-hover:scale-105">
            </div>
            <span class="font-display text-xl md:text-2xl text-body tracking-[0.15em] font-bold hidden md:inline drop-shadow-sm" dir="ltr">${storeConfig.name}</span>
          </a>
          <nav class="header-nav-capsule hidden md:flex items-center gap-1 p-1 rounded-full relative z-10">${navItems}</nav>
          <div class="flex items-center gap-2.5 relative z-10">
            <button id="header-search-btn"
                class="header-glass-icon flex w-10 h-10 items-center justify-center rounded-full transition-all duration-200 group"
                title="جستجو" aria-label="جستجو">
              <i data-lucide="search" class="w-[18px] h-[18px] text-muted group-hover:text-body transition-colors"></i>
            </button>
            <a href="#/cart" data-link class="header-glass-icon relative w-10 h-10 flex items-center justify-center rounded-full transition-all duration-200 group">
              <i data-lucide="shopping-bag" class="w-[18px] h-[18px] text-muted group-hover:text-body transition-colors"></i>
              <span id="cart-badge" class="hidden absolute -top-0.5 -right-0.5 w-4 h-4 bg-accent text-white text-[9px] font-bold rounded-full flex items-center justify-center shadow-[0_2px_8px_rgba(207,23,54,0.6)]">0</span>
            </a>
            ${userArea}
          </div>
        </div>
      </header>`;
  },

  bind(container, callbacks = {}) {
    function highlightNav() {
      const rawHash = location.hash.split('?')[0];
      const hash = rawHash || '#/';
      container.querySelectorAll('.header-nav-link').forEach((a) => {
        const href = a.getAttribute('href');
        const active = href === hash;
        a.classList.toggle('is-active', active);
        a.classList.toggle('text-body', active);
        a.classList.toggle('font-bold', active);
      });
    }

    highlightNav();
    window.addEventListener('hashchange', highlightNav);

    container.querySelector('#header-logout-btn')?.addEventListener('click', async () => {
      await callbacks.onLogout?.();
    });

    container.querySelector('#header-search-btn')?.addEventListener('click', () => {
      callbacks.onOpenSearch?.();
    });
  },
};

export default Header;