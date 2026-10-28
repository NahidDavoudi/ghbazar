/**
 * pages/payment.js — صفحه پرداخت (آنلاین یا ارسال رسید کارت به کارت)
 *
 *Quando `PAYMENT_GATEWAY=card_to_card` است، به جای ریدایرکت به درگاه،
 * شماره کارت و فرم آپلود رسید نشان داده می‌شود.
 */
import api from '../core/api.js';
import Router from '../core/router.js';
import DOM from '../utils/dom.js';
import { escapeHtml } from '../utils/htmlEscape.js';

const { show, hide, text } = DOM;

let _orderData = null;
let _receiptRequired = false;
let _cardInfo = null;
let _amount = null;

function ensureElement(id, tag = 'div')
{
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement(tag);
    el.id = id;
    const container = document.querySelector('.payment-container') || document.querySelector('main') || document.body;
    container.appendChild(el);
  }
  return el;
}

function toast(msg, type = 'error')
{
  if (api.utils && api.utils.toast) {
    api.utils.toast(msg, type);
  } else {
    alert(msg); // fallback برای پروژه‌هایی که api.utils.toast ندارند
  }
}

Router.onEnter('payment', function ()
{
  console.log('🟢 [payment] وارد شدیم');

  const errEl = document.getElementById('payment-error');
  if (errEl) hide(errEl);

  let stored;
  try {
    stored = JSON.parse(sessionStorage.getItem('gb_checkout') || '{}');
    console.log('📦 [payment] داده sessionStorage:', stored);
  } catch (e) {
    console.error('❌ [payment] خطا در parse sessionStorage:', e);
    hide('payment-summary');
    hide('payment-action');
    const errEl = document.getElementById('payment-error') || ensureElement('payment-error', 'div');
    errEl.textContent = 'خطا: اطلاعات سفارش معتبر نیست. لطفاً مجدداً ثبت سفارش کنید.';
    errEl.className = 'text-accent text-sm mt-4 text-center';
    show(errEl);
    return;
  }

  try {
    if (stored.order) {
      _orderData = stored.order;
    } else {
      _orderData = stored;
    }

    _receiptRequired = !!stored.receipt_required;
    _cardInfo = stored.card ?? null;
    _amount = stored.amount ?? (stored.order?.total_amount ?? null);

    console.log('📋 [payment] _orderData:', _orderData);
    console.log('🧾 [payment] receipt_required:', _receiptRequired);

    if (!_orderData || !_orderData.id) {
      throw new Error('اطلاعات سفارش یافت نشد');
    }
  } catch (e) {
    console.error('❌ [payment] خطا در پردازش داده:', e);
    hide('payment-summary');
    hide('payment-action');
    const errEl = document.getElementById('payment-error') || ensureElement('payment-error', 'div');
    errEl.textContent = 'خطا: اطلاعات سفارش معتبر نیست. لطفاً مجدداً ثبت سفارش کنید.';
    errEl.className = 'text-accent text-sm mt-4 text-center';
    show(errEl);
    return;
  }

  // --- پر کردن اطلاعات سفارش ---
  try {
    const orderNumberEl = document.getElementById('payment-order-number');
    if (orderNumberEl) {
      text(orderNumberEl.id, _orderData.order_number || '-');
    }

    const totalEl = document.getElementById('payment-total-amount');
    if (totalEl) {
      const formatted = _amount ? api.utils.formatPrice(_amount) : '—';
      text(totalEl.id, formatted);
    }

    const nameEl = document.getElementById('payment-customer-name');
    if (nameEl) {
      text(nameEl.id, _orderData.customer_name || '-');
    }

    const addressEl = document.getElementById('payment-shipping-address');
    if (addressEl) {
      text(addressEl.id, _orderData.shipping_address || '-');
    }
  } catch (e) {
    console.error('❌ [payment] خطا در پر کردن اطلاعات:', e);
  }

  // --- نمایش بخش‌های اصلی ---
  setTimeout(() => {
    show('payment-summary');
    show('payment-action');
    const summary = document.getElementById('payment-summary');
    const action = document.getElementById('payment-action');
    if (summary) summary.style.display = '';
    if (action) action.style.display = '';
  }, 100);

  // --- مدیریت دکمه‌ها ---
  try {
    const btnContainer = document.getElementById('payment-btn-container') || ensureElement('payment-btn-container', 'div');

    // دکمه قبلی (پرداخت آنلاین) اگر وجود دارد را پاک می‌کنیم
    const oldBtn = document.getElementById('pay-online-btn');
    if (oldBtn) oldBtn.remove();

    const msgEl = document.getElementById('payment-online-unavailable') || ensureElement('payment-online-unavailable', 'div');
    msgEl.className = 'hidden text-sm text-muted text-center';

    // حالت ۱: لینک درگاه وجود دارد → پرداخت آنلاین BitPay ( سلuele قبلی )
    const _paymentUrl = stored.payment_url ?? stored.order?.payment_url ?? null;
    if (_paymentUrl && !_receiptRequired) {
      const btn = document.createElement('button');
      btn.id = 'pay-online-btn';
      btn.className = 'w-full py-3 bg-accent text-white font-bold rounded-xl hover:bg-accent-hover transition-all disabled:opacity-60 disabled:cursor-not-allowed';
      btn.disabled = false;
      btn.textContent = 'پرداخت آنلاین';
      btnContainer.appendChild(btn);
      hide(msgEl);
      console.log('✅ دکمه پرداخت آنلاین فعال');
      return;
    }

    // حالت ۲: پرداخت در محل (بدون درگاه و بدون رسید)
    if (!_receiptRequired) {
      const btn = document.createElement('button');
      btn.id = 'pay-online-btn';
      btn.className = 'w-full py-3 bg-surface text-body font-bold rounded-xl border border-border disabled:opacity-60 disabled:cursor-not-allowed';
      btn.disabled = true;
      btn.textContent = 'پرداخت در محل';
      btnContainer.appendChild(btn);

      msgEl.textContent = 'روش پرداخت شما نیازی به پرداخت آنلاین ندارد. سفارش ثبت شده است.';
      show(msgEl);
      console.log('ℹ️ دکمه غیرفعال (پرداخت در محل)');
      return;
    }

    // =====================================================================
    // حالت ۳: ارسال رسید کارت به کارت (بدون درگاه پرداخت)
    // =====================================================================
    const panel = document.getElementById('card-to-card-panel') || ensureElement('card-to-card-panel', 'div');
    panel.className = 'rounded-xl border border-border bg-blue-50 p-5 text-right space-y-4';
    panel.innerHTML = `
      <p class="text-sm font-bold text-body">نحوه پرداخت</p>

      <div class="rounded-lg border border-border bg-body p-3 space-y-2 dir-ltr">
        <p class="text-xs text-muted">شماره کارت</p>
        <p class="text-sm font-mono text-body font-bold" dir="ltr">${escapeHtml(_cardInfo?.number ?? '—')}</p>

        <p class="text-xs text-muted">صاحب کارت</p>
        <p class="text-sm text-body">${escapeHtml(_cardInfo?.holder ?? '—')}</p>

        ${_cardInfo?.shaba
          ? `<p class="text-xs text-muted">شماره شبا</p><p class="text-sm font-mono text-body" dir="ltr">${escapeHtml(_cardInfo.shaba)}</p>`
          : ''
        }

        <p class="text-xs text-muted">مبلغ قابل پرداخت</p>
        <p class="text-sm font-bold text-body">${_amount ? api.utils.formatPrice(_amount) : '—'} تومان</p>
      </div>

      <p class="text-xs text-muted">پس از واریز، تصویر رسید را آپلود کنید.</p>

      <label class="block text-xs font-medium text-muted mb-1">فایل رسید (JPG, PNG, PDF)</label>
      <input type="file" id="receipt-file" class="block w-full text-sm text-body border border-border rounded-lg px-3 py-2" accept="image/*,.pdf">

      <button id="upload-receipt-btn" class="w-full py-3 bg-accent text-white font-bold rounded-xl hover:bg-accent-hover transition-all disabled:opacity-60 disabled:cursor-not-allowed">
        ارسال رسید
      </button>

      <p id="receipt-hint" class="text-xs text-center text-green-700 bg-green-50 rounded-lg px-3 py-2 hidden">
        رسید شما با موفقیت ارسال شد و پس از تایید مدیریت، وضعیت سفارش به‌روزرسانی می‌شود.
      </p>
    `;
    show(panel);

    const inputEl = document.getElementById('receipt-file');
    const btnEl = document.getElementById('upload-receipt-btn');
    const hintEl = document.getElementById('receipt-hint');

    inputEl?.addEventListener('change', () => {
      btnEl.disabled = !inputEl?.files?.length;
    });

    btnEl?.addEventListener('click', async () => {
      const file = inputEl?.files?.[0];
      if (!file) {
        toast('لطفاً فایل رسید را انتخاب کنید', 'warning');
        return;
      }

      btnEl.disabled = true;
      btnEl.textContent = 'در حال ارسال...';
      hintEl.classList.add('hidden');

      const formData = new FormData();
      formData.append('order_id', String(_orderData.id));
      formData.append('receipt', file);

      // NOTE: اگر پروژه شما از cls api.request استفاده می‌کند، این fetch را به آن جایگزین کنید
      // و هدر Authorization (توکن ورود) را اضافه کنید.
      try {
        const res = await fetch('/payment/receipt', {
          method: 'POST',
          body: formData,
          // headers: { 'Authorization': `Bearer ${token}` },
        });

        const json = await res.json();

        if (!json.success || !json.ok) {
          throw new Error(json.error || json.message || 'خطا در آپلود رسید');
        }

        hide(panel);
        hintEl.classList.remove('hidden');
        show(hintEl);

        // بعد از ۳ ثانیه به صفحه سفارشات می‌رود (اختیاری)
        setTimeout(() => {
          Router.go('/orders');
        }, 3000);
      } catch (e) {
        console.error('❌ [payment] آپلود رسید شکست خورد:', e);
        toast(e.message, 'error');
        btnEl.disabled = false;
        btnEl.textContent = 'ارسال رسید';
      }
    });

    const errEl2 = document.getElementById('payment-error');
    if (errEl2) hide(errEl2);
  } catch (e) {
    console.error('❌ [payment] خطا در مدیریت دکمه:', e);
  }
});

// رویداد کلیک دکمه پرداخت آنلاین (فقط برای حالت BitPay)
document.addEventListener('click', function (e)
{
  const btn = e.target.closest('#pay-online-btn');
  if (!btn) return;
  e.preventDefault();

  const storedRaw = sessionStorage.getItem('gb_checkout');
  if (!storedRaw) {
    api.utils?.toast?.('آدرس پرداخت در دسترس نیست.', 'error');
    return;
  }

  let stored;
  try { stored = JSON.parse(storedRaw); } catch { api.utils?.toast?.('آدرس پرداخت در دسترس نیست.', 'error'); return; }

  const _paymentUrl = stored.payment_url ?? stored.order?.payment_url ?? null;
  if (!_paymentUrl) {
    api.utils?.toast?.('آدرس پرداخت در دسترس نیست.', 'error');
    return;
  }

  window.location.href = _paymentUrl;
});
