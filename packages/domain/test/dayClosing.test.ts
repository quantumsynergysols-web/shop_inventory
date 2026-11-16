import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DayInput } from '../src/dayClosing.ts';
import { DayClosedError, NoteRequiredError, assertDayOpen, closeDay, summarizeDay } from '../src/dayClosing.ts';

const rs = (n: number) => n * 100;

/** Same day as prototype v0.2 (11 Nov 2026) */
function prototypeDay(): DayInput {
  return {
    openingCashPaisa: rs(15000),
    sales: [
      { totalPaisa: rs(48425), paid: [{ mode: 'CASH', amountPaisa: rs(20000) }], cogsPaisa: rs(38500) },
      { totalPaisa: rs(12300), paid: [{ mode: 'JAZZCASH', amountPaisa: rs(12300) }], cogsPaisa: rs(9800) },
      { totalPaisa: rs(4860), paid: [{ mode: 'CASH', amountPaisa: rs(4860) }], cogsPaisa: rs(3800) },
    ],
    expenses: [{ mode: 'CASH', amountPaisa: rs(450) }, { mode: 'CASH', amountPaisa: rs(1200) }],
    customerPayments: [{ mode: 'CASH', amountPaisa: rs(8000) }],
    supplierPayments: [{ mode: 'BANK', amountPaisa: rs(50000) }],
    purchasesPaisa: rs(146200),
  };
}

test('day summary matches the prototype figures', () => {
  const s = summarizeDay(prototypeDay());
  assert.equal(s.billCount, 3);
  assert.equal(s.saleTotalPaisa, rs(65585));
  assert.equal(s.salesCashPaisa, rs(24860));
  assert.equal(s.salesBankPaisa, rs(12300));
  assert.equal(s.salesCreditPaisa, rs(28425));
  assert.equal(s.cogsPaisa, rs(52100));
  assert.equal(s.grossProfitPaisa, rs(13485));
  assert.equal(s.marginPct, 20.6);
  assert.equal(s.netProfitPaisa, rs(11835));
  assert.equal(s.supplierPaidBankPaisa, rs(50000));
  assert.equal(s.expectedCashPaisa, rs(46210));
});

test('BR-8: cash paid to suppliers and cash refunds reduce expected cash', () => {
  const d = prototypeDay();
  d.supplierPayments = [{ mode: 'CASH', amountPaisa: rs(2000) }];
  d.salesReturns = [{ totalPaisa: rs(500), refunds: [{ mode: 'CASH', amountPaisa: rs(500) }], cogsReversedPaisa: rs(400) }];
  const s = summarizeDay(d);
  assert.equal(s.expectedCashPaisa, rs(46210 - 2000 - 500));
  assert.equal(s.saleTotalPaisa, rs(65085));
  assert.equal(s.cogsPaisa, rs(51700));
});

test('bank expenses lower profit but not cash in the galla', () => {
  const d = prototypeDay();
  d.expenses = [...(d.expenses ?? []), { mode: 'BANK', amountPaisa: rs(3000) }];
  const s = summarizeDay(d);
  assert.equal(s.netProfitPaisa, rs(11835 - 3000));
  assert.equal(s.expectedCashPaisa, rs(46210));
});

test('paid more than the bill is refused', () => {
  assert.throws(() => summarizeDay({ openingCashPaisa: 0, sales: [{ totalPaisa: 100, paid: [{ mode: 'CASH', amountPaisa: 200 }], cogsPaisa: 0 }] }), RangeError);
});

test('closing: exact count, short with note, short without note', () => {
  const s = summarizeDay(prototypeDay());
  const ok = closeDay(s, rs(46210));
  assert.equal(ok.differencePaisa, 0);
  assert.equal(ok.nextOpeningCashPaisa, rs(46210));
  assert.throws(() => closeDay(s, rs(45000)), NoteRequiredError);
  const short = closeDay(s, rs(45000), { note: 'Rs 1,210 change given from galla' });
  assert.equal(short.differencePaisa, rs(-1210));
  assert.equal(closeDay(s, rs(46000)).differencePaisa, rs(-210), 'under Rs 500 needs no note');
});

test('closed day is locked (BR-10)', () => {
  const closed = new Set(['2026-11-11']);
  assert.throws(() => assertDayOpen('2026-11-11', closed), DayClosedError);
  assertDayOpen('2026-11-12', closed);
  assert.throws(() => assertDayOpen('11/11/26', closed), RangeError);
});
