// Decoder for the `FonctionParametres` response, adapted from pawnote
// (GPL-3.0-or-later, https://github.com/BlocksHub/Pawnote-LTS), which does not
// export it. We need it because we capture this response from the browser
// instead of letting pawnote request it.
import type { InstanceParameters, WeekFrequency } from "@blockshub/pawnote-lts";

const decodeDomain = (api: string): number[] => {
  api = api.trim();
  if (api[0] !== "[" || api[api.length - 1] !== "]") return [];
  api = api.slice(1, -1);
  if (api.length === 0) return [];

  const output: number[] = [];
  for (const part of api.split(",")) {
    if (part.includes("..")) {
      const [start, end] = part.split("..").map((n) => parseInt(n));
      for (let index = start; index <= end; index++) output.push(index);
    } else output.push(parseInt(part));
  }
  return output;
};

const YEAR_PREFIX = new Date().getFullYear().toString().slice(0, 2);

const decodePronoteDate = (formatted: string): Date => {
  let m: RegExpMatchArray | null;
  if ((m = formatted.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) {
    return new Date(+m[3], +m[2] - 1, +m[1]);
  }
  if ((m = formatted.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/))) {
    return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
  }
  if ((m = formatted.match(/^(\d{2})\/(\d{2})\/(\d{2}) (\d{2})h(\d{2})$/))) {
    return new Date(+`${YEAR_PREFIX}${m[3]}`, +m[2] - 1, +m[1], +m[4], +m[5]);
  }
  throw new Error(`Unknown Pronote date format: ${formatted}`);
};

export const decodeInstanceParameters = (parameters: any): InstanceParameters => {
  const general = parameters.General;
  const weekFrequencies = new Map<number, WeekFrequency>();

  for (const fortnight of [1, 2]) {
    for (const week of decodeDomain(general.DomainesFrequences[fortnight].V)) {
      weekFrequencies.set(week, { label: general.LibellesFrequences[fortnight], fortnight });
    }
  }

  return {
    version: general.versionPN.split(".").map(Number),
    nextBusinessDay: decodePronoteDate(general.JourOuvre.V),
    firstMonday: decodePronoteDate(general.PremierLundi.V),
    firstDate: decodePronoteDate(general.PremiereDate.V),
    lastDate: decodePronoteDate(general.DerniereDate.V),
    navigatorIdentifier: parameters.identifiantNav,
    endings: general.ListeHeuresFin.V.map((ending: any) => ending.L),
    periods: general.ListePeriodes.map((period: any) => ({
      id: period.N,
      kind: period.G,
      name: period.L,
      startDate: decodePronoteDate(period.dateDebut.V),
      endDate: decodePronoteDate(period.dateFin.V),
    })),
    holidays: general.listeJoursFeries.V.map((holiday: any) => ({
      id: holiday.N,
      name: holiday.L,
      startDate: decodePronoteDate(holiday.dateDebut.V),
      endDate: decodePronoteDate(holiday.dateFin.V),
    })),
    weekFrequencies,
    blocksPerDay: general.PlacesParJour,
  };
};
