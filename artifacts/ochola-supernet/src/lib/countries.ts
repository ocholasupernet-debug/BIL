/* Country + currency registry for ISPlatty multi-country support */

export interface CountryInfo {
  name: string;       // display name
  code: string;       // ISO 3166-1 alpha-2
  currency: string;   // ISO 4217 currency code
  symbol: string;     // short display prefix (e.g. "Ksh", "$")
  locale: string;     // BCP-47 locale for Intl.NumberFormat
  phone: string;      // dial prefix (for placeholder hints)
}

export const COUNTRIES: CountryInfo[] = [
  { name: "Kenya",         code: "KE", currency: "KES", symbol: "Ksh",  locale: "en-KE", phone: "+254" },
  { name: "Uganda",        code: "UG", currency: "UGX", symbol: "USh",  locale: "en-UG", phone: "+256" },
  { name: "Tanzania",      code: "TZ", currency: "TZS", symbol: "TSh",  locale: "sw-TZ", phone: "+255" },
  { name: "Rwanda",        code: "RW", currency: "RWF", symbol: "RF",   locale: "en-RW", phone: "+250" },
  { name: "Ethiopia",      code: "ET", currency: "ETB", symbol: "ETB",  locale: "am-ET", phone: "+251" },
  { name: "Nigeria",       code: "NG", currency: "NGN", symbol: "₦",   locale: "en-NG", phone: "+234" },
  { name: "Ghana",         code: "GH", currency: "GHS", symbol: "GH₵", locale: "en-GH", phone: "+233" },
  { name: "South Africa",  code: "ZA", currency: "ZAR", symbol: "R",   locale: "en-ZA", phone: "+27"  },
  { name: "Zambia",        code: "ZM", currency: "ZMW", symbol: "ZK",  locale: "en-ZM", phone: "+260" },
  { name: "Zimbabwe",      code: "ZW", currency: "USD", symbol: "$",   locale: "en-ZW", phone: "+263" },
  { name: "Malawi",        code: "MW", currency: "MWK", symbol: "MK",  locale: "en-MW", phone: "+265" },
  { name: "Mozambique",    code: "MZ", currency: "MZN", symbol: "MT",  locale: "pt-MZ", phone: "+258" },
  { name: "Cameroon",      code: "CM", currency: "XAF", symbol: "FCFA",locale: "fr-CM", phone: "+237" },
  { name: "Senegal",       code: "SN", currency: "XOF", symbol: "CFA", locale: "fr-SN", phone: "+221" },
  { name: "Côte d'Ivoire", code: "CI", currency: "XOF", symbol: "CFA", locale: "fr-CI", phone: "+225" },
  { name: "Egypt",         code: "EG", currency: "EGP", symbol: "E£",  locale: "ar-EG", phone: "+20"  },
  { name: "Morocco",       code: "MA", currency: "MAD", symbol: "DH",  locale: "ar-MA", phone: "+212" },
  { name: "United States", code: "US", currency: "USD", symbol: "$",   locale: "en-US", phone: "+1"   },
  { name: "United Kingdom",code: "GB", currency: "GBP", symbol: "£",   locale: "en-GB", phone: "+44"  },
  { name: "European Union",code: "EU", currency: "EUR", symbol: "€",   locale: "en-IE", phone: ""     },
  { name: "India",         code: "IN", currency: "INR", symbol: "₹",   locale: "en-IN", phone: "+91"  },
  { name: "Canada",        code: "CA", currency: "CAD", symbol: "CA$", locale: "en-CA", phone: "+1"   },
  { name: "Australia",     code: "AU", currency: "AUD", symbol: "A$",  locale: "en-AU", phone: "+61"  },
];

export function getCountryByName(name: string): CountryInfo | undefined {
  return COUNTRIES.find(c => c.name.toLowerCase() === name.toLowerCase());
}

export function getCountryByCurrency(currency: string): CountryInfo | undefined {
  return COUNTRIES.find(c => c.currency === currency);
}

/** Default country (Kenya) */
export const DEFAULT_COUNTRY = COUNTRIES[0];
