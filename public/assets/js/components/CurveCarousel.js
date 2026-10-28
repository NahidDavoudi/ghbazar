/**
 * CurveCarousel — 3D Depth-Blur Carousel (ported from Framer Depth Blur Carousel)
 * https://framer.com/m/Depth-Blur-Carousel-fvJ2lB.js@GXN6LrtdSMkVOzHCU8CD
 *
 * Features:
 * - Flat horizontal 3D stage (no vertical arc/curve drop) with perspective & Z-depth
 * - Real-time 60fps spring-physics swipe/drag animation (follows pointer & snaps with velocity)
 * - Dynamic depth-of-field Gaussian blur + brightness scaling based on distance from center
 * - Cinematic frosted-glass edge blur overlays on left and right edges
 * - Click side card to smoothly focus it, click center card to navigate
 */

const DEFAULTS = {
  perspective: 1200,
  mobilePerspective: 900,
  depthStep: 150,
  mobileDepthStep: 110,
  rotateYStep: 18,
  maxRotateY: 42,
  spacingRatio: 0.72,
  mobileSpacingRatio: 0.66,
  sizeDecrease: 0.12,
  blurStep: 4.5,
  maxBlur: 14,
  edgeBlur: true,
  bottomFade: false,
  autoplay: true,
  autoplayMs: 3800,
  pauseOnHover: true,
  arrowSize: 46,
  arrowInset: 24,
  arrowGap: 14,
  cardWidth: 310,
  cardHeight: 430,
  mobileCardWidth: 236,
  mobileCardHeight: 336,
  cardRadius: 20,
  stiffness: 170,
  damping: 24,
  mass: 1,
};

function mergeConfig(cfg = {}) {
  const merged = { ...DEFAULTS, ...cfg };
  // Ensure legacy curve configs don't override 3D depth-blur defaults unintentionally
  if (cfg.sizeDecrease != null && cfg.sizeDecrease < 0.08) {
    merged.sizeDecrease = DEFAULTS.sizeDecrease;
  }
  if (cfg.bottomFade === true && cfg.edgeBlur === undefined) {
    merged.bottomFade = false;
  }
  return merged;
}

function resolveSizing(cfg) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  return {
    ...cfg,
    perspective: isMobile ? (cfg.mobilePerspective ?? 900) : cfg.perspective,
    depthStep: isMobile ? (cfg.mobileDepthStep ?? 110) : cfg.depthStep,
    spacingRatio: isMobile ? (cfg.mobileSpacingRatio ?? 0.66) : cfg.spacingRatio,
    cardWidth: isMobile ? (cfg.mobileCardWidth ?? cfg.cardWidth) : cfg.cardWidth,
    cardHeight: isMobile ? (cfg.mobileCardHeight ?? cfg.cardHeight) : cfg.cardHeight,
  };
}

function computeHeight(resolved) {
  const { cardHeight, arrowSize, arrowInset } = resolved;
  return Math.round(cardHeight + arrowSize + arrowInset + 72);
}

function wrapDiff(diff, total) {
  if (total <= 0) return 0;
  let d = ((diff % total) + total) % total;
  if (d > total / 2) d -= total;
  return d;
}

const CurveCarousel = {
  render({ id = 'curve-carousel', background = 'transparent' } = {}) {
    return `
      <div class="curve-carousel depth-blur-carousel" data-curve-id="${id}" style="background:${background}">
        <div class="curve-carousel__wrap">
          <div class="curve-carousel__stage" role="region" aria-label="کاروسل سه‌بعدی محصولات">
            <div class="curve-carousel__edge-blur curve-carousel__edge-blur--left" aria-hidden="true"></div>
            <div class="curve-carousel__edge-blur curve-carousel__edge-blur--right" aria-hidden="true"></div>
            <div class="curve-carousel__track"></div>
          </div>
          <div class="curve-carousel__controls" dir="rtl">
            <div class="curve-carousel__arrows">
              <button type="button" class="curve-carousel__arrow" data-curve-prev aria-label="قبلی">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m9 18 6-6-6-6"/>
                </svg>
              </button>
              <div class="curve-carousel__dots" data-curve-dots></div>
              <button type="button" class="curve-carousel__arrow" data-curve-next aria-label="بعدی">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m15 18-6-6 6-6"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div class="curve-carousel__fade hidden" aria-hidden="true"></div>
      </div>`;
  },

  bind(root, { itemsHtml = [], config = {}, background = 'transparent' } = {}) {
    if (!root || !itemsHtml.length) return null;

    const cfg = mergeConfig(config);
    const total = itemsHtml.length;
    // Ensure enough virtual cards for seamless infinite 3D wrap-around
    const repeatMultiplier = total < 5 ? Math.ceil(7 / total) : 1;
    const renderCount = Math.max(total * repeatMultiplier, 7);
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let currentPos = 0; // continuous floating-point index
    let targetPos = 0;  // target index
    let velocity = 0;   // cards per second
    let rafId = null;
    let lastTime = 0;

    let isDragging = false;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let lastPointerX = 0;
    let lastPointerTime = 0;
    let pointerVelocityX = 0;
    let dragStartPos = 0;
    let draggedDistance = 0;
    let suppressClick = false;

    let paused = false;
    let inView = true;
    let intervalId = null;
    let wheelCooldown = 0;

    const stage = root.querySelector('.curve-carousel__stage');
    const track = root.querySelector('.curve-carousel__track');
    const prevBtn = root.querySelector('[data-curve-prev]');
    const nextBtn = root.querySelector('[data-curve-next]');
    const dotsWrap = root.querySelector('[data-curve-dots]');
    const fadeEl = root.querySelector('.curve-carousel__fade');
    const edgeBlurs = root.querySelectorAll('.curve-carousel__edge-blur');

    root.style.background = background;
    if (fadeEl) fadeEl.style.background = background;
    fadeEl?.classList.toggle('hidden', !cfg.bottomFade);
    edgeBlurs.forEach((el) => el.classList.toggle('hidden', !cfg.edgeBlur));

    // Build pagination dots
    if (dotsWrap) {
      if (total > 1 && total <= 12) {
        dotsWrap.innerHTML = Array.from({ length: total })
          .map((_, i) => `<button type="button" class="curve-carousel__dot" data-curve-dot="${i}" aria-label="اسلاید ${i + 1}"></button>`)
          .join('');
        dotsWrap.querySelectorAll('[data-curve-dot]').forEach((dot) => {
          dot.addEventListener('click', () => {
            const targetIdx = Number(dot.dataset.curveDot);
            const currentMod = ((Math.round(targetPos) % total) + total) % total;
            const delta = wrapDiff(targetIdx - currentMod, total);
            goTo(Math.round(targetPos) + delta);
          });
        });
      } else {
        dotsWrap.innerHTML = '';
      }
    }

    // Build card DOM nodes once
    track.innerHTML = '';
    const cardEls = [];
    for (let j = 0; j < renderCount; j += 1) {
      const idx = j % total;
      const card = document.createElement('div');
      card.className = 'curve-carousel__card';
      card.dataset.virtualIdx = String(j);
      card.dataset.itemIdx = String(idx);
      card.innerHTML = `<div class="curve-carousel__card-inner">${itemsHtml[idx]}</div>`;
      track.appendChild(card);
      cardEls.push(card);
    }

    function applySizingVars() {
      const resolved = resolveSizing(cfg);
      const height = computeHeight(resolved);

      root.style.setProperty('--curve-card-w', `${resolved.cardWidth}px`);
      root.style.setProperty('--curve-card-h', `${resolved.cardHeight}px`);
      root.style.setProperty('--curve-card-radius', `${resolved.cardRadius}px`);
      root.style.setProperty('--curve-arrow-size', `${resolved.arrowSize}px`);
      root.style.setProperty('--curve-arrow-inset', `${resolved.arrowInset}px`);
      root.style.setProperty('--curve-arrow-gap', `${resolved.arrowGap}px`);
      root.style.setProperty('--curve-perspective', `${resolved.perspective}px`);
      root.style.height = `${height}px`;

      const wrap = root.querySelector('.curve-carousel__wrap');
      if (wrap) wrap.style.height = `${height}px`;
      if (stage) stage.style.height = `${height - resolved.arrowSize - resolved.arrowInset}px`;
      return resolved;
    }

    let resolvedCfg = applySizingVars();

    function updateDots() {
      if (!dotsWrap || total <= 1) return;
      const activeMod = ((Math.round(currentPos) % total) + total) % total;
      dotsWrap.querySelectorAll('[data-curve-dot]').forEach((dot, i) => {
        dot.classList.toggle('is-active', i === activeMod);
      });
    }

    function renderFrame() {
      const {
        cardWidth,
        spacingRatio,
        depthStep,
        rotateYStep,
        maxRotateY,
        sizeDecrease,
        blurStep,
        maxBlur,
      } = resolvedCfg;

      const stepX = cardWidth * spacingRatio;

      for (let j = 0; j < renderCount; j += 1) {
        const card = cardEls[j];
        const diff = wrapDiff(j - currentPos, renderCount);
        const absDiff = Math.abs(diff);

        if (absDiff > 3.3) {
          card.style.opacity = '0';
          card.style.pointerEvents = 'none';
          card.style.visibility = 'hidden';
          card.setAttribute('aria-hidden', 'true');
          continue;
        }

        card.style.visibility = 'visible';

        // Slight non-linear horizontal compression for deeper cards (3D stack effect)
        const compression = 1 - Math.min(absDiff, 3) * 0.055;
        const translateX = diff * stepX * compression;

        // Z-axis depth recession (flat Y = 0, no vertical arc!)
        const translateZ = -Math.pow(absDiff, 0.92) * depthStep;

        // 3D Y-axis perspective rotation facing inward toward center
        const rawRotateY = -diff * rotateYStep;
        const rotateY = Math.max(-maxRotateY, Math.min(maxRotateY, rawRotateY));

        // Smooth scale hierarchy
        const scale = Math.max(0.62, 1 - absDiff * sizeDecrease);

        // Depth-of-field blur & brightness
        const blurPx = absDiff < 0.04
          ? 0
          : Math.min(maxBlur, Math.pow(absDiff, 1.15) * blurStep);
        const brightness = Math.max(0.45, 1.03 - absDiff * 0.19);
        const saturate = Math.max(0.75, 1.05 - absDiff * 0.08);

        // Smooth opacity falloff
        const opacity = absDiff <= 1.15
          ? 1
          : Math.max(0, 1 - (absDiff - 1.15) * 0.55);

        const zIndex = Math.round(100 - absDiff * 20);
        const isCenter = absDiff < 0.45;

        card.style.transform = `translate3d(calc(-50% + ${translateX.toFixed(2)}px), -50%, ${translateZ.toFixed(2)}px) rotateY(${rotateY.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
        card.style.zIndex = String(zIndex);
        card.style.opacity = opacity.toFixed(3);
        card.style.pointerEvents = absDiff < 2.2 ? 'auto' : 'none';
        card.classList.toggle('is-center', isCenter);
        card.setAttribute('aria-hidden', isCenter ? 'false' : 'true');

        const inner = card.firstElementChild;
        if (inner) {
          inner.style.filter = blurPx > 0.05
            ? `blur(${blurPx.toFixed(2)}px) brightness(${brightness.toFixed(2)}) saturate(${saturate.toFixed(2)})`
            : ` brightness(${brightness.toFixed(2)}) saturate(${saturate.toFixed(2)})`;
        }
      }

      updateDots();
    }

    function stepPhysics(now) {
      if (!lastTime) lastTime = now;
      const dt = Math.min(0.032, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      if (isDragging) {
        // Tight responsive follow while user is actively swiping/dragging
        const followFactor = 1 - Math.exp(-26 * dt);
        const prevPos = currentPos;
        currentPos += (targetPos - currentPos) * followFactor;
        velocity = (currentPos - prevPos) / dt;
        renderFrame();
        rafId = window.requestAnimationFrame(stepPhysics);
        return;
      }

      if (prefersReducedMotion) {
        currentPos = targetPos;
        velocity = 0;
        renderFrame();
        rafId = null;
        lastTime = 0;
        return;
      }

      // Damped harmonic spring (Framer Motion style)
      const displacement = currentPos - targetPos;
      const springForce = -cfg.stiffness * displacement;
      const dampingForce = -cfg.damping * velocity;
      const acceleration = (springForce + dampingForce) / cfg.mass;

      velocity += acceleration * dt;
      currentPos += velocity * dt;

      renderFrame();

      if (Math.abs(targetPos - currentPos) < 0.0015 && Math.abs(velocity) < 0.008) {
        currentPos = targetPos;
        velocity = 0;
        renderFrame();
        rafId = null;
        lastTime = 0;
      } else {
        rafId = window.requestAnimationFrame(stepPhysics);
      }
    }

    function startLoop() {
      if (rafId == null) {
        lastTime = performance.now();
        rafId = window.requestAnimationFrame(stepPhysics);
      }
    }

    function stopLoop() {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
        lastTime = 0;
      }
    }

    function clearAutoplay() {
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    }

    function startAutoplay() {
      if (prefersReducedMotion || !cfg.autoplay || !inView || total <= 1 || isDragging) return;
      clearAutoplay();
      intervalId = window.setInterval(() => {
        targetPos = Math.round(targetPos) + 1;
        startLoop();
      }, Math.max(1500, cfg.autoplayMs));
    }

    function resetAutoplay() {
      clearAutoplay();
      startAutoplay();
    }

    function goTo(newTarget) {
      if (total <= 1) return;
      targetPos = newTarget;
      startLoop();
      resetAutoplay();
    }

    function move(direction) {
      goTo(Math.round(targetPos) + direction);
    }

    // Pointer / Touch Drag Handlers with Live Swipe & Momentum
    const onPointerDown = (e) => {
      if (total <= 1) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('button')) return;

      isDragging = true;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      lastPointerX = e.clientX;
      lastPointerTime = performance.now();
      pointerVelocityX = 0;
      dragStartPos = currentPos;
      targetPos = currentPos;
      draggedDistance = 0;
      suppressClick = false;

      clearAutoplay();
      stage.classList.add('is-dragging');
      startLoop();
    };

    const onPointerMove = (e) => {
      if (!isDragging || e.pointerId !== pointerId) return;

      const now = performance.now();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      draggedDistance = Math.hypot(dx, dy);

      if (draggedDistance > 7) {
        suppressClick = true;
        if (!stage.hasPointerCapture?.(e.pointerId)) {
          stage.setPointerCapture?.(e.pointerId);
        }
      }

      const dtMs = Math.max(1, now - lastPointerTime);
      const instantVx = (e.clientX - lastPointerX) / dtMs; // px per ms
      pointerVelocityX = pointerVelocityX * 0.65 + instantVx * 0.35;
      lastPointerX = e.clientX;
      lastPointerTime = now;

      const dragSpan = Math.max(160, resolvedCfg.cardWidth * resolvedCfg.spacingRatio);
      targetPos = dragStartPos - dx / dragSpan;
      startLoop();
    };

    const endDrag = (e) => {
      if (!isDragging) return;
      if (e && pointerId != null && e.pointerId != null && e.pointerId !== pointerId) return;

      isDragging = false;
      pointerId = null;
      stage.classList.remove('is-dragging');

      const dragSpan = Math.max(160, resolvedCfg.cardWidth * resolvedCfg.spacingRatio);
      // Convert pointer velocity (px/ms) into card index velocity (cards/sec)
      const releaseCardVelocity = (-pointerVelocityX * 1000) / dragSpan;
      velocity = releaseCardVelocity;

      // Project momentum landing target
      const projected = targetPos + releaseCardVelocity * 0.16;
      const maxJump = Math.round(dragStartPos) + (releaseCardVelocity > 0 ? 2 : -2);
      let snapped = Math.round(projected);

      // If user made a quick flick even with short distance, advance by 1
      const totalDx = lastPointerX - startX;
      if (snapped === Math.round(dragStartPos) && Math.abs(pointerVelocityX) > 0.35 && Math.abs(totalDx) > 18) {
        snapped = Math.round(dragStartPos) + (totalDx < 0 ? 1 : -1);
      }

      if (Math.abs(snapped - Math.round(dragStartPos)) > 2) {
        snapped = maxJump;
      }

      targetPos = snapped;
      startLoop();
      resetAutoplay();
    };

    // Intercept clicks during/after swipe, or click on a side card to focus it
    const onStageClick = (e) => {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
        suppressClick = false;
        return;
      }

      const cardEl = e.target.closest('.curve-carousel__card');
      if (!cardEl) return;

      const vIdx = Number(cardEl.dataset.virtualIdx);
      if (Number.isNaN(vIdx)) return;

      const diff = wrapDiff(vIdx - currentPos, renderCount);
      if (Math.abs(diff) >= 0.45) {
        // Clicked a side card -> smoothly bring it to center instead of following link immediately
        e.preventDefault();
        e.stopPropagation();
        goTo(Math.round(currentPos + diff));
      }
    };

    const onDragStart = (e) => {
      e.preventDefault();
    };

    const onWheel = (e) => {
      if (total <= 1) return;
      const isHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
      if (!isHorizontal) return;

      const delta = e.deltaX || e.deltaY;
      if (Math.abs(delta) < 8) return;

      e.preventDefault();
      const now = performance.now();
      if (now - wheelCooldown < 260) return;
      wheelCooldown = now;

      move(delta > 0 ? 1 : -1);
    };

    const onResize = () => {
      resolvedCfg = applySizingVars();
      renderFrame();
    };

    const onVisibility = () => {
      paused = document.hidden;
      if (paused) clearAutoplay();
      else startAutoplay();
    };

    const onMouseEnter = () => {
      if (cfg.pauseOnHover) clearAutoplay();
    };

    const onMouseLeave = () => {
      if (cfg.pauseOnHover && !paused && !isDragging) startAutoplay();
    };

    prevBtn?.addEventListener('click', () => move(-1));
    nextBtn?.addEventListener('click', () => move(1));
    stage?.addEventListener('pointerdown', onPointerDown);
    stage?.addEventListener('pointermove', onPointerMove);
    stage?.addEventListener('pointerup', endDrag);
    stage?.addEventListener('pointercancel', endDrag);
    stage?.addEventListener('click', onStageClick, true);
    stage?.addEventListener('dragstart', onDragStart);
    stage?.addEventListener('wheel', onWheel, { passive: false });

    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    root.addEventListener('mouseenter', onMouseEnter);
    root.addEventListener('mouseleave', onMouseLeave);

    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(
        ([entry]) => {
          inView = entry.isIntersecting;
          if (inView) startAutoplay();
          else clearAutoplay();
        },
        { threshold: 0.2 }
      )
      : null;
    io?.observe(root);

    if (prevBtn) prevBtn.disabled = total <= 1;
    if (nextBtn) nextBtn.disabled = total <= 1;

    renderFrame();
    startAutoplay();

    const state = {
      io,
      onResize,
      onVisibility,
      onMouseEnter,
      onMouseLeave,
      onPointerDown,
      onPointerMove,
      endDrag,
      onStageClick,
      onDragStart,
      onWheel,
      clearAutoplay,
      stopLoop,
    };
    root._curveState = state;
    return state;
  },

  destroy(root) {
    const state = root?._curveState;
    if (!state) return;

    state.clearAutoplay?.();
    state.stopLoop?.();
    state.io?.disconnect();
    window.removeEventListener('resize', state.onResize);
    document.removeEventListener('visibilitychange', state.onVisibility);
    root.removeEventListener('mouseenter', state.onMouseEnter);
    root.removeEventListener('mouseleave', state.onMouseLeave);

    const stage = root.querySelector('.curve-carousel__stage');
    stage?.removeEventListener('pointerdown', state.onPointerDown);
    stage?.removeEventListener('pointermove', state.onPointerMove);
    stage?.removeEventListener('pointerup', state.endDrag);
    stage?.removeEventListener('pointercancel', state.endDrag);
    stage?.removeEventListener('click', state.onStageClick, true);
    stage?.removeEventListener('dragstart', state.onDragStart);
    stage?.removeEventListener('wheel', state.onWheel);

    root._curveState = null;
  },
};

export default CurveCarousel;