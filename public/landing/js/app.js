/* ═══════════════════════════════════════════════════
   ValuVault AI — Scroll-Driven Experience
   Lenis + GSAP ScrollTrigger + Canvas Frame Renderer
   ═══════════════════════════════════════════════════ */

'use strict';

/* ── Config ── */
const FRAME_COUNT  = 192;
const FRAME_SPEED  = 2.0;   // 1.8–2.2: product animation completes ~55% through scroll
const FRAME_PATH   = 'frames/frame_%04d.webp';
const IMAGE_SCALE  = 0.86;  // padded cover: prevents product clipping into header

/* ── State ── */
const frames       = new Array(FRAME_COUNT);
let   currentFrame = 0;
let   bgColor      = '#070f24';
let   allLoaded    = false;

/* ── DOM ── */
const loader       = document.getElementById('loader');
const loaderBar    = document.getElementById('loader-bar');
const loaderPct    = document.getElementById('loader-percent');
const canvas       = document.getElementById('canvas');
const canvasWrap   = document.getElementById('canvas-wrap');
const ctx          = canvas.getContext('2d');
const scrollCont   = document.getElementById('scroll-container');
const heroSection  = document.getElementById('hero');
const darkOverlay  = document.getElementById('dark-overlay');
const marquee1     = document.getElementById('marquee-1');
const header       = document.getElementById('site-header');

/* ══════════════════════════════════════════
   1. Frame path helper
   ══════════════════════════════════════════ */
function frameSrc(n) {
  const s = String(n).padStart(4, '0');
  return FRAME_PATH.replace('%04d', s);
}

/* ══════════════════════════════════════════
   2. Canvas resize with devicePixelRatio
   ══════════════════════════════════════════ */
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = window.innerWidth  * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width  = window.innerWidth  + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.scale(dpr, dpr);
  if (allLoaded || frames[currentFrame]) drawFrame(currentFrame);
}
window.addEventListener('resize', resizeCanvas);

/* ══════════════════════════════════════════
   3. Sample background color from frame edges
   ══════════════════════════════════════════ */
function sampleBgColor(img) {
  const offscreen = document.createElement('canvas');
  offscreen.width  = 8;
  offscreen.height = 8;
  const oc = offscreen.getContext('2d');
  oc.drawImage(img, 0, 0, 8, 8);
  const d = oc.getImageData(0, 0, 1, 1).data;
  bgColor = `rgb(${d[0]},${d[1]},${d[2]})`;
}

/* ══════════════════════════════════════════
   4. Draw a single frame — padded cover mode
   ══════════════════════════════════════════ */
function drawFrame(index) {
  const img = frames[index];
  if (!img) return;
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const scale = Math.max(cw / iw, ch / ih) * IMAGE_SCALE;
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, dx, dy, dw, dh);
}

/* ══════════════════════════════════════════
   5. Two-phase preloader
   ══════════════════════════════════════════ */
function loadFrames() {
  return new Promise((resolve) => {
    let loaded = 0;

    const onLoad = (img, i) => {
      frames[i] = img;
      loaded++;
      // Sample bg color every 20 frames
      if (i % 20 === 0) sampleBgColor(img);
      const pct = Math.round((loaded / FRAME_COUNT) * 100);
      loaderBar.style.width = pct + '%';
      loaderPct.textContent  = pct + '%';
      if (loaded === FRAME_COUNT) {
        allLoaded = true;
        resolve();
      }
    };

    // Phase 1: first 12 frames immediately (fast first paint)
    const PHASE1 = Math.min(12, FRAME_COUNT);
    for (let i = 1; i <= PHASE1; i++) {
      const img = new Image();
      img.onload = () => onLoad(img, i - 1);
      img.src = frameSrc(i);
    }

    // Phase 2: remaining frames after short delay
    setTimeout(() => {
      for (let i = PHASE1 + 1; i <= FRAME_COUNT; i++) {
        const img = new Image();
        img.onload = () => onLoad(img, i - 1);
        img.src = frameSrc(i);
      }
    }, 80);
  });
}

/* ══════════════════════════════════════════
   6. Init — wait for frames then boot
   ══════════════════════════════════════════ */
async function init() {
  resizeCanvas();
  await loadFrames();

  // Draw first frame behind loader
  drawFrame(0);

  // Fade out loader
  setTimeout(() => {
    loader.classList.add('hidden');
    bootAnimations();
  }, 400);
}

/* ══════════════════════════════════════════
   7. Lenis smooth scroll
   ══════════════════════════════════════════ */
function bootAnimations() {
  const lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
  });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  // Header scroll state
  lenis.on('scroll', ({ scroll }) => {
    if (scroll > 60) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });

  /* ── 7a. Hero word-split entrance ── */
  const heroWords  = document.querySelectorAll('.hero-heading .word');
  const heroLabel  = document.querySelector('.hero-label');
  const heroTagline = document.querySelector('.hero-tagline');
  const heroCtas   = document.querySelector('.hero-ctas');
  const scrollHint = document.querySelector('.hero-scroll-hint');

  const heroTl = gsap.timeline({ defaults: { ease: 'power4.out' } });
  heroTl
    .to(heroLabel,   { opacity: 1, y: 0, duration: 0.7 }, 0.1)
    .to(heroWords,   { opacity: 1, y: 0, duration: 0.9, stagger: 0.07 }, 0.2)
    .to(heroTagline, { opacity: 1, y: 0, duration: 0.8 }, 0.6)
    .to(heroCtas,    { opacity: 1, y: 0, duration: 0.7 }, 0.75)
    .to(scrollHint,  { opacity: 1, duration: 0.6 }, 1.1);

  /* ── 7b. Circle-wipe canvas reveal + hero fade ── */
  ScrollTrigger.create({
    trigger: scrollCont,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      const p = self.progress;

      // Hero fades as scroll begins
      heroSection.style.opacity = Math.max(0, 1 - p * 14);
      heroSection.style.pointerEvents = p > 0.08 ? 'none' : 'auto';

      // Canvas reveals via expanding circle
      const wipeP  = Math.min(1, Math.max(0, (p - 0.01) / 0.07));
      const radius = wipeP * 80;
      canvasWrap.style.clipPath = `circle(${radius}% at 50% 50%)`;
    },
  });

  /* ── 7c. Frame-to-scroll binding ── */
  ScrollTrigger.create({
    trigger: scrollCont,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      const accelerated = Math.min(self.progress * FRAME_SPEED, 1);
      const index = Math.min(
        Math.floor(accelerated * FRAME_COUNT),
        FRAME_COUNT - 1,
      );
      if (index !== currentFrame) {
        currentFrame = index;
        requestAnimationFrame(() => drawFrame(currentFrame));
      }
    },
  });

  /* ── 7d. Dark overlay for stats ── */
  const OVERLAY_ENTER = 0.58;
  const OVERLAY_LEAVE = 0.82;
  const FADE_RANGE    = 0.04;

  ScrollTrigger.create({
    trigger: scrollCont,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      const p = self.progress;
      let opacity = 0;
      if (p >= OVERLAY_ENTER - FADE_RANGE && p <= OVERLAY_ENTER) {
        opacity = (p - (OVERLAY_ENTER - FADE_RANGE)) / FADE_RANGE;
      } else if (p > OVERLAY_ENTER && p < OVERLAY_LEAVE) {
        opacity = 0.91;
      } else if (p >= OVERLAY_LEAVE && p <= OVERLAY_LEAVE + FADE_RANGE) {
        opacity = 0.91 * (1 - (p - OVERLAY_LEAVE) / FADE_RANGE);
      }
      darkOverlay.style.opacity = opacity;
    },
  });

  /* ── 7e. Marquee ── */
  const marqueeRange     = { enter: 0.16, leave: 0.96 };
  const marqueeText      = marquee1.querySelector('.marquee-text');
  const marqueeFadeRange = 0.05;

  gsap.to(marqueeText, {
    xPercent: -20,
    ease: 'none',
    scrollTrigger: {
      trigger: scrollCont,
      start: 'top top',
      end: 'bottom bottom',
      scrub: true,
    },
  });

  ScrollTrigger.create({
    trigger: scrollCont,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      const p = self.progress;
      let op = 0;
      if (p >= marqueeRange.enter && p < marqueeRange.enter + marqueeFadeRange) {
        op = (p - marqueeRange.enter) / marqueeFadeRange;
      } else if (p >= marqueeRange.enter + marqueeFadeRange && p < marqueeRange.leave - marqueeFadeRange) {
        op = 1;
      } else if (p >= marqueeRange.leave - marqueeFadeRange && p <= marqueeRange.leave) {
        op = 1 - (p - (marqueeRange.leave - marqueeFadeRange)) / marqueeFadeRange;
      }
      marquee1.style.opacity = op;
    },
  });

  /* ── 7f. Section animations ── */
  positionSections();
  document.querySelectorAll('.scroll-section').forEach(setupSection);

  /* ── 7g. Counter animations ── */
  document.querySelectorAll('.stat-number').forEach((el) => {
    const target   = parseFloat(el.dataset.value);
    const decimals = parseInt(el.dataset.decimals || '0');
    gsap.fromTo(
      el,
      { textContent: 0 },
      {
        textContent: target,
        duration: 2.2,
        ease: 'power1.out',
        snap: { textContent: decimals === 0 ? 1 : Math.pow(10, -decimals) },
        scrollTrigger: {
          trigger: el.closest('.scroll-section'),
          start: 'top 70%',
          toggleActions: 'play none none reverse',
          containerAnimation: null,
        },
        onUpdate() {
          const val = parseFloat(el.textContent);
          el.textContent = decimals > 0 ? val.toFixed(decimals) : Math.round(val);
        },
      },
    );
  });

  ScrollTrigger.refresh();
}

/* ══════════════════════════════════════════
   8. Position sections at midpoint of enter/leave
   ══════════════════════════════════════════ */
function positionSections() {
  const totalH = scrollCont.offsetHeight;
  document.querySelectorAll('.scroll-section').forEach((section) => {
    const enter  = parseFloat(section.dataset.enter) / 100;
    const leave  = parseFloat(section.dataset.leave) / 100;
    const midPos = ((enter + leave) / 2) * totalH;
    section.style.top       = midPos + 'px';
    section.style.transform = 'translateY(-50%)';
  });
}
window.addEventListener('resize', positionSections);

/* ══════════════════════════════════════════
   9. Per-section scroll animation setup
   ══════════════════════════════════════════ */
function setupSection(section) {
  const type    = section.dataset.animation;
  const persist = section.dataset.persist === 'true';
  const enter   = parseFloat(section.dataset.enter) / 100;
  const leave   = parseFloat(section.dataset.leave) / 100;

  // Children to animate (in stagger order)
  const children = [
    ...section.querySelectorAll('.section-label'),
    ...section.querySelectorAll('.section-heading'),
    ...section.querySelectorAll('.section-body'),
    ...section.querySelectorAll('.section-cta, .cta-buttons, .cta-trust'),
    ...section.querySelectorAll('.stat'),
  ];

  // Initial hidden state per animation type
  const initState = getInitState(type);
  gsap.set(children, initState);

  const timeline = buildTimeline(type, children);

  ScrollTrigger.create({
    trigger: scrollCont,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate(self) {
      const p = self.progress;

      if (p >= enter && p <= leave) {
        // Visible window
        section.classList.add('visible');

        // Progress within visible window (0→1)
        const range     = leave - enter;
        const innerP    = (p - enter) / range;
        const tlProgress = Math.min(innerP * 2.5, 1); // animate in during first 40% of window
        timeline.progress(tlProgress);
      } else if (persist && p > leave) {
        // Persist at end
        section.classList.add('visible');
        timeline.progress(1);
      } else {
        // Outside window — hide and reset
        section.classList.remove('visible');
        timeline.progress(0);
      }
    },
  });
}

function getInitState(type) {
  switch (type) {
    case 'slide-left':   return { x: -70, opacity: 0 };
    case 'slide-right':  return { x: 70,  opacity: 0 };
    case 'scale-up':     return { scale: 0.88, opacity: 0 };
    case 'rotate-in':    return { y: 40, rotation: 3, opacity: 0 };
    case 'stagger-up':   return { y: 55, opacity: 0 };
    case 'clip-reveal':  return { clipPath: 'inset(100% 0 0 0)', opacity: 0 };
    default:             return { y: 45, opacity: 0 }; // fade-up
  }
}

function buildTimeline(type, children) {
  const tl = gsap.timeline({ paused: true });
  switch (type) {
    case 'slide-left':
      tl.to(children, { x: 0, opacity: 1, stagger: 0.14, duration: 0.9, ease: 'power3.out' });
      break;
    case 'slide-right':
      tl.to(children, { x: 0, opacity: 1, stagger: 0.14, duration: 0.9, ease: 'power3.out' });
      break;
    case 'scale-up':
      tl.to(children, { scale: 1, opacity: 1, stagger: 0.12, duration: 1.0, ease: 'power2.out' });
      break;
    case 'rotate-in':
      tl.to(children, { y: 0, rotation: 0, opacity: 1, stagger: 0.1, duration: 0.9, ease: 'power3.out' });
      break;
    case 'stagger-up':
      tl.to(children, { y: 0, opacity: 1, stagger: 0.15, duration: 0.85, ease: 'power3.out' });
      break;
    case 'clip-reveal':
      tl.to(children, { clipPath: 'inset(0% 0 0 0)', opacity: 1, stagger: 0.15, duration: 1.2, ease: 'power4.inOut' });
      break;
    default: // fade-up
      tl.to(children, { y: 0, opacity: 1, stagger: 0.12, duration: 0.9, ease: 'power3.out' });
  }
  return tl;
}

/* ══════════════════════════════════════════
   10. Boot
   ══════════════════════════════════════════ */
init().catch(console.error);
