'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiRequest } from '@/lib/api/client';

type PublicHostel = {
  name: string;
  branches: { name: string; address: string | null; phone: string | null; mapLink: string | null }[];
};

function safeMapUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function PublicHostelPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [hostel, setHostel] = useState<PublicHostel | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void apiRequest<PublicHostel>(`/public/hostels/${encodeURIComponent(slug)}`).then((response) => {
      if (!active) return;
      if (response.ok) setHostel(response.data);
      else setError(response.message);
    });
    return () => { active = false; };
  }, [slug]);

  return (
    <main className="public-page">
      <header className="public-header">
        <a className="brand-lockup" href="/">HMS <span>Hostel Management</span></a>
        <div className="button-row">
          <a className="button secondary" href="/login">Staff sign in</a>
          <a className="button secondary" href={`/student-login?hostel=${encodeURIComponent(slug)}`}>Student Login</a>
        </div>
      </header>
      <section className="hostel-hero">
        {error ? <div className="notice error" role="alert">{error}</div> : !hostel ? <p>Loading hostel details…</p> : (
          <>
            <span className="eyebrow">WELCOME</span>
            <h1>{hostel.name}</h1>
            <p>Find branch contact information below. Resident and admission information is private.</p>
            <div className="branch-cards">
              {hostel.branches.map((branch, index) => {
                const mapUrl = safeMapUrl(branch.mapLink);
                return (
                  <article className="branch-card" key={`${branch.name}-${index}`}>
                    <h2>{branch.name}</h2>
                    {branch.address && <p>{branch.address}</p>}
                    {branch.phone && <p><a href={`tel:${branch.phone}`}>{branch.phone}</a></p>}
                    {mapUrl && <a className="quiet-link" href={mapUrl} target="_blank" rel="noreferrer">View map</a>}
                  </article>
                );
              })}
              {!hostel.branches.length && <p>No active branches are currently listed.</p>}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
