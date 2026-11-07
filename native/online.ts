// StarHermit online features for a signed-in player (a guest makes no
// platform calls): posting a finished round's score through the game's score
// script (score-script.js, which range-checks the score and writes it to the
// high-score board) with leaderboards.submitScore, with the player's rank, and
// the invite link. Signing in and out is the runtime's (its Account dialog,
// or the client); the title's Sign in button asks for it.
import { clipboard } from "starhermit:engine";
import { inviteLink, leaderboards, player, requestSignIn } from "starhermit:platform";
import { T } from "./i18n.js";

let link: string | null = null;

export function signedIn(): boolean { return player() !== null; }

/** Fetches what the title needs for the player now signed in (or clears it). */
export function refresh(): void {
  link = null;
  if (!player()) return;
  inviteLink().then((l) => { link = l; }, () => { link = null; });
}

let signingIn = false;
export function signIn(): void {
  if (signingIn) return;
  signingIn = true;
  requestSignIn().then(() => { signingIn = false; }, () => { signingIn = false; });
}

/** Posts a finished round's score; resolves whether it was taken and the
 * player's rank on the board (null when not among the first 100). Never rejects. */
export async function submitScore(total: number): Promise<{ posted: boolean; rank: number | null }> {
  const r = await leaderboards.submitScore("high-score", total);
  return { posted: r.accepted, rank: r.rank };
}

/** Copies the invite link (call while handling the button's press); the toast text. */
export function copyInvite(): string {
  if (!link) return T("starhermit.inviteFailed");
  try { clipboard.writeText(link); return T("starhermit.inviteCopied"); }
  catch { return T("starhermit.inviteLink", { link }); }
}
