/**
 * The fixed lists that the synthetic dataset draws from. Nothing here is real data about a person.
 *
 * - Institutions are made up: every name starts with "Synthetic", so none can be taken for a real school
 *   that the Ministry has a relationship with.
 * - Amounts are in CFA francs (XAF, which has no smaller unit, so every amount is a whole number). They are
 *   plausible in size and are NOT the Ministry's rates. The payment module replaces them with the real scales.
 * - Phone numbers are built so that no operator can have issued them: the national part always starts with 000.
 */

export interface SyntheticCountry {
  readonly code: string;
  readonly name: string;
  /** The international dialling code, without the plus. */
  readonly callingCode: string;
  /** What one term of the allowance is, in XAF. */
  readonly allowancePerTermXaf: number;
}

export const COUNTRIES: readonly SyntheticCountry[] = [
  { code: "FR", name: "France", callingCode: "33", allowancePerTermXaf: 450_000 },
  { code: "CA", name: "Canada", callingCode: "1", allowancePerTermXaf: 525_000 },
  { code: "DE", name: "Germany", callingCode: "49", allowancePerTermXaf: 450_000 },
  { code: "BE", name: "Belgium", callingCode: "32", allowancePerTermXaf: 450_000 },
  { code: "MA", name: "Morocco", callingCode: "212", allowancePerTermXaf: 300_000 },
  { code: "CN", name: "China", callingCode: "86", allowancePerTermXaf: 375_000 },
  { code: "TR", name: "Turkey", callingCode: "90", allowancePerTermXaf: 375_000 },
  { code: "SN", name: "Senegal", callingCode: "221", allowancePerTermXaf: 300_000 },
];

export interface SyntheticInstitutionTemplate {
  readonly countryCode: string;
  readonly city: string;
  readonly kind: string;
  /** What a year of tuition is, in XAF, when the institution charges it. Zero when it does not. */
  readonly tuitionPerYearXaf: number;
}

export const INSTITUTIONS: readonly SyntheticInstitutionTemplate[] = [
  { countryCode: "FR", city: "Lyon", kind: "University", tuitionPerYearXaf: 0 },
  { countryCode: "FR", city: "Toulouse", kind: "Institute of Technology", tuitionPerYearXaf: 1_200_000 },
  { countryCode: "FR", city: "Lille", kind: "School of Medicine", tuitionPerYearXaf: 0 },
  { countryCode: "CA", city: "Montreal", kind: "University", tuitionPerYearXaf: 1_500_000 },
  { countryCode: "CA", city: "Quebec", kind: "School of Business", tuitionPerYearXaf: 1_500_000 },
  { countryCode: "CA", city: "Ottawa", kind: "Institute of Technology", tuitionPerYearXaf: 1_500_000 },
  { countryCode: "DE", city: "Munich", kind: "Institute of Technology", tuitionPerYearXaf: 0 },
  { countryCode: "DE", city: "Hamburg", kind: "University", tuitionPerYearXaf: 0 },
  { countryCode: "BE", city: "Liege", kind: "University", tuitionPerYearXaf: 700_000 },
  { countryCode: "BE", city: "Ghent", kind: "School of Business", tuitionPerYearXaf: 700_000 },
  { countryCode: "MA", city: "Rabat", kind: "School of Medicine", tuitionPerYearXaf: 600_000 },
  { countryCode: "MA", city: "Casablanca", kind: "Institute of Technology", tuitionPerYearXaf: 600_000 },
  { countryCode: "CN", city: "Wuhan", kind: "University", tuitionPerYearXaf: 0 },
  { countryCode: "CN", city: "Hangzhou", kind: "Institute of Technology", tuitionPerYearXaf: 0 },
  { countryCode: "TR", city: "Ankara", kind: "University", tuitionPerYearXaf: 0 },
  { countryCode: "TR", city: "Izmir", kind: "School of Medicine", tuitionPerYearXaf: 0 },
  { countryCode: "SN", city: "Dakar", kind: "University", tuitionPerYearXaf: 400_000 },
  { countryCode: "SN", city: "Saint-Louis", kind: "Institute of Technology", tuitionPerYearXaf: 400_000 },
];

export const FIELDS_OF_STUDY: readonly string[] = [
  "Medicine",
  "Pharmacy",
  "Civil engineering",
  "Computer science",
  "Electrical engineering",
  "Law",
  "Economics",
  "Agronomy",
  "Physics",
  "Architecture",
  "Education sciences",
  "Public health",
];

/** One instalment of the allowance is paid per term; the three terms of an academic year start in October. */
export const TERMS: readonly { readonly label: string; readonly month: number; readonly yearOffset: 0 | 1 }[] = [
  { label: "T1", month: 10, yearOffset: 0 },
  { label: "T2", month: 1, yearOffset: 1 },
  { label: "T3", month: 4, yearOffset: 1 },
];

/** The one-off installation allowance paid in the first year, in XAF. */
export const INSTALLATION_ALLOWANCE_XAF = 350_000;

/** More given names and family names than the base generator has, from the French-speaking and English-speaking regions. */
export const EXTRA_FAMILY_NAMES: readonly string[] = [
  "Ngwa",
  "Tabe",
  "Ayuk",
  "Nkeng",
  "Fonge",
  "Mbah",
  "Nana",
  "Tamo",
  "Atangana",
  "Biyong",
];

export const ATTACHE_GIVEN_NAMES: readonly string[] = ["Solange", "Rodrigue", "Pascaline", "Thierry", "Odette", "Valery"];

export const REJECTION_CODES: readonly string[] = ["account_closed", "name_mismatch", "bank_unreachable"];
