import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="public-page">
      <header className="public-header">
        <Link className="brand-lockup" href="/">HMS <span>Hostel Management</span></Link>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <Link className="button secondary" href="/login">Staff sign in</Link>
          <Link className="button secondary" href="/student-login">Student Login</Link>
        </div>
      </header>
      <section className="public-hero">
        <span className="eyebrow">A BETTER WAY TO RUN YOUR HOSTEL</span>
        <h1>Hostel operations,<br /><span>all in one place.</span></h1>
        <p>Manage admissions, resident records, rooms, and bed occupancy with one secure workspace.</p>
        <div className="hero-actions">
          <Link className="button primary" href="/login">Staff sign in</Link>
          <Link className="button secondary" href="/student-login">Student Login</Link>
          <Link className="quiet-link" href="#features">Explore the platform</Link>
        </div>
      </section>
      <section id="features" className="public-features">
        <article><span>01</span><h2>Admissions</h2><p>Review each application and approve it before assigning a bed.</p></article>
        <article><span>02</span><h2>Resident records</h2><p>Keep resident information organized with protected identity data.</p></article>
        <article><span>03</span><h2>Room inventory</h2><p>Track room capacity, bed availability, check-ins, and check-outs.</p></article>
      </section>
      <footer className="public-footer">
        For a hostel’s public contact page, visit <code>/hostels/&lt;hostel-id&gt;</code>.
      </footer>
    </main>
  );
}
