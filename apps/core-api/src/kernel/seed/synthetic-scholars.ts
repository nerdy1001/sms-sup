/**
 * Synthetic scholars for development and demonstrations. Nothing here is real: the identifiers start
 * with SYN, the e-mail addresses end in .invalid (a domain that can never exist), and there is no
 * telephone number. The same seed always gives the same people, so a bug found on one computer can be
 * reproduced on another. The registry module (RG-01) turns these into rows once it has a table.
 */

export interface SyntheticScholar {
  readonly synthetic: true;
  readonly id: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly sex: "F" | "M";
  /** ISO date, between 1996 and 2006. */
  readonly birthDate: string;
  readonly email: string;
  readonly destinationCountry: string;
  readonly institution: string;
  readonly level: "licence" | "master" | "doctorate";
  readonly firstYear: number;
}

export const DEFAULT_SEED = 20261027;

const GIVEN_F = [
  "Aline",
  "Brenda",
  "Carine",
  "Doris",
  "Estelle",
  "Flore",
  "Grace",
  "Hortense",
  "Ines",
  "Juliette",
  "Karine",
  "Laure",
  "Mireille",
  "Nadine",
  "Olive",
  "Prisca",
];
const GIVEN_M = [
  "Arnaud",
  "Blaise",
  "Cedric",
  "Daniel",
  "Emmanuel",
  "Franck",
  "Gaston",
  "Herve",
  "Ivan",
  "Jules",
  "Kevin",
  "Landry",
  "Martial",
  "Nelson",
  "Olivier",
  "Patrick",
];
const FAMILY = [
  "Abena",
  "Bekolo",
  "Chia",
  "Dongmo",
  "Essomba",
  "Fotso",
  "Gwet",
  "Hakeem",
  "Itoe",
  "Jioke",
  "Kamga",
  "Lekeufack",
  "Mbarga",
  "Ndifor",
  "Onana",
  "Pouth",
  "Qwesi",
  "Tchoua",
  "Ubah",
  "Vondou",
];
const COUNTRIES = ["Country A", "Country B", "Country C", "Country D", "Country E"];
const INSTITUTIONS = [
  "Test University One",
  "Test University Two",
  "Test Institute of Technology",
  "Test School of Medicine",
  "Test Business School",
];
const LEVELS: readonly SyntheticScholar["level"][] = ["licence", "master", "doctorate"];

/** A small, fast generator (mulberry32). Not for security: only for repeatable test data. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSyntheticScholars(count = 200, seed = DEFAULT_SEED): SyntheticScholar[] {
  if (!Number.isInteger(count) || count < 0 || count > 100000) throw new RangeError("count must be a whole number between 0 and 100000");
  const random = createRandom(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const scholars: SyntheticScholar[] = [];
  for (let index = 1; index <= count; index += 1) {
    const sex = random() < 0.5 ? "F" : "M";
    const year = 1996 + Math.floor(random() * 11);
    const month = 1 + Math.floor(random() * 12);
    const day = 1 + Math.floor(random() * 28);
    const number = String(index).padStart(6, "0");
    scholars.push({
      synthetic: true,
      id: `SYN-${number}`,
      givenName: pick(sex === "F" ? GIVEN_F : GIVEN_M),
      familyName: pick(FAMILY),
      sex,
      birthDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      email: `syn${number}@example.invalid`,
      destinationCountry: pick(COUNTRIES),
      institution: pick(INSTITUTIONS),
      level: pick(LEVELS),
      firstYear: 2021 + Math.floor(random() * 5),
    });
  }
  return scholars;
}
