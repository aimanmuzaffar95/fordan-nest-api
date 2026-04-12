export const CUSTOMER_ACQUISITION_SOURCE_VALUES = [
  'organic_search',
  'paid_search',
  'social_media',
  'website_form',
  'phone_inquiry',
  'partner_referral',
  'event_trade_show',
  'cold_outreach',
  'word_of_mouth',
  'other',
] as const;

export type CustomerAcquisitionSource =
  (typeof CUSTOMER_ACQUISITION_SOURCE_VALUES)[number];
