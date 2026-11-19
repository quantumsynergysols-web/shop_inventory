/* Owner: fill in the contact details. Rows left as '' are not shown.
   whatsapp / phone: international format, e.g. '+92 300 0000000'. */
const CONTACT = {
  whatsapp: '',
  phone: '',
  email: '',
  address: '',
};

/* Shop Inventory ERP – Photo Scan · product site script.
   The page is complete without JavaScript (English); this file adds the Urdu toggle, the contact rows,
   and the motion: hero scan loop, sticky "how it works" phone, 3D screens carousel, counters,
   reveals, smooth FAQ, cursor glow and magnetic buttons. All of it respects prefers-reduced-motion. */
(function () {
  'use strict';
  var KEY = 'qss-site-lang';
  var html = document.documentElement;
  var n = function (s) { return '<span class="n">' + s + '</span>'; };
  // hand-drawn underline under the accent phrase of the headline (same markup as index.html)
  var UL = '<svg class="ul" viewBox="0 0 300 22" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M4 15 C 60 5, 140 7, 200 10 S 280 13, 296 8"/></svg>';

  var UR = {
    'meta.title': 'Shop Inventory ERP – Photo Scan · بل کی تصویر لیں، اسٹاک مکمل',
    'meta.desc': 'پاکستان کی چھوٹی دکانوں کے لیے: ہاتھ سے لکھے یا چھپے بل کی تصویر لیں، ہر لائن تصویر کے ساتھ چیک کریں، اور اسٹاک خود اپڈیٹ۔ اردو اور انگریزی۔',
    'skip': 'مواد پر جائیں',
    'brand.aria': 'Shop Inventory ERP – Photo Scan، ہوم',
    'brand.sub': 'فوٹو اسکین',
    'nav.aria': 'حصے',
    'nav.how': 'طریقہ',
    'nav.features': 'خصوصیات',
    'nav.faq': 'سوالات',
    'nav.contact': 'رابطہ',
    'open': 'ایپ کھولیں',
    'login': 'لاگ اِن',

    'hero.eyebrow': 'سینیٹری، الیکٹرک، پلمبنگ، کراکری اور ہارڈویئر کی دکانوں کے لیے',
    'hero.h1': '<span class="shine">بل کی تصویر لیں۔</span><br><span class="shine">لائنیں چیک کریں۔</span><br><em class="hand">اسٹاک مکمل۔' + UL + '</em>',
    'hero.lead': 'سپلائر کا بل ہو یا سیل کا، ہاتھ سے لکھا ہو یا چھپا ہوا، اردو، رومن اردو یا انگریزی میں: فون سے تصویر لیں۔ AI ہر لائن پڑھتا ہے، آپ ہر لائن اس کی تصویر کے ساتھ دیکھ کر تصدیق کرتے ہیں، اور اسٹاک خود بخود کم یا زیادہ ہو جاتا ہے۔',
    'cta.demo': 'ڈیمو کے لیے رابطہ کریں',
    'hero.p1': 'کسی بھی اینڈرائیڈ فون پر',
    'hero.p2': 'اردو اور انگریزی',
    'hero.p3': 'آپ کی تصدیق کے بغیر کچھ نہیں بدلتا',
    'hero.fig': 'المدینہ سینیٹری اسٹور کا ہاتھ سے لکھا بل اور ساتھ میں فون۔ فون پر بل کی ہر لائن کے اوپر تصویر کا وہی حصہ دکھایا گیا ہے؛ ایک لائن پر چیک کرنے کا نشان ہے اور لکھا ہے کہ لائن 5 شاید رہ گئی ہے۔',
    'hero.note': 'ہر لائن کے ساتھ اس کی اپنی تصویر',
    'ph.title': 'بل چیک کریں',
    'ph.read': n('5') + ' لائنیں پڑھی گئیں',
    'ph.tocheck': n('2') + ' چیک کرنی ہیں',
    'ph.ok': 'مل گیا',
    'ph.learned': 'یاد ہے',
    'ph.check': 'چیک کریں',
    'ph.miss': 'لائن ' + n('5') + ' شاید رہ گئی ہے: لائنوں کا جوڑ بل کے ٹوٹل کے برابر نہیں۔',
    'ph.confirm': 'تصدیق کریں · اسٹاک میں شامل',

    'how.k': 'یہ کیسے کام کرتا ہے',
    'how.h': 'تین قدم۔ بل ٹائپ کرنے کی ضرورت نہیں۔',
    'how.s1': 'تصویر لیں',
    'how.s1p': 'فون کے کیمرے سے، ایک بل کے ' + n('10') + ' صفحات تک۔ لمبے بل حصوں میں پڑھے جاتے ہیں، ہر حصہ اگلے سے تھوڑا جڑا ہوا۔',
    'how.s2': 'ہر لائن چیک کریں',
    'how.s2p': 'ہر لائن کے ساتھ تصویر کا وہی حصہ نظر آتا ہے۔ جس لائن پر AI کو یقین نہ ہو، یا جہاں ٹوٹل نہ ملے، وہاں نشان لگ جاتا ہے۔',
    'how.s3': 'اسٹاک اپڈیٹ',
    'how.s3p': 'ایک بار تصدیق کریں: خریداری سے اسٹاک بڑھتا ہے، سیل سے کم ہوتا ہے، اوسط لاگت اور ادھار کا حساب ہو جاتا ہے، اور رسید پرنٹ یا واٹس ایپ کے لیے تیار۔',
    'how.print': 'پرنٹ',
    'how.done': 'اسٹاک اپڈیٹ ہو گیا',

    'facts.aria': 'پروڈکٹ کے حقائق',
    'fact.pages': 'ایک بل کے صفحات تک، جڑے ہوئے حصوں میں پڑھے جاتے ہیں',
    'fact.roles': 'یوزر رولز، ہر ایک صرف اپنا حصہ دیکھتا ہے',
    'fact.langs': 'زبانیں: نستعلیق میں اردو، اور انگریزی',
    'fact.print': 'تھرمل رسید، یا A4 اور واٹس ایپ',

    'hw.k': 'اصل لکھائی کے لیے بنایا گیا',
    'hw.h': 'یہ آپ کی اپنی اسٹاک لسٹ سے ملا کر پڑھتا ہے، اور آخری فیصلہ آپ کا ہے۔',
    'hw.p': 'دکان کی لکھائی آسان نہیں: مختصر نام، انچ کے نشان، ہر سپلائر کے اپنے نام۔ اس لیے ایپ اندازے لگانے کے بجائے جو پڑھتی ہے اسے آپ کے کیٹلاگ میں پہلے سے موجود آئٹمز سے ملاتی ہے۔',
    'hw.a': 'آپ کے کیٹلاگ سے ملان',
    'hw.ap': 'لکھا ہوا <span class="nm nw">8 gang board</span> آپ کے اسٹاک کے <span class="nm nw">Switch Board 8-gang</span> سے مل جاتا ہے، اور ملتے جلتے آئٹمز بھی چننے کے لیے سامنے ہوتے ہیں۔',
    'hw.b': 'ہر سپلائر کے الفاظ یاد رکھتا ہے',
    'hw.bp': 'ایک بار ملان درست کریں، اگلی بار اس سپلائر کا وہ نام یاد رہے گا۔',
    'hw.c': 'ہر لائن کے ساتھ تصویر',
    'hw.cp': 'پڑھی گئی لائن کو اصل لکھائی سے لائن بہ لائن ملائیں، کاغذ کی طرف بار بار دیکھے بغیر۔',
    'hw.d': 'حساب کی جانچ',
    'hw.dp': 'مقدار × ریٹ کو رقم سے، لائنوں کو بل کے ٹوٹل سے ملایا جاتا ہے، اور لائن نمبر میں خلا ہو تو نشان لگتا ہے۔',
    'hw.fig': 'بل کی تصویر سے کٹا ہوا ہاتھ سے لکھا “8 gang board” کیٹلاگ کے آئٹم Switch Board 8-gang سے ملایا گیا اور المدینہ سینیٹری کے لیے یاد رکھا گیا۔ نیچے حساب دکھاتا ہے کہ لائنوں کا جوڑ 101,200 روپے ہے جبکہ بل کا ٹوٹل 146,200 روپے، اس لیے ایک لائن شاید رہ گئی ہے۔',
    'hw.ink': 'کاغذ پر',
    'hw.read': 'AI نے پڑھا',
    'hw.cat': 'آپ کے کیٹلاگ میں',
    'hw.rem': 'المدینہ سینیٹری کے لیے یاد رکھا گیا',
    'hw.rows': 'لائنوں کا جوڑ',
    'hw.total': 'بل کا ٹوٹل',
    'hw.flag': 'لائن ' + n('5') + ' شاید رہ گئی ہے۔ تصدیق سے پہلے دیکھ لیں۔',
    'hw.note': 'AI غلط بھی پڑھ سکتا ہے۔ اسی لیے آپ کی تصدیق کے بغیر اسٹاک نہیں بدلتا۔',

    'feat.k': 'کاؤنٹر کی ہر ضرورت',
    'feat.h': 'بل سے لے کر دن کے حساب تک، ایک ہی ایپ۔',
    'f1.h': 'اسکین اور AI',
    'f1.1': 'بل کی تصویر سے اسکین، ' + n('10') + ' صفحات تک',
    'f1.2': 'اردو، رومن اردو اور انگریزی بل',
    'f1.3': 'لمبے بل جڑے ہوئے حصوں میں پڑھے جاتے ہیں',
    'f1.4': 'درستی کرنے سے سپلائر کے نام یاد',
    'f1.5': 'ایک ہی بل دوبارہ آئے تو خبردار',
    'f1.6': 'تصویر نہ ہو تو بل ہاتھ سے درج کریں',
    'f2.h': 'اسٹاک اور رسیدیں',
    'f2.1': 'تصدیق پر اسٹاک اندر اور باہر',
    'f2.2': 'ہر آئٹم کی اوسط لاگت',
    'f2.3': 'کم اسٹاک کی اطلاع',
    'f2.4': n('58 / 80 mm') + ' تھرمل پرنٹر اور A4 کی رسید',
    'f2.5': 'رسید واٹس ایپ پر بھیجیں',
    'f2.6': 'واپسی، اسٹاک ایڈجسٹمنٹ، Excel سے اوپننگ اسٹاک',
    'f3.h': 'ادھار اور دن کا حساب',
    'f3.1': 'گاہکوں اور سپلائرز کا ادھار کھاتہ',
    'f3.2': 'وصولی اور سپلائر کو ادائیگی',
    'f3.3': 'آج کا حساب: دن کی بندش',
    'f3.4': 'گلے کی گنتی، کمی یا زیادتی کے ساتھ',
    'f3.5': 'اخراجات',
    'f3.6': 'ماہانہ منافع، اور ہر آئٹم یا کیٹیگری کا منافع',
    'f4.h': 'رپورٹس اور حفاظت',
    'f4.1': 'رپورٹس Excel اور CSV میں',
    'f4.2': 'رولز کے ساتھ یوزرز',
    'f4.3': 'روزانہ بیک اپ',
    'f4.4': 'مکمل ایکسپورٹ: ہر ریکارڈ اور ہر بل کی تصویر',
    'f4.5': 'ہر دکان کا ڈیٹا الگ',

    'scr.k': 'اصل اسکرینز',
    'scr.h': 'یہ ایپ کی اصل اسکرینز ہیں۔',
    'scr.note': 'ڈیمو دکان سے، فرضی ناموں اور رقموں کے ساتھ۔',
    'scr.region': 'ایپ کی اسکرینز، دائیں بائیں سکرول کریں',
    'scr.prev': 'پچھلی اسکرین',
    'scr.next': 'اگلی اسکرین',
    'scr.a1': 'ہوم اسکرین: اسٹاک کی مالیت، آج کی خرید و فروخت، آج کا منافع، خریداری یا سیل بل کی تصویر کے بٹن، اور کم اسٹاک کی فہرست۔',
    'scr.a2': 'تصدیق شدہ سیل بل جس میں ہر آئٹم کا اسٹاک پہلے اور بعد میں، ٹوٹل، ادا شدہ رقم اور ادھار دکھایا گیا ہے۔',
    'scr.a3': 'سیل کی تھرمل رسید، نیچے واٹس ایپ اور پرنٹ کے بٹن۔',
    'scr.a4': 'اردو میں AI بل ریڈنگ کی سیٹنگز: تصاویر بھیجنے کی اجازت، بل کون پڑھے، اور محفوظ کریں۔',
    'scr.a5': 'اردو میں “مزید” اسکرین: Excel اور CSV رپورٹس، اور مکمل ڈاؤن لوڈ کے ساتھ ڈیٹا کی حفاظت۔',
    'scr.c1': 'ہوم: اسٹاک کی مالیت، آج کی خرید و فروخت، کم اسٹاک',
    'scr.c2': 'سیل کے بعد: ہر آئٹم کا اسٹاک، پہلے ← بعد',
    'scr.c3': 'رسید، پرنٹ یا واٹس ایپ کے لیے تیار',
    'scr.c4': 'AI سیٹنگز اردو میں: فیصلہ مالک کا',
    'scr.c5': 'رپورٹس اور ڈیٹا کی حفاظت، اردو میں',

    'roles.k': 'رولز',
    'roles.h': 'کاؤنٹر پر ہر شخص صرف اپنا حصہ دیکھتا ہے۔',
    'r1.h': 'مالک',
    'r1.p': 'سب کچھ: قیمتیں، منافع، بل منسوخ کرنا، یوزرز، سیٹنگز اور مکمل ڈیٹا ایکسپورٹ۔',
    'r2.h': 'سیلز مین',
    'r2.p': 'سیل بل اور رسیدیں، گاہکوں سے وصولی، سیل کی واپسی، چھوٹے نقد اخراجات اور دن کی بندش۔',
    'r3.h': 'اسٹور کیپر',
    'r3.p': 'سپلائرز کے خریداری بل، اسٹاک اندر، اور خریداری کی واپسی۔',
    'r4.h': 'اکاؤنٹنٹ',
    'r4.p': 'کھاتے، دن کا خلاصہ، منافع اور رپورٹس، اسٹاک کو چھیڑے بغیر۔',
    'roles.note': 'اسٹاک کی مالیت اور منافع صرف مالک اور اکاؤنٹنٹ کو نظر آتے ہیں۔',

    'lang.k': 'اردو یا انگریزی',
    'lang.h': 'آپ کی زبان، صحیح سمت میں۔',
    'lang.p': 'مکمل اردو نستعلیق میں، دائیں سے بائیں، یا انگریزی۔ جب چاہیں بدلیں۔ رقم ہمیشہ انگریزی ہندسوں میں، جیسے بل پر لکھی ہوتی ہے۔',
    'ph2.k': 'آپ کے فون پر',
    'ph2.h': 'ایپ کی طرح انسٹال کریں۔ سگنل جائے تو بھی کام جاری۔',
    'ph2.p': 'براؤزر سے سیدھا ہوم اسکرین پر لگائیں، ایپ اسٹور کی ضرورت نہیں۔ اسکین کے دوران انٹرنیٹ چلا جائے تو بل فون پر محفوظ رہتا ہے اور انٹرنیٹ آتے ہی بھیج دیا جاتا ہے۔',
    'ph2.off': 'انٹرنیٹ نہیں: ' + n('1') + ' بل اس فون پر محفوظ',
    'ph2.on': 'انٹرنیٹ واپس: بل پڑھنے کے لیے بھیج دیا گیا',

    'safe.k': 'ڈیٹا کی حفاظت',
    'safe.h': 'آپ کی دکان کا ریکارڈ آپ ہی کا ہے۔',
    's1.h': 'روزانہ بیک اپ',
    's1.p': 'ہر رات پورے ڈیٹا بیس کا بیک اپ بنتا ہے، اور پچھلی کاپیاں بھی رکھی جاتی ہیں۔',
    's2.h': 'مکمل ایکسپورٹ، جب چاہیں',
    's2.p': 'مالک ہر ریکارڈ Excel میں، ہر بل کی تصویر کے ساتھ، ایک zip فائل میں ڈاؤن لوڈ کر سکتا ہے۔',
    's3.h': 'ہر دکان الگ',
    's3.p': 'ہر دکان کا ڈیٹا صرف اسکرین پر نہیں، ڈیٹا بیس کے اندر بھی الگ رکھا جاتا ہے۔',
    's4.h': 'AI کا فیصلہ آپ کا',
    's4.p': 'بل کی تصاویر مالک کی اجازت کے بعد ہی AI سروس کو جاتی ہیں۔ AI بند کر کے بل خود بھی درج کیے جا سکتے ہیں۔',

    'faq.k': 'سوالات',
    'faq.h': 'سیدھے جواب۔',
    'q1': 'کیا AI ہمیشہ درست پڑھتا ہے؟',
    'a1': 'نہیں۔ خراب لکھائی، تہہ شدہ کاغذ یا کم روشنی سے غلطی ہو سکتی ہے۔ اسی لیے ہر لائن اس کی تصویر کے ساتھ دکھائی جاتی ہے، مشکوک لائنوں اور نہ ملنے والے ٹوٹل پر نشان لگتا ہے، اور آپ کی تصدیق کے بغیر اسٹاک میں کچھ نہیں جاتا۔',
    'q2': 'شروع کرنے کے لیے کیا چاہیے؟',
    'a2': 'براؤزر اور انٹرنیٹ والا اسمارٹ فون۔ تھرمل پرنٹر (' + n('58') + ' یا ' + n('80 mm') + ') ضروری نہیں: رسید A4 پر بھی پرنٹ ہو سکتی ہے یا واٹس ایپ پر بھیجی جا سکتی ہے۔',
    'q3': 'انٹرنیٹ چلا جائے تو کیا ہو گا؟',
    'a3': 'اسکین کیا گیا بل فون پر محفوظ رہتا ہے اور انٹرنیٹ واپس آتے ہی خود بھیج دیا جاتا ہے۔ بل کا پڑھا جانا اور اسٹاک کی اپڈیٹ اس کے سرور تک پہنچنے کے بعد ہوتی ہے۔',
    'q4': 'کیا رسید FBR کا ٹیکس انوائس ہے؟',
    'a4': 'نہیں۔ رسید آپ کے گاہک اور آپ کے اپنے ریکارڈ کے لیے ہے، اور اس پر لکھا ہوتا ہے کہ یہ FBR سے تصدیق شدہ ٹیکس انوائس نہیں۔ ایپ FBR سے منسلک نہیں ہے۔',
    'q5': 'کیا میں اپنا موجودہ اسٹاک شامل کر سکتا ہوں؟',
    'a5': 'جی ہاں۔ Excel یا CSV ٹیمپلیٹ میں آئٹمز، مقدار اور لاگت بھریں۔ ایپ امپورٹ سے پہلے ہر لائن چیک کرتی ہے اور غلطیاں دکھاتی ہے۔',
    'q6': 'میرا منافع اور ڈیٹا کون دیکھ سکتا ہے؟',
    'a6': 'دکان کے اندر صرف وہ لوگ جنہیں آپ رول دیں، اور منافع صرف مالک اور اکاؤنٹنٹ کو۔ آپ کی دکان کا ڈیٹا ڈیٹا بیس میں دوسری دکانوں سے الگ رکھا جاتا ہے، روزانہ بیک اپ ہوتا ہے، اور آپ سارا ڈیٹا ایکسپورٹ کر سکتے ہیں۔',

    'ct.k': 'ڈیمو',
    'ct.h': 'اپنے ہی کاؤنٹر پر اسے چلتا دیکھیں۔',
    'ct.p': 'ڈیمو کے لیے Quantum Synergy Solutions سے رابطہ کریں۔ ہم آپ کے ساتھ ایک خریداری بل، ایک سیل اور دن کا حساب کر کے دکھائیں گے۔',
    'ct.empty': 'رابطے کی تفصیل جلد یہاں شامل کی جائے گی۔',
    'ct.already': 'پہلے سے استعمال کر رہے ہیں؟',
    'ct.whatsapp': 'واٹس ایپ',
    'ct.phone': 'فون',
    'ct.email': 'ای میل',
    'ct.address': 'پتہ',
    'ct.waText': 'السلام علیکم، مجھے Shop Inventory ERP – Photo Scan کا ڈیمو چاہیے۔',

    'foot.by': 'Shop Inventory ERP – Photo Scan، Quantum Synergy Solutions (QSSols) کی پروڈکٹ ہے۔',
    'foot.fbr': 'اس ایپ کی رسیدیں FBR سے تصدیق شدہ ٹیکس انوائس نہیں ہیں۔ ایپ FBR سے منسلک نہیں۔',
  };

  var EN_EXTRA = {
    'ct.whatsapp': 'WhatsApp', 'ct.phone': 'Phone', 'ct.email': 'Email', 'ct.address': 'Address',
    'ct.waText': 'Assalam o Alaikum, I would like a demo of Shop Inventory ERP – Photo Scan.',
  };

  // English originals are read from the page itself the first time.
  var orig = new Map();
  function keep(el, prop, get) { var m = orig.get(el) || {}; if (!(prop in m)) { m[prop] = get(); orig.set(el, m); } return m[prop]; }
  var lang = 'en';
  function t(key) { return lang === 'ur' && UR[key] != null ? UR[key] : EN_EXTRA[key]; }

  function apply(next) {
    lang = next;
    var ur = lang === 'ur';
    html.lang = ur ? 'ur' : 'en';
    html.dir = ur ? 'rtl' : 'ltr';

    document.querySelectorAll('[data-t]').forEach(function (el) {
      var en = keep(el, 'html', function () { return el.innerHTML; });
      var v = ur ? UR[el.dataset.t] : null;
      el.innerHTML = v != null ? v : en;
    });
    [['tAlt', 'alt'], ['tAria', 'aria-label']].forEach(function (p) {
      document.querySelectorAll('[data-' + (p[0] === 'tAlt' ? 't-alt' : 't-aria') + ']').forEach(function (el) {
        var en = keep(el, p[1], function () { return el.getAttribute(p[1]); });
        var v = ur ? UR[el.dataset[p[0]]] : null;
        el.setAttribute(p[1], v != null ? v : en);
      });
    });
    var title = keep(document, 'title', function () { return document.title; });
    document.title = ur ? UR['meta.title'] : title;
    var desc = document.querySelector('meta[name="description"]');
    var d = keep(desc, 'content', function () { return desc.content; });
    desc.content = ur ? UR['meta.desc'] : d;
    var brand = document.querySelector('.brand');
    var ba = keep(brand, 'aria', function () { return brand.getAttribute('aria-label'); });
    brand.setAttribute('aria-label', ur ? UR['brand.aria'] : ba);
    var menu = document.querySelector('.menu');
    var ma = keep(menu, 'aria', function () { return menu.getAttribute('aria-label'); });
    menu.setAttribute('aria-label', ur ? UR['nav.aria'] : ma);

    var btn = document.getElementById('langBtn');
    btn.textContent = ur ? 'English' : 'اردو';
    btn.lang = ur ? 'en' : 'ur';

    renderContact();
    html.classList.remove('ur-wait');
  }

  // ---- contact rows from CONTACT (empty ones are hidden) ----
  var ICON = {
    whatsapp: '<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c.3 2.4 2.1 4.2 4.5 4.5l1-1.4 2 .9c-.2 1.3-1.2 2-2.5 2A6 6 0 0 1 8 9.5C8 8.2 8.7 7.2 10 7l.9 2z"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    address: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function digits(s) { return String(s).replace(/[^\d+]/g, ''); }
  function renderContact() {
    var list = document.getElementById('ctList');
    var empty = document.getElementById('ctEmpty');
    var rows = [];
    ['whatsapp', 'phone', 'email', 'address'].forEach(function (k) {
      var v = (CONTACT[k] || '').trim();
      if (!v) return;
      var href = null;
      if (k === 'whatsapp') href = 'https://wa.me/' + digits(v).replace(/^\+/, '') + '?text=' + encodeURIComponent(t('ct.waText'));
      if (k === 'phone') href = 'tel:' + digits(v);
      if (k === 'email') href = 'mailto:' + v;
      var inner = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[k] + '</svg><span><small>' + esc(t('ct.' + k)) + '</small><span class="v' + (k === 'address' ? '' : ' ltr') + '">' + esc(v) + '</span></span>';
      rows.push('<li>' + (href ? '<a href="' + esc(href) + '"' + (k === 'whatsapp' ? ' target="_blank" rel="noopener"' : '') + '>' + inner + '</a>' : '<div class="ct-row">' + inner + '</div>') + '</li>');
    });
    list.innerHTML = rows.join('');
    list.hidden = rows.length === 0;
    empty.hidden = rows.length > 0;
  }

  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function store(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode: fine */ } }

  // ---- motion helpers ----
  var mq = function (q) { return window.matchMedia ? window.matchMedia(q) : { matches: false }; };
  var reduced = mq('(prefers-reduced-motion: reduce)').matches;
  var finePointer = mq('(hover: hover) and (pointer: fine)').matches;
  var hasIO = 'IntersectionObserver' in window;
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  function watch(el, cb, opts) { // calls cb(isVisible) as el enters / leaves the viewport
    if (!hasIO) { cb(true); return; }
    new IntersectionObserver(function (es) { es.forEach(function (e) { cb(e.isIntersecting); }); }, opts || { rootMargin: '80px 0px' }).observe(el);
  }

  // ---- hero: scan beam sweeps the bill, each row lights up and flies into the phone ----
  function hero() {
    var stage = document.querySelector('.stage');
    if (!stage) return;
    var rows = Array.prototype.slice.call(stage.querySelectorAll('.rowhl'));
    var cards = {};
    stage.querySelectorAll('.p-lines [data-row]').forEach(function (c) { cards[c.dataset.row] = c; });
    var beam = stage.querySelector('.beam'), layer = stage.querySelector('.fly-layer'), cta = stage.querySelector('.p-cta');
    var all = Object.keys(cards).map(function (k) { return cards[k]; });

    if (reduced || !beam.animate) { all.forEach(function (c) { c.classList.add('on', 'landed'); }); return; }

    var paused = false, visible = true, anims = [];
    function track(a) { anims.push(a); var drop = function () { anims = anims.filter(function (x) { return x !== a; }); }; a.finished.then(drop, drop); return a; }
    function setPaused(p) { if (p === paused) return; paused = p; anims.forEach(function (a) { if (p) a.pause(); else a.play(); }); }
    var sync = function () { setPaused(!visible || document.hidden); };
    watch(stage, function (v) { visible = v; sync(); }, { threshold: 0 });
    document.addEventListener('visibilitychange', sync);
    // a timer that stands still while the hero is off-screen or the tab is hidden
    function wait(ms) {
      return new Promise(function (res) {
        var left = ms, last = performance.now();
        (function tick(now) { if (!paused) left -= now - last; last = now; if (left <= 0) res(); else requestAnimationFrame(tick); })(last);
      });
    }

    var Y0 = 0.19, Y1 = 0.62, D = 3600, H = 0.0561; // beam travel (fractions of the bill height); row height from purchase-bill.json bbox
    function land(card) { card.classList.remove('hold'); card.classList.add('landed'); }
    function fly(row, card) {
      var crop = card.querySelector('.crop');
      // show the card in its final place without the rise, keep its photo strip empty until the clone lands
      card.style.transition = 'none';
      card.classList.add('on', 'hold', 'pre');
      var tr = crop.getBoundingClientRect(), sr = row.getBoundingClientRect(), st = stage.getBoundingClientRect();
      void card.offsetWidth;
      card.style.transition = '';
      card.classList.remove('pre');
      var f = document.createElement('span');
      f.className = 'fly';
      f.style.cssText = 'width:' + tr.width + 'px;height:' + tr.height + 'px;left:' + (tr.left - st.left) + 'px;top:' + (tr.top - st.top) + 'px;--y:' + crop.style.getPropertyValue('--y');
      layer.appendChild(f);
      var dx = sr.left - tr.left, dy = sr.top - tr.top, sx = sr.width / tr.width, sy = sr.height / tr.height;
      var from = 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')';
      var mid = 'translate(' + dx * 0.45 + 'px,' + (dy * 0.45 - 46) + 'px) scale(' + (sx + 1) / 2 * 1.08 + ',' + (sy + 1) / 2 * 1.08 + ')';
      var a = track(f.animate([
        { transform: from, opacity: 0 },
        { transform: from, opacity: 1, offset: 0.12 },
        { transform: mid, opacity: 1, offset: 0.55 },
        { transform: 'none', opacity: 1 },
      ], { duration: 900, easing: 'cubic-bezier(.55,0,.25,1)' }));
      var done = function () { f.remove(); land(card); };
      a.finished.then(done, done);
    }

    var canFly = function () { return window.innerWidth >= 700; };
    async function cycle() {
      rows.forEach(function (r) { r.classList.remove('on'); });
      all.forEach(function (c) { c.classList.remove('on', 'landed', 'hold'); });
      cta.classList.remove('pulse');
      await wait(650);
      track(beam.animate([
        { transform: 'translateY(' + Y0 * 100 + '%)', opacity: 0 },
        { opacity: 1, offset: 0.06 },
        { opacity: 1, offset: 0.92 },
        { transform: 'translateY(' + Y1 * 100 + '%)', opacity: 0 },
      ], { duration: D, easing: 'linear' }));
      var elapsed = 0;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var centre = parseFloat(r.style.getPropertyValue('--t')) / 100 + H / 2;
        var hit = (centre - Y0) / (Y1 - Y0) * D;
        await wait(hit - elapsed); elapsed = hit;
        r.classList.add('on');
        var card = cards[r.dataset.row];
        if (!card) continue;
        if (r.classList.contains('miss')) { (function (c) { wait(350).then(function () { c.classList.add('on'); }); })(card); }
        else if (canFly()) fly(r, card);
        else { card.classList.add('on'); land(card); }
      }
      await wait(D - elapsed + 500);
      cta.classList.add('pulse');
      await wait(4200);
    }
    (async function loop() { for (;;) await cycle(); })();

    // gentle mouse parallax on desktop
    if (finePointer) {
      var heroEl = stage.closest('.hero'), tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
      var step = function () {
        cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
        stage.style.setProperty('--px', cx.toFixed(3)); stage.style.setProperty('--py', cy.toFixed(3));
        raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.002 ? requestAnimationFrame(step) : 0;
      };
      var kick = function () { if (!raf) raf = requestAnimationFrame(step); };
      heroEl.addEventListener('pointermove', function (e) {
        if (window.innerWidth < 1000) return;
        tx = clamp(e.clientX / window.innerWidth * 2 - 1, -1, 1); ty = clamp(e.clientY / window.innerHeight * 2 - 1, -1, 1); kick();
      });
      heroEl.addEventListener('pointerleave', function () { tx = 0; ty = 0; kick(); });
    }
  }

  // ---- "How it works": sticky phone follows the steps, progress line fills ----
  function how() {
    var wrap = document.querySelector('.steps-wrap'), phone = document.querySelector('.how-phone .phone');
    if (!wrap || !phone) return;
    var steps = Array.prototype.slice.call(wrap.querySelectorAll('.step')), fill = wrap.querySelector('.prog-fill');
    var current = -1, raf = 0;
    function update() {
      raf = 0;
      var vh = window.innerHeight, r = wrap.getBoundingClientRect(), idx = 0;
      var tops = steps.map(function (s) { var b = s.getBoundingClientRect(); return b.top + b.height / 2; });
      tops.forEach(function (c, i) { if (c < vh * 0.62) idx = i; });
      fill.style.transform = 'scaleY(' + clamp((vh * 0.5 - r.top) / r.height, 0, 1).toFixed(4) + ')';
      if (idx !== current) {
        current = idx;
        phone.setAttribute('data-screen', String(idx));
        steps.forEach(function (s, i) { s.classList.toggle('active', i === idx); });
      }
    }
    var onScroll = function () { if (!raf) raf = requestAnimationFrame(update); };
    var on = false;
    watch(wrap, function (v) {
      if (v && !on) { window.addEventListener('scroll', onScroll, { passive: true }); on = true; onScroll(); }
      else if (!v && on) { window.removeEventListener('scroll', onScroll); on = false; }
    }, { rootMargin: '100px 0px' });
    window.addEventListener('resize', onScroll);
    update();
  }

  // ---- real screens: 3D carousel ----
  function carousel() {
    var box = document.querySelector('.shots');
    if (!box) return;
    var items = Array.prototype.slice.call(box.children), dots = document.querySelectorAll('.sn-dots i'), best = 0, raf = 0;
    function update() {
      raf = 0;
      var c = box.getBoundingClientRect(), cx = c.left + c.width / 2, bd = Infinity;
      var ds = items.map(function (it, i) {
        var r = it.getBoundingClientRect(), d = (r.left + r.width / 2 - cx) / r.width;
        if (Math.abs(d) < bd) { bd = Math.abs(d); best = i; }
        return d;
      });
      ds.forEach(function (d, i) {
        items[i].style.setProperty('--d', clamp(d, -2, 2).toFixed(3));
        items[i].style.setProperty('--ad', Math.min(1.5, Math.abs(d)).toFixed(3));
      });
      dots.forEach(function (dot, i) { dot.classList.toggle('on', i === best); });
    }
    function go(i, smooth) {
      i = clamp(i, 0, items.length - 1);
      var c = box.getBoundingClientRect(), r = items[i].getBoundingClientRect();
      box.scrollBy({ left: (r.left + r.width / 2) - (c.left + c.width / 2), behavior: smooth && !reduced ? 'smooth' : 'auto' });
    }
    box.addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
    window.addEventListener('resize', function () { if (!raf) raf = requestAnimationFrame(update); });
    document.getElementById('shotPrev').addEventListener('click', function () { go(best - 1, true); });
    document.getElementById('shotNext').addEventListener('click', function () { go(best + 1, true); });
    go(Math.floor(items.length / 2), false);
    update();
  }

  // ---- FAQ: smooth open / close (native <details> without JS) ----
  function faq() {
    if (reduced) return;
    document.querySelectorAll('.faq details').forEach(function (d) {
      var s = d.querySelector('summary'), a = d.querySelector('.faq-a');
      if (!d.animate) return;
      s.addEventListener('click', function (e) {
        e.preventDefault();
        if (d._anim) d._anim.cancel();
        var opts = { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' };
        var h0 = d.offsetHeight;
        if (!d.open) {
          d.open = true;
          var h1 = d.offsetHeight;
          d._anim = d.animate({ height: [h0 + 'px', h1 + 'px'] }, opts);
          a.animate({ opacity: [0, 1], transform: ['translateY(-6px)', 'none'] }, opts);
          d._anim.onfinish = function () { d._anim = null; };
        } else {
          var h2 = s.offsetHeight + 2;
          d._anim = d.animate({ height: [h0 + 'px', h2 + 'px'] }, opts);
          d._anim.onfinish = function () { d.open = false; d._anim = null; };
        }
      });
    });
  }

  // ---- counters for the product facts ----
  function counters() {
    var els = document.querySelectorAll('.count');
    if (!els.length || reduced || !hasIO) return;
    var box = document.querySelector('.facts');
    els.forEach(function (el) { el.textContent = '0'; });
    var started = false;
    watch(box, function (v) {
      if (!v || started) return;
      started = true;
      var t0 = performance.now(), dur = 1400;
      (function tick(now) {
        var p = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - p, 3);
        els.forEach(function (el) { el.textContent = String(Math.round(+el.dataset.to * e)); });
        if (p < 1) requestAnimationFrame(tick);
      })(t0);
    }, { threshold: 0.4 });
  }

  // ---- pointer effects: glow that follows the cursor on cards, magnetic buttons ----
  function pointerFx() {
    if (!finePointer) return;
    document.addEventListener('pointermove', function (e) {
      var card = e.target.closest && e.target.closest('.card');
      if (!card) return;
      var r = card.getBoundingClientRect();
      card.style.setProperty('--px', (e.clientX - r.left) + 'px');
      card.style.setProperty('--py', (e.clientY - r.top) + 'px');
    }, { passive: true });
    if (reduced) return;
    document.querySelectorAll('.magnetic').forEach(function (b) {
      b.addEventListener('pointermove', function (e) {
        var r = b.getBoundingClientRect();
        b.style.transform = 'translate(' + ((e.clientX - r.left - r.width / 2) * 0.22).toFixed(1) + 'px,' + ((e.clientY - r.top - r.height / 2) * 0.3).toFixed(1) + 'px)';
      });
      b.addEventListener('pointerleave', function () { b.style.transform = ''; });
    });
  }

  function init() {
    apply(stored() === 'ur' ? 'ur' : 'en');
    document.getElementById('langBtn').addEventListener('click', function () {
      var next = lang === 'ur' ? 'en' : 'ur';
      apply(next);
      store(next);
    });

    var yr = document.getElementById('yr');
    if (yr) yr.textContent = String(Math.max(2026, new Date().getFullYear()));

    var top = document.querySelector('.top');
    var onScroll = function () { top.classList.toggle('scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // pause CSS animations of sections that are off-screen
    document.querySelectorAll('[data-anim]').forEach(function (el) { watch(el, function (v) { el.classList.toggle('off', !v); }); });

    // scroll reveal, staggered among siblings
    var reveals = document.querySelectorAll('.reveal');
    reveals.forEach(function (el) {
      var i = 0, p = el.previousElementSibling;
      while (p) { if (p.classList.contains('reveal')) i++; p = p.previousElementSibling; }
      el.style.setProperty('--d', Math.min(i, 5) * 90 + 'ms');
    });
    if (!hasIO || reduced) reveals.forEach(function (el) { el.classList.add('in'); });
    else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      reveals.forEach(function (el) { io.observe(el); });
    }

    hero();
    how();
    carousel();
    faq();
    counters();
    pointerFx();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
