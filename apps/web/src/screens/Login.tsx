import { useState, type FormEvent } from 'react';
import { ApiError, login, type Me } from '../api';
import { useT } from '../i18n';

export function Login({ onDone }: { onDone: (m: Me) => void }) {
  const { t, lang, setLang } = useT();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <div className="center">
      <form className="login card" onSubmit={submit}>
        <div className="rowhead">
          <h1>{t.appName}</h1>
          <div className="lang" role="group" aria-label="Language">
            <button type="button" className="u" aria-pressed={lang === 'ur'} onClick={() => setLang('ur')}>اردو</button>
            <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
          </div>
        </div>
        <label className="f">
          <span>{t.loginHint}</span>
          <input className="in ltr" autoComplete="username" inputMode="tel" value={id} onChange={(e) => setId(e.target.value)} required minLength={3} />
        </label>
        <label className="f">
          <span>{t.password}</span>
          <input className="in ltr" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </label>
        {err && <div className="banner bad" role="alert">{err}</div>}
        <button className="cta" disabled={busy}>{busy ? '…' : t.signIn}</button>
      </form>
    </div>
  );
}
