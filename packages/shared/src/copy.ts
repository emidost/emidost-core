// Copy rules for every string in emidost, compressed from the humanizer and
// no-ai-slop skills. Apply to UI text, notifications, and voice scripts.

export const COPY_RULES = [
  'Lead with the point: the action or amount comes first.',
  'Sentence case everywhere, including buttons and titles.',
  'Active voice, present tense.',
  'No em or en dashes. Commas and periods only.',
  'No "not X but Y" pivots.',
  'No staged openers: no "Welcome to", "Let us", "Get started with".',
  'No one-line closers or moral-of-the-story endings.',
  'No forced triads, no padding adjectives.',
  'Concrete verbs only: pay, lock, call, add.',
  'Numbers with units: Rs 2,400 due, 3 days overdue.',
  'No "simply", "just", "easily", "seamless", "critical".',
  'One message per screen; the primary action is the first thing read.',
] as const;

export function rewriteExample(): string {
  // Kept as a living example of the rules in practice.
  return 'Pay Rs 2,400 by 15 June. The phone stays locked until payment.';
}

/** Voice script tones carried from the earlier project: Bengali and Hindi. */
export const VOICE_LANGS = ['bn', 'hi', 'en'] as const;

export function dueReminderCopy(due: string, amount: string, daysOverdue: number): { bn: string; hi: string; en: string } {
  const en = daysOverdue > 0
    ? `${amount} was due on ${due}. The phone stays locked until payment. Call your retailer with questions.`
    : `${amount} is due on ${due}. Pay on time to keep the phone unlocked.`;
  return {
    en,
    bn: 'আপনার কিস্তি বাকি। দয়া করে সময়মতো পরিশোধ করুন।',
    hi: 'आपकी किस्त बकाया है। कृपया समय पर भुगतान करें।',
  };
}

/** Overdue escalation voice lines (30-min audio alerts + retailer ALERT command). */
export function overdueVoiceCopy(): { bn: string; hi: string; en: string } {
  return {
    en: 'Your EMI is overdue.',
    bn: 'আপনার EMI বকেয়া আছে',
    hi: 'आपकी EMI बकाया है',
  };
}

/** Friendly retailer-triggered reminder voice (REMIND command + SMS), distinct from the urgent overdue tone. */
export function reminderVoiceCopy(): { bn: string; hi: string; en: string } {
  return {
    en: 'Your EMI instalment is due.',
    bn: 'আপনার EMI কিস্তি বাকি আছে',
    hi: 'आपकी EMI किस्त बाकी है',
  };
}

/** Reminder wallpaper text (SET_WALLPAPER). Short, fits a lock-screen wallpaper;
 *  the customer app composes this and hands it to the native wallpaper renderer. */
export function wallpaperReminderCopy(amount: string, due: string, daysOverdue: number): { bn: string; hi: string; en: string } {
  const en = daysOverdue > 0
    ? `EMI overdue by ${daysOverdue} ${daysOverdue === 1 ? 'day' : 'days'}. Pay ${amount}, due ${due}.`
    : `EMI due ${due}. Pay ${amount} on time.`;
  return {
    en,
    bn: `EMI বকেয়া। ${amount} পরিশোধ করুন, শেষ তারিখ ${due}।`,
    hi: `EMI बकाया। ${amount} का भुगतान करें, तारीख ${due}।`,
  };
}

/** Bengali-first nudge shown when a retailer creates a customer with no EMI
 *  record: recording the EMI turns on automatic overdue protection. */
export function recordEmiNudgeCopy(): { bn: string; hi: string; en: string } {
  return {
    bn: 'EMI রেকর্ড করলে কিস্তি বকেয়া হলে ফোন নিজে থেকে লক হবে। রেকর্ড না করলে শুধু আপনি নিজে ফোন লক করতে পারবেন।',
    hi: 'EMI रिकॉर्ड करने पर किस्त बकाया होने पर फोन खुद लॉक होगा। रिकॉर्ड न करने पर केवल आप खुद फोन लॉक कर सकते हैं।',
    en: 'Record the EMI to auto-lock the phone when payments are overdue. Without it, only you can lock it manually.',
  };
}

export type CopyLang = 'en' | 'bn' | 'hi';

export interface LockCopyParams {
  /** Pre-formatted amount, for example "Rs 2,400". */
  amount: string;
  /** Human due date, for example "15 June". */
  dueDate: string;
  retailerPhone: string;
  overdueDays: number;
  /** Set once a payment has been received. */
  paidOn?: string;
  /** The date the phone stays unlocked until. */
  paidUntil?: string;
}

/** Button and link labels, verb-first and in sentence case. */
export interface LockActions {
  payNow: string;
  callRetailer: string;
  emergency: string;
}

export interface LockStrings {
  locked: string;
  overdue: string;
  unlocked: string;
  paid: string;
  actions: LockActions;
}

/**
 * Lock-screen copy for the customer app, the source of truth from spec section
 * 6 in en, bn and hi. Sentence case, verb-first, no em or en dashes.
 */
export function lockScreenCopy(lang: CopyLang, p: LockCopyParams): LockStrings {
  const days = (n: number, one: string, many: string) => (n === 1 ? one : many);
  if (lang === 'bn') {
    return {
      locked: `আপনার ফোন আনলক করতে ${p.amount} পরিশোধ করুন। পেমেন্টের শেষ তারিখ ছিল ${p.dueDate}। সাহায্যের জন্য আপনার রিটেইলারকে ${p.retailerPhone} নম্বরে কল করুন।`,
      overdue: `এখনই ${p.amount} পরিশোধ করুন। আপনার পেমেন্ট ${p.overdueDays} দিন বকেয়া।`,
      unlocked: `${p.paidOn ?? ''} তারিখে পেমেন্ট পাওয়া গেছে। আপনার ফোন ${p.paidUntil ?? ''} পর্যন্ত আনলক থাকবে।`,
      paid: 'ঋণ সম্পূর্ণ। ফোনটি এখন আপনার।',
      actions: { payNow: 'এখন পরিশোধ করুন', callRetailer: 'রিটেইলারকে কল করুন', emergency: '112 এ কল করুন' },
    };
  }
  if (lang === 'hi') {
    return {
      locked: `अपना फोन अनलॉक करने के लिए ${p.amount} का भुगतान करें। भुगतान की आखिरी तारीख ${p.dueDate} थी। मदद के लिए अपने रिटेलर को ${p.retailerPhone} पर कॉल करें।`,
      overdue: `अभी ${p.amount} का भुगतान करें। आपका भुगतान ${p.overdueDays} दिन बकाया है।`,
      unlocked: `${p.paidOn ?? ''} को भुगतान मिल गया। आपका फोन ${p.paidUntil ?? ''} तक अनलॉक रहेगा।`,
      paid: 'कर्ज पूरा हुआ। अब फोन आपका है।',
      actions: { payNow: 'अभी भुगतान करें', callRetailer: 'रिटेलर को कॉल करें', emergency: '112 पर कॉल करें' },
    };
  }
  return {
    locked: `Pay ${p.amount} to unlock your phone. The payment was due on ${p.dueDate}. Call your retailer on ${p.retailerPhone} for help.`,
    overdue: `Pay ${p.amount} now. Your payment is ${p.overdueDays} ${days(p.overdueDays, 'day', 'days')} overdue.`,
    unlocked: `Payment received on ${p.paidOn ?? ''}. Your phone stays unlocked until ${p.paidUntil ?? ''}.`,
    paid: 'Loan complete. Your phone is yours.',
    actions: { payNow: 'Pay now', callRetailer: 'Call retailer', emergency: 'Call 112' },
  };
}
