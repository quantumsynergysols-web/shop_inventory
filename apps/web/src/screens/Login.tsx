import { useState, type FormEvent } from 'react';
import { ApiError, login, type Me } from '../api';
import { useT } from '../i18n';
import '../auth.css';

const Svg = ({ d, size = 20 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICON = {
  logo: 'M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 9h8M8 12h8M8 15h5',
  phone: 'M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  eye: 'M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7a12 12 0 0 1-3.2 4.3M6.6 6.6A12.3 12.3 0 0 0 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 4.3-1',
  shield: 'M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z',
  cloud: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4',
  check: 'M5 12l4 4 10-10',
  up: 'M12 19V5M6 11l6-6 6 6',
  next: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5M11 6l-6 6 6 6',
};

/** A small bill being scanned: rows light up as the beam passes (pure CSS; still when motion is reduced). */
function ScanArt() {
  const rows: [string, string][] = [
    ['PVC pipe 1" 10ft', '22,500'],
    ['Elbow 1"', '3,500'],
    ['Ceiling fan 48"', '46,200'],
    ['8 gang board', '18,600'],
    ['Ball valve ½', '10,400'],
  ];
  return (
    <div className="auth-art" aria-hidden="true">
      <div className="auth-bill">
        <div className="auth-bill-head">AL-MADINA SANITARY</div>
        {rows.map(([name, amt], i) => (
          <div key={name} className="auth-row" style={{ animationDelay: `${0.4 + i * 0.35}s` }}>
            <span className="auth-n">{i + 1}</span>
            <span className="auth-name">{name}</span>
            <span className="auth-amt">{amt}</span>
          </div>
        ))}
        <div className="auth-beam" />
      </div>
      <div className="auth-chip c1"><Svg d={ICON.check} size={16} /> PVC Pipe 1 inch – 10 ft</div>
      <div className="auth-chip c2"><Svg d={ICON.up} size={16} /> +50 stock</div>
    </div>
  );
}

export function Login({ onDone }: { onDone: (m: Me) => void }) {
  const { t, lang, setLang } = useT();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // On Vercel the app lives at /app/ next to the product website
  const website = import.meta.env.BASE_URL !== '/' ? '/' : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      onDone(await login(id.trim(), pw));
    } catch (x) {
      setErr(x instanceof ApiError && x.status === 423 ? t.locked : x instanceof ApiError && x.status === 401 ? t.badLogin : navigator.onLine ? t.error : t.offline);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-bg" aria-hidden="true">
        <i className="b1" />
        <i className="b2" />
        <i className="b3" />
      </div>

      <header className="auth-top">
        <div className="auth-brand">
          <span className="auth-logo"><Svg d={ICON.logo} size={22} /></span>
          <span>
            <b>{t.appName}</b>
            <small>PHOTO SCAN</small>
          </span>
        </div>
        <div className="lang auth-lang" role="group" aria-label="Language">
          <button type="button" className="u" aria-pressed={lang === 'ur'} onClick={() => setLang('ur')}>اردو</button>
          <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
        </div>
      </header>

      <main className="auth-main">
        <section className="auth-pitch">
          <h1>
            <span>{t.authHead1}</span> <em>{t.authHead2}</em>
          </h1>
          <p>{t.authSub}</p>
        </section>
        <ScanArt />

        <form className="auth-card" onSubmit={submit} noValidate={false}>
          <h2>{t.authWelcome}</h2>
          <p className="auth-muted">{t.authHint}</p>
          <label className="auth-field">
            <span>{t.loginHint}</span>
            <div className="auth-input">
              <Svg d={ICON.phone} />
              <input className="ltr" autoComplete="username" inputMode="tel" placeholder="03XX XXXXXXX" value={id} onChange={(e) => setId(e.target.value)} required minLength={3} aria-invalid={!!err} />
            </div>
          </label>
          <label className="auth-field">
            <span>{t.password}</span>
            <div className="auth-input">
              <Svg d={ICON.lock} />
              <input className="ltr" type={show ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required aria-invalid={!!err} />
              <button type="button" className="auth-eye" aria-label={show ? t.hidePw : t.showPw} aria-pressed={show} onClick={() => setShow((s) => !s)}>
                <Svg d={show ? ICON.eyeOff : ICON.eye} />
              </button>
            </div>
          </label>
          {err && <div className="auth-err" role="alert">{err}</div>}
          <button className="auth-cta" disabled={busy} aria-busy={busy}>
            {busy ? <span className="spin" aria-label={t.loading} /> : <>{t.signIn} <Svg d={lang === 'ur' ? ICON.back : ICON.next} /></>}
          </button>
          <ul className="auth-trust">
            <li><Svg d={ICON.shield} size={16} /> {t.authTrust1}</li>
            <li><Svg d={ICON.cloud} size={16} /> {t.authTrust2}</li>
          </ul>
          {website && <a className="auth-back" href={website}>{t.authWebsite}</a>}
        </form>
      </main>
    </div>
  );
}
