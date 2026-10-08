/**
 * The onboarding journey as shown in staff emails. Index = how far the
 * recipient has got; everything before it is done, the index itself is the
 * step they are being asked to take now.
 */
export const ONBOARDING_STAGES = [
  { title: 'Invitation', hint: 'You have been invited to join the team.' },
  {
    title: 'Employee form',
    hint: 'Fill in your personal, bank and emergency details.',
  },
  {
    title: 'Training',
    hint: 'Log in and complete your required training modules.',
  },
  { title: 'Ready to work', hint: 'Your manager will assign your first jobs.' },
] as const;

export type OnboardingStageIndex = 0 | 1 | 2 | 3;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline-styled HTML block (email-safe) listing the stages with the current one highlighted. */
export function onboardingStagesHtml(current: OnboardingStageIndex): string {
  const rows = ONBOARDING_STAGES.map((stage, i) => {
    const done = i < current;
    const now = i === current;
    const badge = done
      ? '<span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:11px;background:#2e7d32;color:#fff;font-size:12px;font-weight:700;text-align:center;">&#10003;</span>'
      : `<span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:11px;background:${now ? '#855300' : '#e6e0d8'};color:${now ? '#fff' : '#8a7a68'};font-size:12px;font-weight:700;text-align:center;">${i + 1}</span>`;
    const color = now ? '#1f1a14' : done ? '#2e7d32' : '#8a7a68';
    const label = `${esc(stage.title)}${now ? ' &mdash; <em>you are here</em>' : ''}`;
    return `<tr><td style="padding:6px 10px 6px 0;vertical-align:top;">${badge}</td><td style="padding:6px 0;font-size:14px;line-height:1.5;color:${color};${now ? 'font-weight:700;' : ''}">${label}${now ? `<br><span style="font-weight:400;font-size:13px;color:#534434;">${esc(stage.hint)}</span>` : ''}</td></tr>`;
  });
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;border:1px solid #e6e0d8;border-radius:10px;padding:12px 16px;">
<tr><td colspan="2" style="padding:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#534434;">Your onboarding — step ${current + 1} of ${ONBOARDING_STAGES.length}</td></tr>
${rows.join('\n')}
</table>`;
}

/** Plain-text twin for the text/plain part. */
export function onboardingStagesText(current: OnboardingStageIndex): string {
  return ONBOARDING_STAGES.map((stage, i) => {
    const mark = i < current ? '[x]' : i === current ? '[>]' : '[ ]';
    return `${mark} ${i + 1}. ${stage.title}${i === current ? ' — you are here. ' + stage.hint : ''}`;
  }).join('\n');
}
