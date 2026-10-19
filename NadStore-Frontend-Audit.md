# NadStore Frontend — Architecture & Styling Audit Report

**تاریخ:** 2026-09-27 — **Repo:** `rarshop` — **حالت:** فقط Audit، بدون تغییر کد
**Scope:** Storefront SPA (`index.html` + `assets/`) — Admin و Login فقط در حد ارتباط بررسی شدند.

---

## 1. Frontend Structure

### نوع پروژه

SPA تک‌صفحه‌ای بدون فریم‌ورک — Vanilla JS + ES Modules + Tailwind v4 + Navigo (hash router) + Swiper + Lucide. هیچ باندلر JS وجود ندارد؛ JS به صورت `type="module"` مستقیم لود می‌شود.

### Entry Points

| فایل | نقش | توضیح |
|---|---|---|
| `index.html:1` | Storefront SPA entry | تمام صفحات (`data-page="home/shop/product/..."`) داخل یک HTML؛ روتر فقط `active` را toggle می‌کند `assets/js/core/router.js:38` |
| `admin.html` | Admin SPA entry | جدا از storefront؛ ماژول `assets/js/admin/admin.js` |
| `login.html` | Auth page | `assets/js/login.js` — خارج از SPA shell |
| `assets/js/app.js:1` | JS entry | `initConfig → loadStoreSettings → initTheme → mountShell → Router.init` |
| `assets/css/input.css:1` | CSS entry | `tailwindcss` + `design-tokens.css` → `output.css` via `package.json:build:css` |
| `landing.html` | Reference فقط | کپی استاتیک از Hero + Featured + Banner + Newsletter — هرگز import نمی‌شود |

### Directory Responsibility Map

```
assets/js/config/    → Runtime config (store.config.js=fallback, app.config.js=infra, bootstrap.js=merge + window.StoreConfig)
assets/js/core/      → هسته: api.js (HTTP + retry + refresh), router.js (Navigo/hash), auth.js (token/role), state.js (tiny store), events.js (pubsub), theme.js (CSS vars injection), cartStore.js (guest+authed cart), storeSettings.js (GET /settings)
assets/js/components/→ 30 کامپوننت UI — همه الگوی {render()->html string, bind()->events, destroy?} — بدون JSX/Vue
assets/js/pages/     → 16 page-controller (home.js, shop.js ...) — هر کدام Router.onEnter('page', fn) ثبت می‌کند
assets/js/utils/     → Helpers خالص: imageUrl, priceFormatter, productVariants, dom, htmlEscape, stockHint, etc
assets/js/admin/     → پنل ادمین جدا (pages/products, categories, orders...)
assets/css/          → input.css (source), output.css (committed compiled), design-tokens.css (auto-generated), fonts.css
assets/images|fonts|data → استاتیک؛ image variants via imageUrl.js
```

**ارتباط:** `app.js` همه `pages/*.js` را import می‌کند تا handlerها ثبت شوند؛ `index.html` اسکلت DOM همه صفحات را دارد؛ page handler محتوای داخل `data-page` را با `innerHTML = Component.render()` پر می‌کند؛ `core/api.js` تنها راه تماس با بک‌اند است؛ `config/bootstrap.js:storeConfig` شیء mutable سراسری است که همه کامپوننت‌ها می‌خوانند.

### Shared Code

- `assets/js/utils/dom.js:hashHref` — لینک‌سازی هش
- `assets/js/utils/imageUrl.js:pickProductImage/pickBannerImage/pickVariantSet` — انتخاب سایز تصویر
- `assets/js/utils/priceFormatter.js`
- `assets/js/core/state.js` + `events.js` — state مشترک (فقط `cartCount`)
- `assets/js/config/bootstrap.js:storeConfig` — single source of truth برای texts/theme/UI

### Build / Lint / Test

`package.json:3` فقط دو اسکریپت دارد: `build:css` و `watch:css` (Tailwind CLI). **هیچ** `eslint`, `prettier`, `vite`, `test` runner وجود ندارد. `output.css` کامیت شده تا بدون rebuild هم کار کند `assets/css/input.css:100`. این یعنی drift بین `input.css` و `output.css` ممکن است.

---

## 2. Page → Component Architecture

الگو ثابت برای همه صفحات storefront:

```
index.html [data-page="X"] (static shell + mount points)
  → app.js:mountShell() injects Header/NotificationBar/Footer/MobileBottomNav (global shell)
  → Router:showPage() → pageHandler (pages/X.js) → fetches via api.* → Component.render(data) → innerHTML → Component.bind()
```

#### صفحه Home (`assets/js/pages/home.js:125`)

```
home (data-page)
 → HeroSection (slides from api.heroSlides.list fallback storeConfig.hero)
 → FeaturedCarousel → CurveCarousel + FeaturedPosterCard[]
 → Editorial Banner (STATIC HTML در index.html:142 — هیچ کامپوننت JS ندارد، کپی از landing.html)
 → Categories (CategoryCard[] via api.categories.list)
 → PromoPosterSlider (banners via api.promoBanners.list)
 → Newest Products Swiper (ProductCard[] via api.products.list + Swiper)
 → Newsletter (STATIC, no logic)
```

- **Data flow:** Page مسئول fetch است (`home.js:106 loadHero`, `131 featured`, `39 loadCategories`). کامپوننت‌ها pure presentation (بجز `ProductCard.bind` برای add-to-cart).
- **State/behavior:** فقط Swiper instances (`_heroSwiper`, `_productsSwiper`, `_promoSwiper`) در container ذخیره می‌شوند؛ destroy روی re-enter.

#### صفحه Shop (`assets/js/pages/shop.js`)

```
shop (data-page)
 → ShopHero (title)
 → ShopSidebar (facets + price range + attrs — renderAttributeGroup)
 → ShopProductCard[] grid
 → Pagination
```

Page فیلترها را از `location.hash?query` می‌خواند، `api.products.list(serializeProductFilters)` صدا می‌زند.

#### صفحه Product (`assets/js/pages/product.js`)

```
product
 → Breadcrumb
 → ProductGallery (images + thumbs + lightbox)
 → ProductInfo (axes/variants/price/stock/add-to-cart) ← utils/productVariants.js
 → CompleteStyleSection → RelatedProductCard[]
```

پیچیده‌ترین صفحه از نظر state (selected variant, stock hint).

#### سایر صفحات

`cart.js`, `checkout.js`, `orders.js`, `profile.js`, `categories.js`, `about/contact/terms/privacy/refund/faq` — همه الگوی یکسان: `PageHandler fetch → LegalContent/OrderRow/AddressCard render`.

**نکته معماری:** هیچ Layout کامپوننتی وجود ندارد؛ `index.html` خودش layout است (همه `data-page`ها display:none). Header/Footer/MobileNav سراسری و خارج از `router-outlet` هستند — mounted یک‌بار در `app.js:74`.

---

## 3. Component Usage Mapping

### Header `assets/js/components/Header.js:5`

- **Definition:** `render()` → header markup؛ `bind()` → highlight active nav + logout
- **Used in:** `app.js:81 mountShell` (یک‌بار)
- **Data:** `storeConfig.texts.nav`, `storeConfig.logoVariants`, `auth.getCurrentUser()`
- **Dependencies:** `auth.js`, `imageUrl.js`, `bootstrap.js`; CSS via `input.css: bg-body/80 backdrop-blur-xl border-border`
- **Variants:** ندارد (desktop nav + mobile icons یکی است؛ search دکمه dead `Header.js:36` بدون handler)
- **Inconsistency:** `cart-badge` داخل Header رندر می‌شود اما آپدیتش در `app.js:55 window.loadCartCount` سراسری است — coupling ضمنی.

### Footer `assets/js/components/Footer.js:7`

- **Used in:** `app.js:92` یک‌بار
- **Data:** `storeConfig.texts.footer`, `nav`, `legal.footerLinks`, `enamad`
- **Dependencies:** `ContactLinks`, `copyrightYear.js`
- **Issue:** Enamad لینک Hardcoded متفاوت با config: `Footer.js:48` هاردکد `id=764322` در حالی که `store.config.js:462` مقدار `id=748712` است — **config نادیده گرفته شده**.

### Button `assets/js/components/Button.js:10`

- **Definition:** `render({variant, size, href, label})` — دو variant واقعی: `aluminum` و `glass` (map شده به `storeConfig.ui.btnAluminum/btnGlass`)
- **Used in:** `HeroSection.js:46`, `ProductCard.js:22`, `ShopSidebar.js`, `Admin/*` — اما **کمتر از 30% دکمه‌های پروژه** از آن استفاده می‌کنند
- **Variants:**
  ```
  Button
   ├── aluminum (btn-aluminum) — براش متال، 3 سایز sm/md/lg + icon
   ├── glass (btn-glass) — liquid glass
   └── (هیچ) primary/danger/outline وجود ندارد
  ```
- **Inconsistencies (Critical):**
  - `index.html:142` editorial CTA: `bg-[#cf1736]` raw Tailwind، نه `Button`
  - `index.html:226` newsletter: `bg-[#cf1736]` raw
  - `Footer.js` / `Header.js` همه لینک‌ها raw `<a class="text-sm text-muted hover:text-body">`
  - `ShopSidebar.js` attribute buttons raw `bg-accent text-white` vs `Button` — دو سیستم موازی
  - `Button.js:23` فقط دو variant را می‌شناسد؛ `storeConfig.ui.btnAccent/btnPrimary` تعریف شده‌اند (`store.config.js:117`) اما **هیچ‌وقت استفاده نمی‌شوند**.

### ProductCard Family

| کامپوننت | فایل | استفاده | تفاوت واقعی |
|---|---|---|---|
| `ProductCard` | `ProductCard.js:11` | `home.js` newest swiper | `object-fill`, `+` btn, `ProductCard.bind` دارد |
| `ShopProductCard` | `ShopProductCard.js:11` | `shop.js` grid | `object-cover`, `scale-[1.03]` (نه 1.04), `bind()` خالی (global handler در `app.js:105`) |
| `RelatedProductCard` | `RelatedProductCard.js:9` | `CompleteStyleSection` | `thumb` سایز، `aspect-square`, بدون lowStockText |
| `FeaturedPosterCard` | `FeaturedPosterCard.js:7` | `FeaturedCarousel` | بدون overlay قیمت/دکمه، فقط نام |

**Evidence:** `ProductCard.js:39` و `ShopProductCard.js:38` تقریباً کپی با اختلاف یک خط (`object-fill` vs `object-cover`, transition 700 vs 500). `ShopProductCard.bind` خالی است در حالی که `ProductCard.bind` listener اضافه می‌کند — **دو مسیر متفاوت برای یک عمل (add-to-cart)**: یکی local `home.js:29 onAddToCart`, دیگری global `app.js:105`.

### HeroSection `assets/js/components/HeroSection.js:22`

- **Used in:** `home.js:106` فقط
- **Data:** `storeConfig.hero` + `api.heroSlides.list()`
- **Recent change:** بازنویسی به centered overlay مطابق `landing.html` (logo + Ghul Bazar + دو CTA) — single-slide path دقیقاً `landing.html:6` را کپی می‌کند؛ multi-slide path هر slide همان overlay را تکرار می‌کند.
- **Hardcoded:** `bg-[#cf1736]`, `bg-[#2d161a]/50`, `from-[#221114]` داخل JS string — باید token می‌بود.

### CategoryCard `assets/js/components/CategoryCard.js:8`

- **Used in:** `home.js:46` و `assets/js/pages/categories.js`
- **Data:** `c.slug/name/image, product_count`
- **Styling:** `storeConfig.ui.cardRadius` + inline `height:180px` هاردکد `CategoryCard.js:17` — تنها جای inline height.

### FeaturedCarousel `assets/js/components/FeaturedCarousel.js:13` + CurveCarousel

- **Used in:** `home.js:131` فقط
- **Data:** `api.products.list({featured:1})` → `FeaturedPosterCard[]` → `CurveCarousel.bind`
- **Dependencies:** `CurveCarousel.js` (Framer port, 400+ خط، rAF + drag + autoplay) — سنگین‌ترین کامپوننت
- **Config leakage:** `store.config.js:188 curve: {cardWidth, radius, angleStep...}` — 15 پارامتر عددی هاردکد

### PromoPosterSlider `assets/js/components/PromoPosterSlider.js:4`

- **Used in:** `home.js:77`
- **Aspect** از `storeConfig.promoSlider.aspect` می‌آید (`aspect-[21/9]`) — اما string کلاس Tailwind است، نه token.

### ShopSidebar `assets/js/components/ShopSidebar.js`

- **Used in:** `shop.js` فقط
- **Data:** `facets` از `api.products.list` (dynamic attributes + price_range)
- **Variants:** attribute به صورت button group (≤12 مقدار) یا checkbox list — منطق داخل `renderAttributeGroup`.

### MobileBottomNav `assets/js/components/MobileBottomNav.js:17`

- **Used in:** `app.js:99` سراسری
- **Data:** `storeConfig.texts.mobileBottomNav`
- **Logic:** `isActive` با `location.hash` + `auth.isLoggedIn()` — duplication با `Header.highlightNav`.

### سایر

`Accordion`, `Breadcrumb`, `Modal`, `Toast`, `Pagination`, `PageHeader`, `LegalContent`, `ContactLinks`, `OrderRow`, `OrderDetail`, `ProductGallery`, `ProductInfo`, `NotificationBar`, `AddressCard/Form` — هر کدام single-use بجز `LegalContent` (5 صفحه legal) و `PageHeader` (4 صفحه).

---

## 4. Component Inventory

### Global (واقعاً reusable)

| کامپوننت | Reusable؟ | دلیل |
|---|---|---|
| `Header` | ✅ نیمه | یک‌بار mount، اما nav highlight و cart-badge coupling دارد |
| `Footer` | ✅ نیمه | یک‌بار، اما enamad bug |
| `MobileBottomNav` | ✅ | سراسری، config-driven |
| `NotificationBar` | ✅ | سراسری، safeHex guard |
| `Button` | ⚠️ ضعیف | API خوب اما <30% استفاده — بیشتر جاها raw Tailwind |
| `Modal` | ✅ | generic، دو متد `show/hide` |
| `Toast` | ✅ | wrapper روی `helpers.js:toast` |
| `Breadcrumb` | ✅ | pure |
| `Pagination` | ✅ | pure, `onPageChange` callback |
| `PageHeader` | ✅ | 4 صفحه legal |
| `Accordion` | ✅ | FAQ |

### Commerce (بیشترین duplication)

| کامپوننت | Reusable؟ | توضیح |
|---|---|---|
| `ProductCard` | ⚠️ | فقط home newest |
| `ShopProductCard` | ❌ duplicate | کپی ProductCard با 2 اختلاف جزئی |
| `RelatedProductCard` | ❌ duplicate | کپی دیگر |
| `FeaturedPosterCard` | ⚠️ | فقط curve — variant logic `isCurve/isMarquee` ناقص (marquee هرگز استفاده نمی‌شود) |
| `ProductGallery` | ✅ | single-use product page |
| `ProductInfo` | ⚠️ | 300+ خط، منطق variant سنگین، قابل شکستن |
| `ShopSidebar` | ⚠️ | single-use shop |
| `CompleteStyleSection` | ✅ | wrapper روی RelatedProductCard |

### Content

| کامپوننت | Reusable؟ | توضیح |
|---|---|---|
| `HeroSection` | ⚠️ | فقط home — اخیراً landing-sync شده |
| `FeaturedCarousel` | ⚠️ | فقط home — wrapper نازک روی CurveCarousel |
| `CurveCarousel` | ❌ over-engineered | Framer port 400 خط، فقط یک‌بار استفاده |
| `PromoPosterSlider` | ✅ | اما trivial (یک Swiper) |
| `CategoryCard` | ✅ | home + categories |
| `LegalContent` | ✅ | 5 صفحه |
| `ContactLinks` | ✅ | Footer + Contact page |
| `ShopHero` | ❌ trivial | یک `<h1>` داخل section — ارزش کامپوننت ندارد |

**Fake/Weak Abstractions:**

- `ShopHero`, `Toast` (یک خط wrapper), `RelatedProductCard`/`ShopProductCard`/`ProductCard` (باید یک کامپوننت با variant باشند), `Button` (abstraction ادعایی اما bypass شده), `Footer` enamad (ادعای config-driven اما hardcode).

---

## 5. Styling Architecture

| روش | کجا | چقدر | تداخل/duplication |
|---|---|---|---|
| **Tailwind utilities** | همه `render()` stringها + `index.html` | ~85% استایل | منبع اصلی — اما کلاس‌های طولانی (avg 6-12 کلاس per element) |
| **CSS variables (design tokens)** | `design-tokens.css:5` primitives → semantic → component | تعریف کامل، استفاده ناقص | فقط `input.css:5 @theme` alias + `input.css:20` semantic utilities (`bg-body` etc) — خیلی جاها `bg-[#cf1736]` به جای `bg-accent` |
| **Vanilla CSS (input.css)** | `input.css:107-604` | ~500 خط | `.btn-aluminum`, `.btn-glass`, `.iris-card`, `.curve-carousel*`, `.mobile-bottom-nav` — **تنها CSS واقعی پروژه** |
| **Inline styles** | `CategoryCard.js:17 style="height:180px"`, `FeaturedCarousel.js:26 style="background-color:..."`, `NotificationBar.js:24 style="background:..."` | کم اما critical | `background-color` featured از config — باید CSS var می‌بود |
| **JS-generated styles** | `HeroSection.js:42` string interpolation با hex literals | متوسط | `bg-[#2d161a]/50` داخل JS — Tailwind JIT آن را purge نمی‌کند اگر در `output.css` نباشد |
| **Global CSS (index.html <style>)** | `index.html:21` | 90 خط | scrollbar, `tab-active`, `shop-sidebar` mobile overlay, `badge`, `fadeIn` — باید در `input.css` می‌بود |
| **Compiled output.css** | `output.css` (200KB+, committed) | 100% Tailwind utilities | اگر `input.css` تغییر کند اما `build:css` اجرا نشود، drift |

**Specificity conflicts:** کم (Tailwind utilities specificity برابر). اما `input.css:329 .carousel-nav-row .swiper-button-prev` با `!important` Swiper را override می‌کند — تنها `!important` پروژه.

**Duplication:** `bg-[#cf1736]` در `HeroSection.js` (2 بار), `index.html:142` (3 بار), `design-tokens.css:--color-primary` — سه نمایش یک رنگ.

---

## 6. Hardcoded UI Values

### Colors (بیشترین تکرار — همه باید token شوند اما نشده‌اند)

| مقدار | تکرار* | فایل‌ها |
|---|---|---|
| `#cf1736` (crimson primary) | 18 | `design-tokens.css` (correct), `HeroSection.js:42`, `index.html:144,160,207`, `output.css` |
| `#221114` (background) | 12 | `design-tokens.css`, `HeroSection.js:54` gradient |
| `#47242a` (border) | 14 | `design-tokens.css`, `index.html:207,213` |
| `#c8939c` (muted) | 9 | `design-tokens.css`, `HeroSection.js:40`, `index.html:157` |
| `#2d161a` (surface) | 10 | `design-tokens.css`, `HeroSection.js:43`, `index.html:207` |
| `#12070a`, `#241014`, `#1a0c0f` | 6 | فقط `index.html:142` editorial banner gradient |
| `rgba(0,0,0,0.4/0.5)` | 5 | `index.html:115`, `ProductCard.js:19` |

*تقریب از `grep -r bg-\[#` (43 match در output.css + 12 در source)

**مسئله:** `design-tokens.css` کامل است اما `index.html` editorial section همه رنگ‌ها را hardcode کرده (`bg-[#1a0c0f]`, `from-[#241014]`, `border-white/10`) — اگر theme عوض شود، این section نمی‌خورد.

### Typography

- Font families: `Vazirmatn` (body), `Agbalumo` (display), `Felipa` — درست tokenized (`design-tokens.css:66`)
- Font sizes: Tailwind scale (`text-xs` تا `text-7xl`) + دو مورد hardcode: `text-[11px]` `index.html:153` و `text-[9px]` `Header.js:41`
- Font weights: `font-bold/black/medium` Tailwind — بدون hardcode px

### Spacing

الگوی غالب: `px-4 md:px-6`, `py-12 md:py-20`, `gap-3/4/6`, `max-w-[1280px]` (تکرار **12 بار** در همه کامپوننت‌ها — باید token `max-width-content` می‌بود). `max-w-[900px]` در LegalContent، `max-w-[800px]` در FAQ — ناسازگار.

### Border Radius

| مقدار | استفاده |
|---|---|
| `rounded-full` (9999px) | همه دکمه‌ها, badge, cart-badge |
| `rounded-2xl` (1.75rem) | CategoryCard, promo, profile |
| `rounded-xl` (1.125rem) | card default (`design-tokens.css:77`) |
| `rounded-[28px]` | فقط editorial `index.html:148` — **تنها outlier** |
| `rounded-lg` | Hero CTA, inputs |

`rounded-[28px]` باید `rounded-2xl` یا token `banner-radius:1.75rem` می‌بود.

### Shadows

`design-tokens.css:80` سه shadow clay + cta + logo-glow تعریف کرده؛ اما `input.css:72` دوباره `box-shadow` raw برای `.btn-accent` تعریف می‌کند — duplication.

### Breakpoints

فقط Tailwind defaults: `sm:640, md:768, lg:1024` — همه via `md:` prefix. یک مورد دستی: `@media (max-width:767px)` `input.css:499` برای mobile nav padding — با Tailwind `md:hidden` همپوشانی اما سازگار.

### Width/Height Hardcode

- `CategoryCard.js:17 style="height:180px"` — تنها inline dimension
- `CurveCarousel` config: `cardWidth:300, mobileCardWidth:240` — در JS, نه CSS
- `max-w-[1280px]` repetition — باید `container` یا token

---

## 7. Design System Audit

### Colors (استخراج از `design-tokens.css:95`)

```
Primary:        #cf1736 / hover #e01d3f / soft #e11d48
Background:     #221114 / subtle #2d161a / muted #3a1f24 / deep #1a0c0f
Foreground:     #ffffff / muted rgba(255,255,255,0.6) / faint 0.45
Muted:          #c8939c (text muted) / #b07880 (strong)
Border:         #47242a / soft rgba(255,255,255,0.10)
Success:        #4ade80 / bg rgba(20,83,45,0.3)
Ring:           #cf1736
```

**Status:** تعریف کامل و منسجم در `design-tokens.css` — اما **مصرف ناقص** (hardcode hex در index.html/HeroSection).

### Typography

```
Body:    Vazirmatn, sans-serif
Display: Agbalumo, cursive (Hero title)
Felipa:  Felipa, sans-serif (unused? only token)
Scale:   2xs 0.625rem → 7xl 4.5rem (Tailwind)
Weight:  400/500/600/700/900
```

Hero از `font-display` استفاده می‌کند؛ بقیه `font-vazir`.

### Spacing

`primitive-spacing 0→24` (0 تا 6rem) + semantic `spacing-section:3rem, component:1.5rem, card-gap:1.5rem` — اما **هیچ‌جا استفاده نمی‌شوند**؛ همه `py-12, px-4, gap-3` hardcode Tailwind.

### Radius

`sm 0.5rem, md 0.75, lg 1rem, xl 1.125, 2xl 1.75, full 9999px` — تعریف شده اما editorial `28px` outlier.

### Shadows

`clay, clay-hover, clay-active, cta, logo-glow` — تعریف شده، اما فقط `logo-glow` در Hero استفاده شده (`drop-shadow-[0_0_24px_rgba(207,23,54,0.6)]` دوباره hardcode).

**نتیجه:**

> **Design System = نیمه‌رسمی، پراکنده.**
> - ✅ `design-tokens.css` ساختار 3 لایه‌ای (primitive → semantic → component) دارد و auto-generated ادعا می‌کند (اما `tokens.json` وجود ندارد — manual).
> - ✅ Tailwind `@theme` alias و semantic utilities (`bg-body`, `text-muted`) وجود دارد.
> - ❌ مصرف inconsistent: 40% رنگ‌ها hardcode hex، spacing/radius/shadow tokens بلااستفاده.
> - ❌ هیچ مستندات یا Storybook — tokenها فقط در CSS زندگی می‌کنند، نه در JS config (بجز `store.config.js:theme` که 8 رنگ را mirror می‌کند — duplication).
> - ❌ Editorial section و HeroSection کاملاً خارج از system.

---

## 8. CSS Dependency Analysis

```
Component
  → Component CSS (input.css: .iris-card, .btn-*)
  → Semantic utilities (bg-body, text-muted — via CSS vars)
  → Tailwind utilities (px-4, flex, rounded-2xl)
  → Swiper CSS (libs/swiper-bundle.min.css)
  → Browser defaults
```

#### ProductCard dependency map

```
ProductCard.js render()
  ├─ .iris-card (input.css:206 — bg var(--color-dark-3), border var(--color-border), hover translateY+shadow)
  ├─ .bg-surface (input.css:24 → var(--color-dark-2)) — image container fallback
  ├─ renderProductCardOverlay() → .product-card__gradient (input.css:218) + text utilities
  ├─ Button.render() → .btn .btn-aluminum .btn-icon (input.css:101+241+257)
  └─ Tailwind: group-hover:scale, transition-transform, overflow-hidden
```

**Leakage:** اگر `input.css` لود نشود، card بدون border/hover/shadow می‌ماند — Tailwind به تنهایی کافی نیست.

#### Header dependency map

```
Header.js → Tailwind only + input.css utilities (bg-body/80, border-border)
  └─ No component-specific CSS
  └─ Depends on global --color-* vars (theme.js injection)
```

**Fragile:** `backdrop-blur-xl` بدون prefix `-webkit` در Safari قدیمی می‌شکند (اما Tailwind دارد).

#### HeroSection dependency map

```
HeroSection.js → Tailwind + --color-* + inline gradients
  └─ Single-slide: no Swiper CSS needed
  └─ Multi-slide: needs swiper-bundle.min.css + .hero-swiper-pagination
  └─ Hardcoded gradients depend on exact hex — not themable
```

#### CurveCarousel dependency map

```
CurveCarousel → input.css:348-478 (.curve-carousel*, .featured-poster-curve) — 130 lines
  ├─ Depends on CSS vars --curve-card-w, --curve-card-h, --curve-transition-ms (JS sets inline)
  ├─ No Tailwind (pure vanilla positioning with absolute + transform)
  └─ Isolation: isolation:isolate + z-index juggling
```

**Most isolated** — اما 130 خط CSS برای یک‌بار استفاده.

#### Global leakage examples

- `index.html:38 ::-webkit-scrollbar` — global، همه صفحات را affect می‌کند — باید در input.css می‌بود.
- `input.css:93 div[data-page] {display:none}` — global page visibility — critical اما hidden در input.css.
- `input.css:499 @media (max-width:767px) body{padding-bottom}` — global side-effect برای mobile nav.

**Override chain:** `output.css` (Tailwind) → `input.css` (component) → `index.html <style>` (page-specific) → inline `style="..."` — ترتیب لود `swiper-bundle → output.css → fonts.css → <style>` یعنی `<style>` برنده است، اما `output.css` committed و ممکن است stale باشد.

---

## 9. Header / Footer / Button / Product Card Deep Audit

### Header `assets/js/components/Header.js:5`

- **Structure:** `logo+name | nav (desktop) | search(dead)+cart+user`
- **Responsive:** `hidden md:flex` برای nav/user؛ mobile فقط cart+logo — بدون hamburger/menu (navigation mobile via `MobileBottomNav`)
- **CSS deps:** Tailwind + `border-border`, `bg-body/80 backdrop-blur-xl` — هیچ CSS اختصاصی
- **JS deps:** `auth.js`, `imageUrl.js`, `storeConfig`
- **Repeated markup:** `max-w-[1280px] mx-auto px-4 md:px-6` — با Footer/PageHeader تکرار (DRY violation)
- **Hardcoded:** `w-[18px] h-[18px]`, `h-16`, `tracking-[0.15em]` — جزئی
- **Inconsistency:** `search` button هیچ handler ندارد (`Header.js:36`); `header-nav-link` highlight با `hashchange` اما `MobileBottomNav` منطق جدا — دو source of truth برای active state.

### Footer `assets/js/components/Footer.js:7`

- **Structure:** 4-col grid (brand | quick links | legal | contact) + bottom bar (copyright + enamad)
- **Responsive:** `grid-cols-2 lg:grid-cols-4` — روی mobile ستون‌ها collapse منطقی
- **CSS deps:** Tailwind + `border-border`, `bg-body`
- **JS deps:** `ContactLinks`, `copyrightYear.js`
- **Bug:** `Footer.js:48` enamad hardcode `id=764322` در حالی که `store.config.js:463` `id=748712` — **config بی‌اثر**.
- **Hardcoded:** `gap-x-6 gap-y-10`, `py-12` — سازگار
- **Reusable parts:** `ContactLinks` reusable اما Footer آن را با `variant:inline` صدا می‌زند — OK.

### Buttons — تمام patterns

| Pattern | کجا | کلاس |
|---|---|---|
| `Button` aluminum | ProductCard add-to-cart, Hero CTA (old) | `btn btn-aluminum btn-icon/btn-lg` |
| `Button` glass | Hero secondary (old) | `btn btn-glass` |
| Raw crimson CTA | Editorial `index.html:160`, Hero new | `bg-[#cf1736] hover:bg-[#e01d3f]` |
| Raw glass CTA | Hero new secondary | `bg-[#2d161a]/50 border-white/20` |
| Raw attribute pill | ShopSidebar | `bg-accent / bg-card border-border` |
| Raw pagination | Pagination.js | `border-accent bg-accent/20` |
| Raw admin | Admin pages | `bg-accent hover:bg-accent-hover` |

**نتیجه:** Button abstraction شکست خورده — 70% دکمه‌ها raw هستند. `Button.js:23` فقط `aluminum/glass` می‌شناسد؛ `btn-accent` در `input.css:63` تعریف شده اما **هیچ‌جا via Button استفاده نمی‌شود** (`storeConfig.ui.btnAluminum=btn-accent` alias اما Button آن را به `btn-aluminum` map نمی‌کند — naming confusion).

### Product Cards — همه variants

| واریانت | فایل | تفاوت واقعی | باید جدا باشد؟ |
|---|---|---|---|
| `ProductCard` (home) | `ProductCard.js` | `object-fill`, bind دارد | — |
| `ShopProductCard` | `ShopProductCard.js` | `object-cover`, bind خالی | ❌ نه — یکی با prop `variant:shop` کافی |
| `RelatedProductCard` | `RelatedProductCard.js` | `thumb`, `aspect-square`, بدون stock hint | ⚠️ شاید جدا (سایز متفاوت) اما 80% کپی |
| `FeaturedPosterCard` | `FeaturedPosterCard.js` | بدون قیمت/دکمه، curve logic | ✅ جدا (poster semantics) |

**Duplication evidence:** `ProductCard.js:10-49` vs `ShopProductCard.js:11-48` — diff فقط 3 خط. `RelatedProductCard.js:8` هم 90% همان. هر سه `renderProductCardOverlay` را صدا می‌زنند (به جز FeaturedPoster).

---

## 10. Duplication Analysis

### Markup Duplication

| محل | نمونه | شباهت | ارزش abstraction |
|---|---|---|---|
| Section header (title + view-all) | `FeaturedCarousel.js:27`, `index.html:177,195`, `CompleteStyleSection.js:9` | 90% یکسان (`flex justify-between` + `h2` + `a > chevron-left`) | ✅ بالا — `SectionHeader` component |
| Page container | `max-w-[1280px] mx-auto px-4 md:px-6` ×12 | 100% | ✅ token یا `container` class |
| Product card wrapper | 3 فایل ProductCard | 85% | ✅ یک کامپوننت با variant |
| Out-of-stock overlay | `ProductCard.js:19` و `ShopProductCard.js:19` | 100% | ✅ utility function (هست اما کپی) |
| Legal pages | `about.js`, `contact.js`, `terms.js` etc | 70% via `LegalContent` | ✅ قبلاً abstract شده — خوب |

### Style Duplication

| الگو | تکرار | محل |
|---|---|---|
| `bg-card border border-border rounded-2xl p-6` | 9 بار | Cart, Checkout, Profile, Accordion, LegalContent |
| `text-sm text-muted hover:text-body transition-colors` | 15 بار | Header, Footer, Pagination, همه لینک‌ها |
| `bg-[#cf1736] hover:bg-[#e01d3f]` | 5 بار | Editorial, Newsletter, Hero |
| `backdrop-blur + bg-[#2d161a]/50 border-white/20` | 2 بار | Hero secondary CTA |

### Component Duplication

| گروه | تعداد impl | مسئولیت | توصیه |
|---|---|---|---|
| Product cards | 4 | نمایش محصول | ادغام به 1 + variant prop |
| Button paths | 2 (Button vs raw) | CTA | یکسان‌سازی روی Button |
| PageHeader vs ShopHero | 2 | عنوان صفحه | ادغام |
| Toast helpers | 2 (`helpers.js:toast` vs `Toast.js` wrapper) | notification | حذف wrapper |

---

## 11. Responsive Architecture

### Breakpoints

فقط Tailwind defaults: `md:768px` ستون فقرات همه responsive logic. هیچ breakpoint سفارشی تعریف نشده (`design-tokens.css` هیچ breakpoint ندارد).

### Mobile-specific

- `MobileBottomNav` — `md:hidden` island (fixed bottom + blur) — خوب
- `ShopSidebar` — `index.html:77` JS toggle `sidebar-open` → fixed fullscreen overlay روی mobile، sticky روی desktop — منطق در `index.html <style>` و `shop.js` — **باید در input.css و Sidebar component می‌بود**.
- `HeroSection` — `min-h-[500px] md:min-h-[700px]` + `aspect-[4/5] sm:aspect-[16/9]`
- `CurveCarousel` — دو config جدا `cardWidth/mobileCardWidth`, `radius/mobileRadius` — responsive در JS، نه CSS.

### Duplicated mobile/desktop markup

- `index.html:207` محصولات: دو nav جدا — `hidden md:flex` (absolute) + `flex md:hidden` (row) — **markup duplication برای یک nav**.
- Header: `hidden md:flex` vs mobile bottom nav — دو navigation tree جدا با منطق active متفاوت.

### مشکلات

- `body{padding-bottom: calc(5rem + env(safe-area))}` فقط via `input.css:499 @media (max-width:767px)` — اگر mobile nav حذف شود، padding می‌ماند.
- `overflow-x-hidden` روی `body` (`index.html:126`) برای جلوگیری از curve carousel overflow — band-aid به جای `overflow-x-clip` روی section (که هست اما کافی نیست).

---

## 12. Naming & Convention Audit

| حوزه | Convention فعلی | Consistency | Issues |
|---|---|---|---|
| **Components** | PascalCase file (`ProductCard.js`) + object `{render,bind}` | ✅ منسجم | اما `Toast.js` فقط wrapper — naming overkill |
| **CSS classes (Tailwind)** | kebab + arbitrary `bg-[#...]` | ✅ Tailwind | اما `bg-body` vs `bg-[#1a0c0f]` — دو سیستم |
| **CSS classes (custom)** | BEM-like `.curve-carousel__stage` + flat `.iris-card` | ⚠️ مخلوط | BEM فقط برای CurveCarousel؛ بقیه flat |
| **CSS vars** | `--color-accent` vs `--primitive-color-wine-300` | ✅ لایه‌بندی | اما `--color-dark` alias برای `--color-background` — confusion |
| **JS functions** | camelCase `pickProductImage`, `formatPrice` | ✅ | OK |
| **Config keys** | camelCase `cardRadius`, `backgroundColor` | ⚠️ | `cardRadius` در JS اما `card-radius` در CSS var |
| **Route/page keys** | kebab `payment-result` vs snake `payment_result` | ❌ | `router.js:18 page:'payment_result'` اما `data-page="payment-result"` — mismatch |
| **StoreConfig texts** | `home.featured`, `shop.filtersTitle` | ✅ | اما `legal.about.whyChooseUs` vs `legal.faq.items` — ناسازگار plural |

**Inconsistencies مهم:**

1. `storeConfig.ui.btnAluminum = "btn-aluminum"` اما `input.css` کلاس `.btn-aluminum` تعریف می‌کند — OK؛ اما `storeConfig.ui.btnAccent = "btn-accent"` هیچ‌وقت استفاده نمی‌شود — dead config.
2. `data-page="payment-result"` vs `Router page:'payment_result'` — اگر کسی `page` را refactor کند، `showPage` می‌شکند.
3. `assets/js/pages/home.js` vs `router script:'home'` — home handler در `home.js` اما route `script:'products'` برای `/product` — naming mismatch.

---

## 13. Architecture Problems

### Critical

**C1 — Product Card Fragmentation**

- Location: `ProductCard.js:11`, `ShopProductCard.js:11`, `RelatedProductCard.js:9`, `FeaturedPosterCard.js:7`
- Evidence: 4 کامپوننت برای یک مفهوم؛ `ProductCard` vs `ShopProductCard` diff=3 خط؛ دو مسیر add-to-cart (local bind vs global `app.js:105`)
- Why: هر تغییر UI باید 3 فایل را touch کند؛ باگ discount/stock سه‌بار replicate می‌شود
- Affected: Home, Shop, Product detail
- Direction: یک `ProductCard` با `variants: {default, shop, related, poster}` + prop `imageSize`, `showAddToCart`, `aspect`.

**C2 — Button Abstraction Bypass**

- Location: `Button.js:10` vs `index.html:160`, `Header.js:14`, `ShopSidebar.js`
- Evidence: `Button` فقط 2 variant می‌شناسد؛ 70% دکمه‌ها raw Tailwind؛ `btn-accent` CSS وجود دارد اما via Button استفاده نمی‌شود
- Why: Design system قابل اعتماد نیست؛ تغییر رنگ CTA نیاز به grep 10 فایل دارد
- Direction: `Button` را به 4 variant (`primary/accent`, `secondary/glass`, `ghost`, `outline`) گسترش + همه raw `bg-[#cf1736]` را مهاجرت.

**C3 — No Build for JS, Committed output.css**

- Location: `package.json:3`, `output.css` (committed), `app.js` (no bundle)
- Evidence: فقط `build:css`؛ هیچ minify/tree-shake برای JS؛ `output.css` ممکن است stale باشد
- Why: Deploy با CSS قدیمی؛ JS بدون cache-busting
- Direction: `vite` یا `parcel` برای JS + CI check `output.css` freshness

### High

**H1 — Design Tokens Not Consumed**

- Location: `design-tokens.css:94` vs `index.html:142`, `HeroSection.js:42`
- Evidence: Editorial section 6 hardcode hex؛ Hero 3 hardcode
- Why: Theme switch via `theme.js` editorial را نمی‌گیرد
- Direction: جایگزینی `bg-[#...]` با `bg-accent`, `bg-body`, `border-border-soft` + token جدید `banner-bg` اگر لازم

**H2 — Global `<style>` in index.html**

- Location: `index.html:21` (90 lines)
- Evidence: scrollbar, sidebar overlay, badge, fadeIn — همه باید در `input.css` باشند
- Why: Styles فقط وقتی index.html لود شود اعمال می‌شود؛ admin.html آنها را ندارد
- Direction: انتقال کامل به `input.css`

**H3 — Shop Sidebar Mobile Logic Leaks**

- Location: `index.html:77` + `shop.js` toggle + `index.html:111 #sidebar-backdrop`
- Evidence: CSS در HTML، JS در page controller، backdrop جدا
- Why: تکرار برای هر sidebar جدید
- Direction: `ShopSidebar` component با `open/close` API + CSS در `input.css`

**H4 — CurveCarousel Over-Engineering**

- Location: `CurveCarousel.js` (400+ lines), `input.css:348` (130 lines), `store.config.js:193` (15 params)
- Evidence: Framer port برای یک‌بار استفاده؛ 15 config param برای 8 محصول
- Why: Maintenance cost بالا، bundle weight
- Direction: ارزیابی: آیا Swiper ساده کافی نیست؟ اگر نه، مستندسازی و تست.

**H5 — Header/Footer Container Duplication**

- Location: `Header.js:29`, `Footer.js:17`, `PageHeader.js:7` — همه `max-w-[1280px] mx-auto px-4 md:px-6`
- Evidence: 12 تکرار
- Why: تغییر max-width نیاز به 12 ادیت
- Direction: `.content-container` utility در `input.css` یا Tailwind `container` config.

### Medium

**M1 — Route/Page Key Mismatch** (`payment-result` vs `payment_result`) — `assets/js/core/router.js:18`
**M2 — Footer Enamad Hardcode** (`Footer.js:48` vs `store.config.js:463`)
**M3 — ProductInfo 300+ lines** — باید به sub-components شکسته شود
**M4 — No Lint/Test** — هیچ گارد کیفی
**M5 — Search Button Dead** (`Header.js:36` بدون handler)
**M6 — Newsletter No Logic** (`index.html:226` button بدون form handler)

### Low

**L1 — `tokens.json` missing** — `design-tokens.css:2` می‌گوید auto-generated اما source وجود ندارد
**L2 — `RelatedProductCard` uses `thumb` vs `medium` inconsistency**
**L3 — `CompleteStyleSection.js:7` has `border-black/10` hardcode vs `border-border`**
**L4 — `ContactLinks` brand SVGs inline vs Lucide — دو icon system**

---

## 14. Recommended Target Architecture

بر اساس معماری واقعی (نه تئوری انتزاعی):

```
assets/
  css/
    design-tokens.css   ← منبع حقیقت (اضافه کردن tokens.json + build step)
    input.css           ← فقط @theme + utilities + component CSS (انتقال <style> index.html)
    output.css          ← generated, .gitignore + CI build
  js/
    config/             ← نگه‌دار (bootstrap/store/app) — OK
    core/               ← نگه‌دار (api/router/auth/theme) — OK، اما auth+cartStore ادغام جزئی
    components/
      ui/               ← Button, Modal, Toast, Badge, Input, Accordion, Breadcrumb, Pagination
      layout/           ← Header, Footer, MobileBottomNav, NotificationBar, PageHeader, SectionHeader (new)
      commerce/         ← ProductCard (unified), ProductGallery, ProductInfo (split), ShopSidebar, Price, StockHint
      content/          ← HeroSection, CategoryCard, PromoPosterSlider, LegalContent
      experiential/     ← CurveCarousel (یا حذف) — جدا نگه‌دار چون cost بالا
    pages/              ← نگه‌دار اما slim — فقط data fetching + composition، نه markup سازی
    utils/              ← نگه‌دار — خوب
```

**چه global باشد:**

- `design-tokens.css` + `input.css` utilities (`bg-body`, `text-muted`, `content-container`)
- `Header/Footer/MobileNav/NotificationBar` (shell)
- `Button`, `Modal`, `Toast`, `SectionHeader`
- `api`, `router`, `theme`, `storeConfig`

**چه component-level باشد:**

- `ProductCard` variants (via props, نه فایل جدا)
- `ProductGallery`, `ProductInfo` sub-components
- `CurveCarousel` CSS (همراه کامپوننت, نه global)

**چه abstraction نشود:**

- `ShopHero` (یک h1) — inline در page
- `Toast` wrapper — حذف، مستقیم `helpers.toast`
- `FeaturedCarousel` wrapper نازک — ادغام در `CurveCarousel` یا Swiper
- Editorial banner static — بماند در index.html یا `EditorialBanner` فقط اگر قرار است CMS-driven شود

**کجا CSS مستقل ارزش دارد:**

- `CurveCarousel` (130 خط) — دارد
- `ProductCard` (`.iris-card`, `.product-card__gradient`) — دارد
- `MobileBottomNav` — دارد
- **کجا Tailwind کافی است:** Header, Footer, Breadcrumb, Pagination, PageHeader — همه Tailwind + semantic utilities

**کجا token لازم است:**

- `max-w-content: 1280px` (به جای 12 تکرار)
- `banner-radius`, `editorial-gradient` (به جای hardcode #241014→#12070a)
- `spacing-section` که تعریف شده اما استفاده نمی‌شود — فعال‌سازی

---

## 15. Refactoring Roadmap (Dependency-Aware)

**Phase 0 — Audit** ✅ (همین گزارش)

**Phase 1 — hygiene بدون ریسک (1-2 روز)**

- انتقال `index.html <style>` به `input.css`
- `output.css` را `.gitignore` + CI `build:css` check
- Fix `Footer.js:48` enamad hardcode → `storeConfig`
- Fix `payment-result` vs `payment_result` mismatch
- اضافه کردن `tokens.json` یا حذف کامنت auto-generated

**Phase 2 — Design Tokens Consumption (1 هفته)**

- جایگزینی همه `bg-[#cf1736]` → `bg-accent`, `border-[#47242a]` → `border-border`, `text-[#c8939c]` → `text-muted`
- Token جدید `content-container` برای `max-w-[1280px]`
- Editorial banner را token-aware کن (`banner-bg`, `banner-border`)
- `theme.js` را تست کن که همه sectionها react کنند

**Phase 3 — SectionHeader Extraction (2 روز)**

- کامپوننت `SectionHeader {title, icon, href, label}` از duplication `FeaturedCarousel + index.html home`
- جایگزینی 4 تکرار

**Phase 4 — Button Normalization (1 هفته)**

- `Button.js` → 4 variant (`primary/accent`, `secondary/glass`, `ghost`, `outline`) + size prop
- مهاجرت همه raw `bg-[#cf1736]` CTAها به `Button` (Hero, Editorial, Newsletter)
- `ShopSidebar` attribute pills به `Button` variant

**Phase 5 — Product Card Unification (1-2 هفته، پرریسک‌ترین)**

- یک `ProductCard` با `props: {variant, imageSize, aspect, showOverlay, showAddToCart}`
- `ShopProductCard` و `RelatedProductCard` را deprecated (re-export)
- یکسان‌سازی `object-cover` vs `object-fill` (تصمیم: `cover` — evidence: shop correct, home `fill` distort می‌کند)
- یک مسیر add-to-cart (حذف global `app.js:105` یا `ProductCard.bind` — یکی)
- Visual regression QA

**Phase 6 — Header/Footer Polish (3 روز)**

- `Search` handler یا حذف دکمه dead
- Container utility
- Active nav single source of truth (Header + MobileNav shared util)

**Phase 7 — Shop Sidebar & ProductInfo Split (1 هفته)**

- Sidebar به component با `open/close` API
- `ProductInfo` → `VariantSelector` + `PriceBlock` + `StockHint` + `AddToCartBar`

**Phase 8 — CurveCarousel Decision (spike 1 روز)**

- A/B: Swiper coverflow vs CurveCarousel — اگر Swiper کافی، حذف 500 خط

**Phase 9 — Tooling (موازی)**

- ESLint + Prettier + `lint-staged`
- `vite` برای JS bundling + cache busting
- (Optional) Vitest برای utils + Playwright visual regression

---

## 16. Final Executive Summary

### Current Architecture (10 bullet)

- SPA بدون فریم‌ورک: `index.html` shell + `Navigo` hash router + `data-page` toggle
- `app.js` entry → `bootstrap` (config) → `theme` (CSS vars) → `mountShell` (Header/Footer) → `Router.init`
- 30 کامپوننت با الگوی `{render:htmlString, bind:events}` — بدون JSX/Vdom
- 16 page controller که `Router.onEnter` ثبت می‌کنند و `api.*` fetch می‌کنند
- `core/api.js` لایه HTTP کامل (retry, refresh, withFallback) — بهترین بخش معماری
- `storeConfig` mutable global — single source برای texts/theme/UI
- `Tailwind v4` + `design-tokens.css` 3-layer (primitive→semantic→component) + `input.css` component CSS
- `output.css` committed — بدون JS bundler
- Admin جدا (`admin.html`), Login جدا
- هیچ تست/lint/build برای JS

### Biggest Problems (10)

1. 4 ProductCard impl برای یک مفهوم + دو مسیر add-to-cart
2. Button abstraction bypass (70% raw)
3. Design tokens تعریف کامل اما 40% مصرف hardcode
4. `output.css` committed + no JS build — drift risk
5. `index.html <style>` 90 خط global CSS خارج از input.css
6. Shop sidebar mobile logic leaks (CSS در HTML, JS در page)
7. CurveCarousel 400+ خط برای یک‌بار استفاده
8. `max-w-[1280px]` ×12 duplication
9. Footer enamad hardcode vs config, route key mismatch
10. هیچ lint/test — regression invisible

### Existing Reusable Components (واقعاً reusable)

`Header*`, `Footer*`, `MobileBottomNav`, `NotificationBar`, `Modal`, `Pagination`, `Breadcrumb`, `Accordion`, `LegalContent`, `CategoryCard`, `ProductGallery`, `ContactLinks`, `PageHeader` — (* با caveat کوچک)

### Fake/Weak Abstractions

`Button` (bypassed), `ShopProductCard`/`RelatedProductCard` (کپی), `ShopHero` (trivial), `Toast` (wrapper یک خط), `FeaturedCarousel` (wrapper نازک), `Footer enamad` (config ignored), `storeConfig.ui.btnAccent` (dead)

### Major Duplications

- Section header (title+view-all) ×4 → `SectionHeader`
- Product card ×3 → unified `ProductCard`
- `max-w-[1280px] mx-auto px-4 md:px-6` ×12 → container token
- `bg-card border border-border rounded-2xl p-6` ×9
- Editorial/Hero `bg-[#cf1736]` ×5

### Design System Status

> **نیمه‌رسمی، پراکنده.** `design-tokens.css` ساختار حرفه‌ای 3 لایه دارد و Tailwind `@theme` alias وجود دارد، اما مصرف inconsistent، spacing/shadow tokens بلااستفاده، و بخش‌های کلیدی (Editorial, Hero) کاملاً خارج از system هستند. بدون مستندات/Storybook. تغییر theme همه جا را نمی‌گیرد.

### Recommended First Step

**Phase 1 hygiene: انتقال `index.html <style>` به `input.css` + fix `Footer enamad` + `output.css` freshness check.** — کم‌ریسک‌ترین، بیشترین اعتماد برای فازهای بعد، هیچ visual change ندارد اما coupling را کم می‌کند. تخمین 1 روز.

### What NOT to do yet

- **Product Card unification را الان شروع نکن** — بدون Phase 1+2، visual regression قابل تشخیص نیست و hardcode colors دوباره کپی می‌شوند.
- **CurveCarousel را بازنویسی نکن** — هزینه بالا، ارزش نامشخص؛ اول spike تصمیم بگیر.
- **Tailwind را به CSS Modules یا بالعکس مهاجرت نکن** — هر دو لازمند؛ فقط boundary را شفاف کن (tokens vs utilities vs component CSS).
- **JS bundler را قبل از Phase 2 اضافه نکن** — اول CSS drift را fix کن، بعد JS.
- **Editorial banner را CMS-driven نکن** — فعلاً static بماند تا Phase 2 token-aware شود.

---

*Evidence: تمام file:line ارجاع‌ها از repo فعلی (پس از sync اخیر `index.html` با `landing.html` و `HeroSection.js` centered overlay) استخراج شده‌اند.*
