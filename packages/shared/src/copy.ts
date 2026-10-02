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
