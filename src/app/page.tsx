'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

/* ─────────────────────────────────────────
   Frame config
───────────────────────────────────────── */
const FRAME_COUNT = 192
const FRAME_SPEED = 2.0
const IMAGE_SCALE = 0.86

function frameSrc(n: number) {
  return `/landing/frames/frame_${String(n).padStart(4, '0')}.webp`
}

export default function LandingPage() {
  /* refs ─ all DOM nodes the effect needs */
  const loaderRef       = useRef<HTMLDivElement>(null)
  const [plansOpen, setPlansOpen] = useState(false)
  const loaderBarRef    = useRef<HTMLDivElement>(null)
  const loaderPctRef    = useRef<HTMLSpanElement>(null)
  const headerRef       = useRef<HTMLElement>(null)
  const heroRef         = useRef<HTMLElement>(null)
  const canvasWrapRef   = useRef<HTMLDivElement>(null)
  const canvasRef       = useRef<HTMLCanvasElement>(null)
  const overlayRef      = useRef<HTMLDivElement>(null)
  const marqueeRef      = useRef<HTMLDivElement>(null)
  const marqueeTextRef  = useRef<HTMLDivElement>(null)
  const scrollContRef   = useRef<HTMLDivElement>(null)

  useEffect(() => {
    /* import browser-only libs dynamically */
    let lenis: import('lenis').default | null = null
    let ST: { getAll: () => { kill: () => void }[] } | null = null
    let killed = false

    ;(async () => {
      const { gsap }          = await import('gsap')
      const { ScrollTrigger } = await import('gsap/ScrollTrigger')
      ST = ScrollTrigger
      const LenisModule        = await import('lenis')
      const LenisClass         = LenisModule.default ?? (LenisModule as unknown as { default: typeof import('lenis').default }).default

      if (killed) return
      gsap.registerPlugin(ScrollTrigger)

      const loader       = loaderRef.current!
      const loaderBar    = loaderBarRef.current!
      const loaderPct    = loaderPctRef.current!
      const header       = headerRef.current!
      const hero         = heroRef.current!
      const canvasWrap   = canvasWrapRef.current!
      const canvas       = canvasRef.current!
      const overlay      = overlayRef.current!
      const marqueeEl    = marqueeRef.current!
      const marqueeText  = marqueeTextRef.current!
      const scrollCont   = scrollContRef.current!
      const ctx          = canvas.getContext('2d')!

      /* ── frames store ── */
      const frames: HTMLImageElement[] = new Array(FRAME_COUNT)
      let   currentFrame = 0
      let   bgColor      = '#070f24'

      /* ── canvas setup ── */
      function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1
        const w   = window.innerWidth
        const h   = window.innerHeight
        canvas.width  = w * dpr
        canvas.height = h * dpr
        canvas.style.width  = w + 'px'
        canvas.style.height = h + 'px'
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        if (frames[currentFrame]) drawFrame(currentFrame)
      }

      function sampleBgColor(img: HTMLImageElement) {
        try {
          const off = document.createElement('canvas')
          off.width = 4; off.height = 4
          const oc  = off.getContext('2d')!
          oc.drawImage(img, 0, 0, 4, 4)
          const d   = oc.getImageData(0, 0, 1, 1).data
          bgColor   = `rgb(${d[0]},${d[1]},${d[2]})`
        } catch { /* cross-origin guard */ }
      }

      function drawFrame(index: number) {
        const img = frames[index]
        if (!img?.complete) return
        const cw  = window.innerWidth
        const ch  = window.innerHeight
        const iw  = img.naturalWidth  || 1280
        const ih  = img.naturalHeight || 720
        const sc  = Math.max(cw / iw, ch / ih) * IMAGE_SCALE
        const dw  = iw * sc,  dh = ih * sc
        const dx  = (cw - dw) / 2, dy = (ch - dh) / 2
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, cw, ch)
        ctx.drawImage(img, dx, dy, dw, dh)
      }

      resizeCanvas()
      const onResize = () => resizeCanvas()
      window.addEventListener('resize', onResize)

      /* ── two-phase loader ── */
      async function loadFrames() {
        return new Promise<void>((resolve) => {
          let loaded = 0
          const tick = (img: HTMLImageElement, i: number) => {
            frames[i] = img
            loaded++
            if (i % 20 === 0) sampleBgColor(img)
            const pct = Math.round((loaded / FRAME_COUNT) * 100)
            loaderBar.style.width  = pct + '%'
            loaderPct.textContent  = pct + '%'
            if (loaded === FRAME_COUNT) resolve()
          }

          const PHASE1 = Math.min(12, FRAME_COUNT)
          for (let i = 1; i <= PHASE1; i++) {
            const img = new Image()
            const idx = i - 1
            img.onload = () => tick(img, idx)
            img.onerror = () => { loaded++; if (loaded === FRAME_COUNT) resolve() }
            img.src = frameSrc(i)
          }
          setTimeout(() => {
            for (let i = PHASE1 + 1; i <= FRAME_COUNT; i++) {
              const img = new Image()
              const idx = i - 1
              img.onload = () => tick(img, idx)
              img.onerror = () => { loaded++; if (loaded === FRAME_COUNT) resolve() }
              img.src = frameSrc(i)
            }
          }, 80)
        })
      }

      await loadFrames()
      drawFrame(0)

      /* ── hide loader ── */
      await new Promise<void>((r) => setTimeout(r, 350))
      loader.style.opacity    = '0'
      loader.style.visibility = 'hidden'

      /* ── Lenis smooth scroll ── */
      lenis = new LenisClass({
        duration: 1.2,
        easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      })
      lenis.on('scroll', ScrollTrigger.update)
      gsap.ticker.add((time: number) => lenis!.raf(time * 1000))
      gsap.ticker.lagSmoothing(0)

      lenis.on('scroll', ({ scroll }: { scroll: number }) => {
        if (scroll > 60) header.classList.add('scrolled')
        else             header.classList.remove('scrolled')
      })

      /* ── hero word entrance ── */
      const words    = hero.querySelectorAll<HTMLElement>('.word')
      const heroLabel = hero.querySelector<HTMLElement>('.hero-label')
      const heroTag   = hero.querySelector<HTMLElement>('.hero-tagline')
      const heroCtas  = hero.querySelector<HTMLElement>('.hero-ctas')
      const scrollHint = hero.querySelector<HTMLElement>('.hero-scroll-hint')

      gsap.timeline({ defaults: { ease: 'power4.out' } })
        .to(heroLabel,  { opacity: 1, y: 0, duration: 0.7 }, 0.1)
        .to(words,      { opacity: 1, y: 0, duration: 0.9, stagger: 0.07 }, 0.2)
        .to(heroTag,    { opacity: 1, y: 0, duration: 0.8 }, 0.65)
        .to(heroCtas,   { opacity: 1, y: 0, duration: 0.7 }, 0.8)
        .to(scrollHint, { opacity: 1, duration: 0.6 }, 1.1)

      /* ── scroll-based helpers ── */
      function scrollProgress(self: { progress: number }) {
        return self.progress
      }

      const ST_BASE = {
        trigger: scrollCont,
        start: 'top top',
        end: 'bottom bottom',
        scrub: true,
      }

      /* ── circle-wipe + hero fade ── */
      ScrollTrigger.create({
        ...ST_BASE,
        onUpdate(self) {
          const p = self.progress
          hero.style.opacity = String(Math.max(0, 1 - p * 14))
          if (p > 0.08) hero.style.pointerEvents = 'none'
          else          hero.style.pointerEvents = ''
          const wp = Math.min(1, Math.max(0, (p - 0.01) / 0.07))
          canvasWrap.style.clipPath = `circle(${wp * 80}% at 50% 50%)`
        },
      })

      /* ── frame scrub ── */
      ScrollTrigger.create({
        ...ST_BASE,
        onUpdate(self) {
          const acc   = Math.min(self.progress * FRAME_SPEED, 1)
          const index = Math.min(Math.floor(acc * FRAME_COUNT), FRAME_COUNT - 1)
          if (index !== currentFrame) {
            currentFrame = index
            requestAnimationFrame(() => drawFrame(currentFrame))
          }
        },
      })

      /* ── dark overlay ── */
      const OVR_IN = 0.58, OVR_OUT = 0.82, OFR = 0.04
      ScrollTrigger.create({
        ...ST_BASE,
        onUpdate(self) {
          const p = self.progress
          let op = 0
          if (p >= OVR_IN - OFR && p <= OVR_IN)          op = (p - (OVR_IN - OFR)) / OFR
          else if (p > OVR_IN && p < OVR_OUT)             op = 0.91
          else if (p >= OVR_OUT && p <= OVR_OUT + OFR)    op = 0.91 * (1 - (p - OVR_OUT) / OFR)
          overlay.style.opacity = String(op)
        },
      })

      /* ── marquee ── */
      const MQ_ENTER = 0.16, MQ_LEAVE = 0.96, MFR = 0.05
      gsap.to(marqueeText, {
        xPercent: -20,
        ease: 'none',
        scrollTrigger: { ...ST_BASE },
      })
      ScrollTrigger.create({
        ...ST_BASE,
        onUpdate(self) {
          const p = self.progress
          let op = 0
          if      (p >= MQ_ENTER && p < MQ_ENTER + MFR)        op = (p - MQ_ENTER) / MFR
          else if (p >= MQ_ENTER + MFR && p < MQ_LEAVE - MFR)  op = 1
          else if (p >= MQ_LEAVE - MFR && p <= MQ_LEAVE)        op = 1 - (p - (MQ_LEAVE - MFR)) / MFR
          marqueeEl.style.opacity = String(op)
        },
      })

      /* ── position sections ── */
      function positionSections() {
        const totalH = scrollCont.offsetHeight
        scrollCont.querySelectorAll<HTMLElement>('.scroll-section').forEach((sec) => {
          const enter  = parseFloat(sec.dataset.enter!) / 100
          const leave  = parseFloat(sec.dataset.leave!) / 100
          const mid    = ((enter + leave) / 2) * totalH
          sec.style.top       = mid + 'px'
          sec.style.transform = 'translateY(-50%)'
        })
      }
      positionSections()
      window.addEventListener('resize', positionSections)

      /* ── section animations ── */
      type AnimType = 'fade-up'|'slide-left'|'slide-right'|'scale-up'|'rotate-in'|'stagger-up'|'clip-reveal'

      function initStates(type: AnimType, els: Element[]) {
        const map: Record<AnimType, gsap.TweenVars> = {
          'fade-up':     { y: 45, opacity: 0 },
          'slide-left':  { x: -70, opacity: 0 },
          'slide-right': { x: 70, opacity: 0 },
          'scale-up':    { scale: 0.88, opacity: 0 },
          'rotate-in':   { y: 40, rotation: 3, opacity: 0 },
          'stagger-up':  { y: 55, opacity: 0 },
          'clip-reveal': { clipPath: 'inset(100% 0 0 0)', opacity: 0 },
        }
        gsap.set(els, map[type] ?? { y: 45, opacity: 0 })
      }

      function buildTl(type: AnimType, els: Element[]) {
        const tl = gsap.timeline({ paused: true })
        const base = { stagger: 0.13, duration: 0.9, ease: 'power3.out' }
        switch (type) {
          case 'slide-left':  tl.to(els, { x: 0,        opacity: 1, ...base }); break
          case 'slide-right': tl.to(els, { x: 0,        opacity: 1, ...base }); break
          case 'scale-up':    tl.to(els, { scale: 1,    opacity: 1, ...base, duration: 1.0, ease: 'power2.out' }); break
          case 'rotate-in':   tl.to(els, { y: 0, rotation: 0, opacity: 1, ...base }); break
          case 'stagger-up':  tl.to(els, { y: 0,        opacity: 1, ...base, duration: 0.85 }); break
          case 'clip-reveal': tl.to(els, { clipPath: 'inset(0% 0 0 0)', opacity: 1, ...base, duration: 1.2, ease: 'power4.inOut' }); break
          default:            tl.to(els, { y: 0,        opacity: 1, ...base })
        }
        return tl
      }

      scrollCont.querySelectorAll<HTMLElement>('.scroll-section').forEach((sec) => {
        const type    = (sec.dataset.animation ?? 'fade-up') as AnimType
        const persist = sec.dataset.persist === 'true'
        const enter   = parseFloat(sec.dataset.enter!) / 100
        const leave   = parseFloat(sec.dataset.leave!) / 100
        const kids    = [
          ...Array.from(sec.querySelectorAll('.section-label')),
          ...Array.from(sec.querySelectorAll('.section-heading')),
          ...Array.from(sec.querySelectorAll('.section-body')),
          ...Array.from(sec.querySelectorAll('.section-cta')),
          ...Array.from(sec.querySelectorAll('.cta-buttons')),
          ...Array.from(sec.querySelectorAll('.cta-trust')),
          ...Array.from(sec.querySelectorAll('.stat')),
        ]
        if (!kids.length) return
        initStates(type, kids)
        const tl = buildTl(type, kids)

        ScrollTrigger.create({
          ...ST_BASE,
          onUpdate(self) {
            const p = self.progress
            if (p >= enter && p <= leave) {
              sec.style.opacity       = '1'
              sec.style.pointerEvents = 'auto'
              const inner = Math.min((p - enter) / (leave - enter) * 2.5, 1)
              tl.progress(inner)
            } else if (persist && p > leave) {
              sec.style.opacity = '1'
              tl.progress(1)
            } else {
              sec.style.opacity       = '0'
              sec.style.pointerEvents = 'none'
              tl.progress(0)
            }
          },
        })
      })

      /* ── counters ── */
      scrollCont.querySelectorAll<HTMLElement>('.stat-number').forEach((el) => {
        const target   = parseFloat(el.dataset.value ?? '0')
        const decimals = parseInt(el.dataset.decimals ?? '0')
        gsap.fromTo(el,
          { textContent: 0 },
          {
            textContent: target,
            duration: 2.2,
            ease: 'power1.out',
            snap: { textContent: decimals === 0 ? 1 : Math.pow(10, -decimals) },
            scrollTrigger: {
              trigger: el.closest<HTMLElement>('.scroll-section'),
              start: 'top 70%',
              toggleActions: 'play none none reverse',
            },
            onUpdate() {
              const v = parseFloat(el.textContent ?? '0')
              el.textContent = decimals > 0 ? v.toFixed(decimals) : String(Math.round(v))
            },
          },
        )
      })

      ScrollTrigger.refresh()

      return () => {
        /* cleanup on unmount */
        window.removeEventListener('resize', onResize)
        window.removeEventListener('resize', positionSections)
      }
    })()

    return () => { killed = true; lenis?.destroy(); ST?.getAll().forEach(t => t.kill()) }
  }, [])

  /* ────────────────────────────────────────
     JSX
  ──────────────────────────────────────── */
  return (
    <div style={{ background: '#070f24' }}>

      {/* ── Loader ── */}
      <div ref={loaderRef} style={{
        position: 'fixed', inset: 0, background: '#070f24', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'opacity 0.6s ease, visibility 0.6s',
      }}>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: '#FDFCFA' }}>
            <svg width="26" height="26" viewBox="0 0 28 28" fill="none">
              <rect width="28" height="28" rx="6" fill="#0B2046"/>
              <path d="M7 14L12 19L21 10" stroke="#F0A80E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            ValuVault <em style={{ color: '#F0A80E' }}>AI</em>
          </div>
          <div style={{ width: 200, height: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
            <div ref={loaderBarRef} style={{ height: '100%', width: '0%', background: 'linear-gradient(90deg,#F0A80E,#ffd45e)', transition: 'width 0.1s linear' }} />
          </div>
          <span ref={loaderPctRef} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(253,252,250,0.4)' }}>0%</span>
        </div>
      </div>

      {/* ── Header ── */}
      <header ref={headerRef} id="site-header" className="lp-header">
        <nav className="lp-nav">
          <a href="/" className="lp-logo">
            <svg width="22" height="22" viewBox="0 0 28 28" fill="none">
              <rect width="28" height="28" rx="6" fill="#0B2046"/>
              <path d="M7 14L12 19L21 10" stroke="#F0A80E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            ValuVault <em>AI</em>
          </a>
          <div className="lp-nav-links">
            <a href="#scroll-container">Modules</a>
            <a href="#scroll-container">Workflow</a>
            <a href="#scroll-container">Pricing</a>
            <a href="#scroll-container">Security</a>
          </div>
          <div className="lp-nav-ctas">
            <Link href="/dashboard" className="lp-btn-ghost">Sign In</Link>
            <button onClick={() => setPlansOpen(true)} className="lp-btn-primary">Free Trial</button>
          </div>
        </nav>
      </header>

      {/* ── Hero ── */}
      <section ref={heroRef} className="lp-hero">
        <div className="lp-hero-grid" />
        <div className="lp-hero-content">
          <span className="section-label hero-label lp-hero-label">001 / Forensic Intelligence</span>
          <h1 className="lp-hero-heading">
            <span className="word">The</span>
            <span className="word">AI</span>
            <span className="word lp-accent">Workbench</span>
            <span className="word">for</span>
            <span className="word">Forensic</span>
            <span className="word lp-accent">Appraisal</span>
          </h1>
          <p className="hero-tagline lp-hero-tag">From messy documents to court-ready valuation reports — automated, defensible, precise.</p>
          <div className="hero-ctas lp-hero-ctas">
            <button onClick={() => setPlansOpen(true)} className="lp-btn-gold">Start Free Trial <span>→</span></button>
            <a href="#scroll-container" className="lp-btn-outline">Explore Platform ↓</a>
          </div>
        </div>
        <div className="hero-scroll-hint lp-scroll-hint">
          <div className="lp-scroll-line" />
          <span>Scroll to explore</span>
        </div>
      </section>

      {/* ── Canvas ── */}
      <div ref={canvasWrapRef} className="lp-canvas-wrap">
        <canvas ref={canvasRef} id="canvas" />
      </div>

      {/* ── Dark overlay ── */}
      <div ref={overlayRef} className="lp-overlay" />

      {/* ── Marquee ── */}
      <div ref={marqueeRef} className="lp-marquee-wrap">
        <div ref={marqueeTextRef} className="lp-marquee-text">
          Forensic Appraisal &nbsp;·&nbsp; Litigation Support &nbsp;·&nbsp; AI Extraction &nbsp;·&nbsp; Court-Ready Reports &nbsp;·&nbsp;
          SOC2 Compliant &nbsp;·&nbsp; Valuation Intelligence &nbsp;·&nbsp; Expert Witness Ready &nbsp;·&nbsp;
          Forensic Appraisal &nbsp;·&nbsp; Litigation Support &nbsp;·&nbsp; AI Extraction &nbsp;·&nbsp; Court-Ready Reports &nbsp;·&nbsp;
        </div>
      </div>

      {/* ── Scroll Container ── */}
      <div ref={scrollContRef} id="scroll-container" className="lp-scroll-container">

        {/* 002 · AI Extraction */}
        <section className="scroll-section lp-section lp-align-left"
          data-enter="22" data-leave="36" data-animation="slide-left">
          <div className="lp-section-inner">
            <span className="section-label">002 / AI Extraction</span>
            <h2 className="section-heading">Turn Any Document Into Structured Data</h2>
            <p className="section-body">Upload tax returns, P&amp;Ls, bank statements, or QuickBooks exports. The AI extraction engine parses and validates financial data — even from the messiest scanned exhibits.</p>
            <a href="/dashboard" className="section-cta lp-cta-link">Explore Module 4 →</a>
          </div>
        </section>

        {/* 003 · Forensic Ledger */}
        <section className="scroll-section lp-section lp-align-right"
          data-enter="38" data-leave="52" data-animation="slide-right">
          <div className="lp-section-inner">
            <span className="section-label">003 / Forensic Ledger</span>
            <h2 className="section-heading">Automated YOY Normalization &amp; Variance Radar</h2>
            <p className="section-body">The Forensic Ledger normalizes multi-year financials, surfaces owner add-backs, and flags statistical anomalies — giving you defensible working papers in minutes.</p>
            <a href="/dashboard" className="section-cta lp-cta-link">Explore Module 5 →</a>
          </div>
        </section>

        {/* 004 · Industry Benchmarks */}
        <section className="scroll-section lp-section lp-align-left"
          data-enter="48" data-leave="62" data-animation="fade-up">
          <div className="lp-section-inner">
            <span className="section-label">004 / Industry Intelligence</span>
            <h2 className="section-heading">Live IbisWorld &amp; BVR Benchmarks</h2>
            <p className="section-body">Automatic NAICS/SIC classification linked to real-time BVR and IbisWorld datasets. Industry multiples, risk factors, and comp transaction data — pulled, cited, and ready for your report.</p>
            <a href="/dashboard" className="section-cta lp-cta-link">Explore Module 6 →</a>
          </div>
        </section>

        {/* 005 · Stats */}
        <section className="scroll-section lp-section lp-stats-section"
          data-enter="62" data-leave="78" data-animation="stagger-up">
          <div className="lp-stats-grid">
            {[
              { value: '500', decimals: '0', suffix: '+', label: 'Active Firms' },
              { value: '4.2', decimals: '1', suffix: 'B',  label: 'Matters Managed' },
              { value: '99.8', decimals: '1', suffix: '%', label: 'Extraction Accuracy' },
              { value: '72',  decimals: '0', suffix: 'hrs', label: 'Saved Per Case' },
            ].map((s) => (
              <div key={s.label} className="stat">
                <span className="stat-number" data-value={s.value} data-decimals={s.decimals}>0</span>
                <span className="lp-stat-suffix">{s.suffix}</span>
                <span className="lp-stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 006 · Reports */}
        <section className="scroll-section lp-section lp-align-right"
          data-enter="76" data-leave="90" data-animation="scale-up">
          <div className="lp-section-inner">
            <span className="section-label">005 / Report Generation</span>
            <h2 className="section-heading">One Click. Court-Ready Output.</h2>
            <p className="section-body">Generate fully-documented valuation reports with embedded methodology, NAICS citations, and chain-of-custody audit logs. Every export is SOC2 timestamped and expert-witness ready.</p>
            <a href="/dashboard" className="section-cta lp-cta-link">Explore Module 10 →</a>
          </div>
        </section>

        {/* 007 · CTA */}
        <section className="scroll-section lp-section lp-align-right"
          data-enter="88" data-leave="100" data-animation="fade-up" data-persist="true">
          <div className="lp-section-inner">
            <span className="section-label">006 / Get Started</span>
            <h2 className="section-heading lp-cta-heading">Ready to Eliminate the Manual Grind?</h2>
            <p className="section-body">Join 500+ forensic appraisal specialists who use ValuVault AI to deliver faster, more defensible engagements.</p>
            <div className="cta-buttons lp-cta-buttons">
              <button onClick={() => setPlansOpen(true)} className="lp-btn-gold section-cta">Start Free Trial →</button>
              <button onClick={() => setPlansOpen(true)} className="lp-btn-outline-dark section-cta">View Plans</button>
            </div>
            <div className="cta-trust lp-trust">
              <span>SOC2 Type II</span><span>·</span>
              <span>256-bit Encryption</span><span>·</span>
              <span>NACVA / ASA Aligned</span>
            </div>
          </div>
        </section>

      </div>{/* /#scroll-container */}

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <div className="lp-footer-logo">
              <svg width="20" height="20" viewBox="0 0 28 28" fill="none">
                <rect width="28" height="28" rx="6" fill="#0B2046"/>
                <path d="M7 14L12 19L21 10" stroke="#F0A80E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              ValuVault <em>AI</em>
            </div>
            <p>Enterprise-grade forensic intelligence. Automating the Module 1–10 pipeline for appraisal specialists worldwide.</p>
          </div>
          {[
            { title: 'Platform',     links: [['Forensic Workbench','/dashboard'],['Case Management','/dashboard'],['AI Discovery','/dashboard']] },
            { title: 'Integrations', links: [['IbisWorld / BVR','#'],['NAICS / SIC Lookup','#'],['QuickBooks Export','#']] },
            { title: 'Contact',      links: [['forensic@valuvault.ai',''],['1-800-VALU-AI',''],['Appraisal Center, NY','']] },
          ].map((col) => (
            <div key={col.title} className="lp-footer-col">
              <h4>{col.title}</h4>
              <ul>
                {col.links.map(([label, href]) => (
                  <li key={label}>{href ? <a href={href}>{label}</a> : label}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="lp-footer-bottom">
          <span>© 2024 ValuVault Technologies Inc.</span>
          <div>
            <a href="#">Security Protocol</a>
            <a href="#">Privacy Policy</a>
            <a href="#">Audit Logs</a>
          </div>
        </div>
      </footer>

      {/* ── Plans Modal ─────────────────────────────────────────────────── */}
      {plansOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(8,12,24,0.82)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '1rem',
            overflowY: 'auto',
          }}
          onClick={() => setPlansOpen(false)}
        >
          <div
            style={{
              background: '#0d1321', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '1.25rem', padding: 'clamp(1.25rem, 5vw, 2.5rem) clamp(1rem, 5vw, 2rem)',
              maxWidth: '860px', width: '100%', position: 'relative',
              boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
              margin: 'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Close */}
            <button
              onClick={() => setPlansOpen(false)}
              style={{
                position: 'absolute', top: '1.25rem', right: '1.25rem',
                background: 'rgba(255,255,255,0.08)', border: 'none',
                color: '#fff', width: '2rem', height: '2rem', borderRadius: '50%',
                cursor: 'pointer', fontSize: '1rem', lineHeight: 1,
              }}
            >×</button>

            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <p style={{ fontSize: '0.65rem', letterSpacing: '0.25em', color: 'var(--lp-accent, #d4a017)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                Choose your plan
              </p>
              <h2 style={{ fontSize: '1.75rem', fontWeight: 900, color: '#fff', margin: 0 }}>
                Start Your 7-Day Free Trial
              </h2>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                No credit card required for the Solo trial. Cancel anytime.
              </p>
            </div>

            {/* Plan cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: '1rem' }}>
              {[
                {
                  name: 'Solo',
                  badge: '7-Day Free Trial',
                  badgeFree: true,
                  price: '$149',
                  period: '/mo after trial',
                  desc: 'For independent forensic appraisers.',
                  features: ['Up to 15 active cases', 'Full AI extraction', 'Anomaly detection', 'DCF + GPCM engine', 'AI report drafting', 'Audit trail'],
                  cta: 'Start Free Trial',
                  ctaPrimary: true,
                  href: '/signup',
                },
                {
                  name: 'Firm',
                  badge: 'Most Popular',
                  badgeFree: false,
                  price: '$499',
                  period: '/mo',
                  desc: 'For small to mid-size appraisal firms.',
                  features: ['Up to 100 cases', 'Up to 10 users', 'Role-based access', 'All Solo features', 'SharePoint connector', 'Priority support'],
                  cta: 'Get Started',
                  ctaPrimary: false,
                  href: '/signup',
                },
                {
                  name: 'Enterprise',
                  badge: 'Custom',
                  badgeFree: false,
                  price: 'Contact us',
                  period: '',
                  desc: 'Unlimited scale for large institutions.',
                  features: ['Unlimited cases & users', 'SSO / SAML', 'Custom AI tuning', 'SLA guarantee', 'All Firm features', 'Dedicated CSM'],
                  cta: 'Talk to Sales',
                  ctaPrimary: false,
                  href: 'mailto:sales@valuvault.ai?subject=Enterprise%20Plan%20Inquiry',
                },
              ].map(plan => (
                <div
                  key={plan.name}
                  style={{
                    background: plan.ctaPrimary ? 'rgba(212,160,23,0.07)' : 'rgba(255,255,255,0.04)',
                    border: plan.ctaPrimary ? '1px solid rgba(212,160,23,0.4)' : '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '1rem', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem',
                  }}
                >
                  {/* Badge */}
                  <div style={{
                    display: 'inline-block', alignSelf: 'flex-start',
                    background: plan.badgeFree ? 'rgba(212,160,23,0.2)' : 'rgba(255,255,255,0.1)',
                    color: plan.badgeFree ? '#d4a017' : 'rgba(255,255,255,0.6)',
                    fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.15em',
                    textTransform: 'uppercase', padding: '0.25rem 0.65rem', borderRadius: '999px',
                  }}>
                    {plan.badge}
                  </div>

                  {/* Name + price */}
                  <div>
                    <p style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 0.25rem' }}>{plan.name}</p>
                    <p style={{ fontSize: '1.6rem', fontWeight: 900, color: '#fff', margin: 0, lineHeight: 1 }}>{plan.price}</p>
                    {plan.period && <p style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', margin: '0.2rem 0 0' }}>{plan.period}</p>}
                    <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.5rem' }}>{plan.desc}</p>
                  </div>

                  {/* Features */}
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: 1 }}>
                    {plan.features.map(f => (
                      <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.65)' }}>
                        <span style={{ color: '#4ade80', marginTop: '0.05rem', flexShrink: 0 }}>✓</span>{f}
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <a
                    href={plan.href}
                    style={{
                      display: 'block', textAlign: 'center', textDecoration: 'none',
                      padding: '0.65rem 1rem', borderRadius: '0.5rem',
                      fontWeight: 700, fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase',
                      background: plan.ctaPrimary ? 'var(--lp-accent, #d4a017)' : 'rgba(255,255,255,0.1)',
                      color: plan.ctaPrimary ? '#0d1321' : '#fff',
                      border: plan.ctaPrimary ? 'none' : '1px solid rgba(255,255,255,0.15)',
                      transition: 'opacity 0.15s',
                    }}
                    onMouseOver={e => (e.currentTarget.style.opacity = '0.85')}
                    onMouseOut={e => (e.currentTarget.style.opacity = '1')}
                  >
                    {plan.cta}
                  </a>
                </div>
              ))}
            </div>

            <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: '0.7rem', marginTop: '1.5rem' }}>
              SOC2 Type II · 256-bit Encryption · NACVA / ASA Aligned · Cancel anytime
            </p>
          </div>
        </div>
      )}

    </div>
  )
}
