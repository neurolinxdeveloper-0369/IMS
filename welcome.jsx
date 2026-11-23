import React from 'react'
import { createRoot } from 'react-dom/client'
import './welcome.css'

function WelcomePage() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="page">
        <header className="masthead">
          <div className="identity" aria-label="Neurolinx Inventory Management System">
            <a className="wordmark" href="https://neurolinx.in" aria-label="Neurolinx home"><span className="brand-accent" aria-hidden="true"></span>Neurolinx</a>
            <span className="identity-divider" aria-hidden="true"></span><span className="site-name">Inventory Management System</span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <section className="hero" aria-labelledby="welcome-title">
            <div className="hero-copy">
              <p className="eyebrow">A Neurolinx workspace</p>
              <h1 id="welcome-title">Welcome to <span>Inventory Management System</span></h1>
              <p className="hero-intro">Your workspace starts here.</p>
              <a className="hero-action" href="#about">About this space<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="8"/><path d="M12 10.5v6M12 7.5v.1" strokeLinecap="round"/></svg></a>
              <div className="hero-caption" aria-hidden="true">A fresh perspective. A familiar place.</div>
            </div>
            <figure className="hero-art" aria-hidden="true">
              <svg className="workspace-art" viewBox="0 0 660 660" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" stroke="#dde0d7" strokeWidth=".7"/></pattern>
                  <radialGradient id="grid-fade"><stop offset="0" stopColor="white"/><stop offset=".95" stopColor="white" stopOpacity="0"/></radialGradient>
                  <mask id="grid-mask"><rect width="660" height="660" fill="url(#grid-fade)"/></mask>
                  <linearGradient id="slab" x1="211" y1="237" x2="486" y2="409" gradientUnits="userSpaceOnUse"><stop stopColor="#fff"/><stop offset="1" stopColor="#e7eae2"/></linearGradient>
                  <linearGradient id="red-top" x1="276" y1="236" x2="390" y2="280" gradientUnits="userSpaceOnUse"><stop stopColor="#fa6557"/><stop offset="1" stopColor="#e7352b"/></linearGradient>
                  <filter id="shadow" x="-.8" y="-.5" width="2.6" height="2.4"><feGaussianBlur stdDeviation="19"/></filter>
                </defs>
                <rect width="660" height="660" fill="url(#grid)" mask="url(#grid-mask)"/>
                <circle cx="330" cy="332" r="239" stroke="#dce0d5" strokeWidth="1"/>
                <circle cx="330" cy="332" r="209" stroke="#e0e3d9" strokeDasharray="3 10"/>
                <g className="orbit-detail"><path d="M569 330h9M82 330h9M330 82v9M330 569v9" stroke="#919a88" strokeWidth="2"/><rect x="492" y="162" width="9" height="9" rx="1" transform="rotate(45 492 162)" fill="#f6f4f0" stroke="#9ca592"/></g>
                <ellipse cx="330" cy="465" rx="155" ry="46" fill="#28332b" opacity=".13" filter="url(#shadow)"/>
                <path d="m94 409 236-137 236 137-236 137L94 409Z" fill="#eff0e9" stroke="#d6dbcf"/>
                <path d="m94 409 236 137 236-137v13L330 559 94 422v-13Z" fill="#e7eadf"/>
                <path d="m330 546 236-137v13L330 559v-13Z" fill="#dce1d3"/>
                <path d="m330 470-113-65 113-65 113 65-113 65Z" stroke="#cbd1c2" strokeDasharray="5 6"/>
                <path d="m330 377-125 72M330 377l126 72M330 377v99" stroke="#b2bba7" strokeWidth="1.2"/>
                <path d="M205 449v-45M456 449v-45M330 476v-38" stroke="#b2bba7" strokeWidth="1.2" strokeDasharray="3 5"/>
                <g className="floating-workspace">
                  <path d="m176 304 154-89 154 89-154 89-154-89Z" fill="url(#slab)" stroke="#c5cebb"/>
                  <path d="m176 304 154 89 154-89v18l-154 89-154-89v-18Z" fill="#e2e7d9" stroke="#c5cebb"/>
                  <path d="m330 393 154-89v18l-154 89v-18Z" fill="#cbd3c0"/>
                  <path d="m195 304 135-78 135 78-135 78-135-78Z" stroke="#dbe0d4"/>
                  <path d="m270 260 60-35 60 35-60 35-60-35Z" fill="url(#red-top)"/>
                  <path d="m270 260 60 35v71l-60-35v-71Z" fill="#dc2a22"/>
                  <path d="m330 295 60-35v71l-60 35v-71Z" fill="#b71e19"/>
                  <path d="m286 279 27 16v36l-27-16v-36Z" stroke="#ffb3a5" strokeOpacity=".75"/>
                  <path d="m347 299 26-15v36l-26 15v-36Z" stroke="#f59687" strokeOpacity=".6"/>
                  <path d="m284 260 46-27 46 27-46 27-46-27Z" stroke="#ffb0a1" strokeOpacity=".6"/>
                </g>
                <g stroke="#bac4af" strokeWidth="1.1">
                  <path d="m184 393 21-12 21 12-21 12-21-12Z" fill="#fff"/><path d="m184 393 21 12 21-12v23l-21 12-21-12v-23Z" fill="#e7ebde"/><path d="m205 405 21-12v23l-21 12v-23Z" fill="#d0d9c5"/>
                  <path d="m435 393 21-12 21 12-21 12-21-12Z" fill="#fff"/><path d="m435 393 21 12 21-12v23l-21 12-21-12v-23Z" fill="#e7ebde"/><path d="m456 405 21-12v23l-21 12v-23Z" fill="#d0d9c5"/>
                  <path d="m309 438 21-12 21 12-21 12-21-12Z" fill="#fff"/><path d="m309 438 21 12 21-12v23l-21 12-21-12v-23Z" fill="#e7ebde"/><path d="m330 450 21-12v23l-21 12v-23Z" fill="#d0d9c5"/>
                </g>
                <path d="M139 251h23M150.5 239.5v23M507 479h16M515 471v16" stroke="#a0aa94"/>
                <path d="M508 270h27v16M128 456h-23v-17" stroke="#c0c8b7"/>
              </svg>
              <figcaption className="art-note">Space to begin</figcaption>
            </figure>
          </section>
          <section id="about" className="about" aria-labelledby="about-title">
            <p className="section-label">Welcome to your space</p>
            <div className="about-copy"><h2 id="about-title">One place to begin.</h2><p>This is the welcome page for Neurolinx Inventory Management System.<br />A simple introduction to your workspace.</p></div>
          </section>
        </main>
        <footer className="footer"><span><strong>Neurolinx Inventory Management System</strong><br />Welcome. Make yourself at home.</span></footer>
      </div>
    </>
  )
}

createRoot(document.getElementById('root')).render(<WelcomePage />)
