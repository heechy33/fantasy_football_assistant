import { KNOWN_TEAM_ABBREVS } from './espnTeams';

export interface EspnDomPickRow {
  /** Absolute pick number read from the leading digits of the row text. */
  pickNumber: number;
  /** Player name — the text between the pick number and the team abbreviation. */
  name: string;
  /** The NFL abbreviation that anchored the parse (e.g. "WSH"; canonicalized by the adapter). */
  teamAbbrev: string;
  /** Raw position token (QB|RB|WR|TE|K|D/ST|DST). */
  position: string;
  /** Fantasy team name — the text after the position token, with trailing board artifacts trimmed. */
  fantasyTeamName: string;
}

const POSITION_TOKENS = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST', 'DST'] as const;

/** Longer abbreviations first so "LAR" wins over "LA" at the same offset. */
const ABBREVS_BY_LENGTH = [...KNOWN_TEAM_ABBREVS].sort((a, b) => b.length - a.length);

/** Strip the trailing round-number / points / "undo" artifacts the ESPN DOM appends after the
 * fantasy team name (recon row: "Koston's Top-Notch Team141141.2undo"). Deterministic and
 * end-anchored so a leading digit in a team name is never touched. */
function trimFantasyTeamName(raw: string): string {
  let out = raw.trim();
  for (;;) {
    const next = out.replace(/\s*(?:\d+(?:\.\d+)?|undo)\s*$/i, '').trim();
    if (next === out) return out;
    out = next;
  }
}

/**
 * Parse one [data-pick-number] row's collapsed text into its parts. The recon row shape is
 * "<pickNumber><player name><team abbrev><position><fantasy team name><board artifacts>" — e.g.
 * "140Jake BatesDETKKoston's Top-Notch Team141141.2undo". `pickNumber` is the caller-supplied,
 * authoritative value (the `data-pick-number` attribute, captured separately by the extension) —
 * NOT inferred from the text's leading digits, because a player name that itself starts with a
 * digit (e.g. "49ers D/ST" at pick 152: "15249ers D/ST...") would otherwise consume part of the
 * name as if it were more of the pick number. The rest of the row is parsed deterministically:
 * find the first offset where the remainder starts with a known NFL abbreviation (via espnTeams)
 * immediately followed by a position token. Name is the text before, fantasy team name the text
 * after.
 */
export function parseEspnDomPickRow(text: string | null | undefined, pickNumber: number | null | undefined): EspnDomPickRow | null {
  if (!text || pickNumber == null || !Number.isFinite(pickNumber)) return null;
  const trimmed = text.trim();
  const prefix = String(pickNumber);
  if (!trimmed.startsWith(prefix)) return null;
  const rest = trimmed.slice(prefix.length);
  for (let offset = 0; offset < rest.length; offset += 1) {
    for (const abbrev of ABBREVS_BY_LENGTH) {
      if (!rest.startsWith(abbrev, offset)) continue;
      const after = rest.slice(offset + abbrev.length);
      const position = POSITION_TOKENS.find((token) => after.startsWith(token));
      if (!position) continue;
      const name = rest.slice(0, offset).trim();
      const fantasyTeamName = trimFantasyTeamName(after.slice(position.length));
      if (!name || !fantasyTeamName) return null;
      return { pickNumber, name, teamAbbrev: abbrev, position, fantasyTeamName };
    }
  }
  return null;
}
