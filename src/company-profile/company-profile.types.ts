export type CompanyProfileSettings = {
  legalName: string;
  tradingName: string | null;
  abn: string | null;
  acn: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  websiteUrl: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  timezone: string;
  currency: string;
};
