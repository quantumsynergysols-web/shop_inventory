import { useState, type FormEvent } from 'react';
import { ApiError, login, post, type Me } from '../api';
import { useT } from '../i18n';
import '../auth.css';

type Field = 'shopName' | 'ownerName' | 'phone' | 'password' | 'password2';

/**
 * Desktop first run: create the shop and the owner's login (only while the database is empty).
 * Each field says what is wrong under itself (in Urdu or English) once it was left or the button
 * was pressed; the browser's own English pop-ups are switched off (noValidate).
 */
export function Setup({ onDone }: { onDone: (m: Me) => void }) {
  const { t, lang, setLang } = useT();
  const [f, setF] = useState<Record<Field, string>>({ shopName: '', ownerName: '', phone: '', password: '', password2: '' });
  const [seen, setSeen] = useState<Partial<Record<Field, boolean>>>({});
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const problems: Partial<Record<Field, string>> = {};
  if (f.shopName.trim().length < 2) problems.shopName = t.needShopName;
  if (!f.ownerName.trim()) problems.ownerName = t.needOwnerName;
  if (!/^[0-9+\- ]{7,20}$/.test(f.phone.trim())) problems.phone = t.needPhone;
  if (f.password.length < 8) problems.password = t.needPassword;
  if (f.password2 !== f.password || !f.password2) problems.password2 = t.pwMismatch;
  const show = (k: Field) => (tried || seen[k]) && problems[k];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    const first = (Object.keys(problems) as Field[])[0];
    if (first) {
      document.getElementById(`setup-${first}`)?.focus();
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await post('/setup', { shopName: f.shopName.trim(), ownerName: f.ownerName.trim(), phone: f.phone.trim(), password: f.password });
      onDone(await login(f.phone.trim(), f.password));
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : t.error);
      setBusy(false);
    }
  }

  const field = (k: Field, label: string, props: Record<string, unknown> = {}) => (
    <label className="auth-field">
      <span>{label}</span>
      <div className={`auth-input${show(k) ? ' bad' : ''}`}>
        <input
          id={`setup-${k}`}
          value={f[k]}
          onChange={(e) => setF({ ...f, [k]: e.target.value })}
          onBlur={() => setSeen((s) => ({ ...s, [k]: true }))}
          aria-invalid={!!show(k)}
          aria-describedby={show(k) ? `setup-${k}-hint` : undefined}
          {...props}
        />
      </div>
      {/* always present, so a message appearing never moves the button under the mouse */}
      <span id={`setup-${k}-hint`} className="auth-hint" aria-live="polite">{show(k) ? problems[k] : ''}</span>
    </label>
  );

  return (
    <div className="auth">
      <div className="auth-bg" aria-hidden="true">
        <i className="b1" />
        <i className="b2" />
        <i className="b3" />
      </div>
      <header className="auth-top">
        <div className="auth-brand">
          <span className="auth-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 9h8M8 12h8M8 15h5" /></svg>
          </span>
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
            <span>{t.setupHead1}</span> <em>{t.setupHead2}</em>
          </h1>
          <p>{t.setupSub}</p>
        </section>
        <form className="auth-card" onSubmit={submit} noValidate>
          <h2>{t.setupTitle}</h2>
          <p className="auth-muted">{t.setupHint}</p>
          {field('shopName', t.setupShopName, { autoFocus: true, autoComplete: 'organization' })}
          {field('ownerName', t.ownerName, { autoComplete: 'name' })}
          {field('phone', t.ownerPhone, { className: 'ltr', inputMode: 'tel', autoComplete: 'username', placeholder: '03XX XXXXXXX' })}
          {field('password', `${t.password} (${t.min8})`, { className: 'ltr', type: 'password', autoComplete: 'new-password' })}
          {field('password2', t.passwordAgain, { className: 'ltr', type: 'password', autoComplete: 'new-password' })}
          {err && <div className="auth-err" role="alert">{err}</div>}
          <button className="auth-cta" disabled={busy}>{busy ? <span className="spin" /> : t.setupGo}</button>
        </form>
      </main>
    </div>
  );
}
