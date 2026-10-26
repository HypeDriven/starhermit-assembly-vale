// StarHermit online features for a signed-in player (a guest makes no
// platform calls): posting a finished round's score through the game's score
// script (score-script.js: a practice session whose script range-checks the
// score and writes it to the high-score board) with the player's rank, and
// the invite link. Signing in and out is the runtime's (its Account dialog,
// or the client); the title's Sign in button asks for it.
import { clipboard } from "starhermit:engine";
import { connectGame, inviteLink, leaderboards, player, requestSignIn, sessions, type Leaderboard } from "starhermit:platform";
import { T } from "./i18n.js";

let link: string | null = null;
let board: Leaderboard | null = null;

export function signedIn(): boolean { return player() !== null; }

/** Fetches what the title needs for the player now signed in (or clears it). */
export function refresh(): void {
  link = null; board = null;
  if (!player()) return;
  inviteLink().then((l) => { link = l; }, () => { link = null; });
}

let signingIn = false;
export function signIn(): void {
  if (signingIn) return;
  signingIn = true;
  requestSignIn().then(() => { signingIn = false; }, () => { signingIn = false; });
}

async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? null;
  return board;
}

/** Posts a finished round's score; resolves whether it was taken and the
 * player's rank on the board (null when not among the first 100). Never rejects. */
export async function submitScore(total: number): Promise<{ posted: boolean; rank: number | null }> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": total } }); });
      socket.on("game", (data) => {
        const d = data as { type?: string; accepted?: string[] } | null;
        if (d && d.type === "result-ack") finish(Array.isArray(d.accepted) ? d.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const page = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = page.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}

/** Copies the invite link (call while handling the button's press); the toast text. */
export function copyInvite(): string {
  if (!link) return T("sh.inviteFailed");
  try { clipboard.writeText(link); return T("sh.inviteCopied"); }
  catch { return `${T("sh.inviteFailed")} ${link}`; }
}
