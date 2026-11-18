import { get } from '../api';
import { date as fmtDate, qty, rs, time } from '../format';
import { useT } from '../i18n';
import { ErrorBox, Icon, Loading, Nav, useApp, useLoad } from '../ui';

const canScan = (role: string, type: 'SALE' | 'PURCHASE') => role === 'OWNER' || (type === 'SALE' ? role === 'SALESMAN' : role === 'STOREKEEPER');

/** FR-DSH-01..03 */
export function Home() {
  const { t, lang, setLang } = useT();
  const { me } = useApp();
  const { data: d, error, reload } = useLoad(() => Promise.all([get('/dashboard'), get('/settings'), me.role === 'STOREKEEPER' ? Promise.resolve(null) : get('/day').catch(() => null)]), [me.role]);
  if (error) return <div className="body"><ErrorBox error={error} retry={reload} /></div>;
  if (!d) return <Loading />;
  const [dash, shop, day] = d;
  return (
    <>
      <header className="top">
        <div className="grow">
          <div className="label">{t.hello}{me.name ? `، ${me.name}` : ''}</div>
          <h1 className="ltr" style={{ fontFamily: 'var(--ui)' }}>{shop.name}</h1>
        </div>
        <div className="lang" role="group" aria-label="Language">
          <button className="u" aria-pressed={lang === 'ur'} onClick={() => setLang('ur')}>اردو</button>
          <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
        </div>
      </header>
      <main className="body">
        <div className="card">
          {dash.stockValuePaisa != null && (
            <>
              <div className="label">{t.value}</div>
              <div className="big n"><small>Rs</small>{rs(dash.stockValuePaisa).replace('Rs ', '')}</div>
            </>
          )}
          <div className="two">
            <div><span className="label">{t.todayIn}</span><b className="n green">{rs(dash.purchasesTodayPaisa)}</b></div>
            <div><span className="label">{t.todayOut}</span><b className="n blue">{rs(dash.salesTodayPaisa)}</b></div>
          </div>
        </div>

        {day && (
          <a className="card row" href="#/day" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="grow">
              <span className="label">{dash.grossProfitTodayPaisa != null ? t.todayProfit : t.todayOut}</span>
              <b className="n green" style={{ display: 'block', fontSize: 22 }}>{rs(dash.grossProfitTodayPaisa != null ? day.summary.netProfitPaisa : day.summary.saleTotalPaisa)}</b>
              <span className={`pill${day.status === 'CLOSED' ? ' shut' : ''}`}>{day.status === 'CLOSED' ? t.dayClosed : t.dayOpen}</span>
            </span>
            <span className="cta mini">{t.closeDay}</span>
          </a>
        )}

        <div className="lines">
          {canScan(me.role, 'PURCHASE') && (
            <a className="bigbtn in" href="#/scan/new?type=PURCHASE" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="ico"><Icon name="down" /></span>
              <span className="grow"><b>{t.inBtn}</b><span className="sub">{t.inSub}</span></span>
              <Icon name="chev" flip />
            </a>
          )}
          {canScan(me.role, 'SALE') && (
            <a className="bigbtn out" href="#/scan/new?type=SALE" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="ico"><Icon name="up" /></span>
              <span className="grow"><b>{t.outBtn}</b><span className="sub">{t.outSub}</span></span>
              <Icon name="chev" flip />
            </a>
          )}
          {me.role !== 'ACCOUNTANT' && <a className="link" href={`#/manual?type=${canScan(me.role, 'SALE') ? 'SALE' : 'PURCHASE'}`} style={{ textAlign: 'center' }}>{t.manual}</a>}
        </div>

        {dash.unclosedDay && (
          <a className="banner warn" href={`#/day?date=${dash.unclosedDay}`} style={{ textDecoration: 'none' }}>
            {t.unclosedDay(fmtDate(dash.unclosedDay))} →
          </a>
        )}

        {dash.pendingReviews > 0 && (
          <div className="card">
            <div className="rowhead"><h2 className="h3">{t.pending} <span className="tag t-warn n">{dash.pendingReviews}</span></h2></div>
            <div className="list">
              {dash.recentScans.filter((s: any) => s.status === 'NEEDS_REVIEW' || s.status === 'FAILED').map((s: any) => (
                <a key={s.id} className="item" href={`#/scan/${s.id}`}>
                  <span className="grow"><b>{s.type === 'SALE' ? t.outBtn : t.inBtn}</b><span className="sub n">{s.pageCount} {t.page} · {time(s.createdAt)}</span></span>
                  <span className={`tag ${s.status === 'FAILED' ? 't-bad' : 't-warn'}`}>{s.status === 'FAILED' ? t.failed : t.review}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <div className="rowhead"><h2 className="h3">{t.low} <span className="tag t-bad n">{dash.lowStockCount}</span></h2><a className="link" href="#/stock?low=1">{t.all}</a></div>
          <div className="list">
            {dash.lowStock.length === 0 && <div className="label">—</div>}
            {dash.lowStock.map((p: any) => (
              <a key={p.id} className="item" href={`#/stock/${p.id}`}>
                <span className="grow"><b className="ltr">{p.name}</b><span className="sub">{t.min} <span className="n">{qty(p.minLevelMilli)}</span></span></span>
                <span className="qty red">{qty(p.onHandMilli)} <span className="sub">{t.left}</span></span>
              </a>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="h3" style={{ marginBottom: 6 }}>{t.recent}</h2>
          <div className="list">
            {dash.recentDocuments.length === 0 && <div className="label">—</div>}
            {dash.recentDocuments.map((x: any) => (
              <a key={x.id} className="item" href={`#/doc/${x.id}`}>
                <span className="grow"><b className="ltr">{x.party ?? x.docNo}</b><span className="sub n">{x.docNo} · {x.lines} items · {time(x.postedAt)}</span></span>
                <span className={`qty ${x.kind === 'PURCHASE' ? 'green' : x.kind === 'SALE' ? 'blue' : 'muted'}`}>
                  {x.status === 'VOIDED' ? <s>{rs(x.totalPaisa)}</s> : `${x.kind === 'SALE' ? '−' : x.kind === 'PURCHASE' ? '+' : ''}${rs(x.totalPaisa).replace('Rs ', '')}`}
                </span>
              </a>
            ))}
          </div>
        </div>
      </main>
      <Nav current="home" />
    </>
  );
}

export { canScan };
