// Share a world: commit a finished session folder to git (and optionally push).
//   npm run session:publish                        -> your latest terminated session
//   npm run session:publish -- Imtiaj-Pc/session_03-haiku-5-5
//   npm run session:publish -- --all               -> every terminated session of yours not yet committed
//   add --push to push right after committing
import { execFileSync } from "node:child_process";
import { listSessions } from "../src/session/store.js";
import { loadSettings } from "../src/config.js";

const args = process.argv.slice(2);
const push = args.includes("--push");
const all = args.includes("--all");
const target = args.find((a) => !a.startsWith("--"));
const me = loadSettings().operator;

const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" }).trim();

const sessions = listSessions().filter((s) => s.status === "terminated");
let picked = sessions.filter((s) => (target ? `${s.operator}/${s.name}` === target : s.operator === me));
if (!all && !target) picked = picked.slice(0, 1);
if (!picked.length) {
  console.error(target ? `No terminated session "${target}".` : `No terminated sessions for operator "${me}" yet. Terminate a world first (only finished worlds are published).`);
  process.exit(1);
}

let committed = 0;
for (const s of picked) {
  git("add", "--", s.path);
  const staged = git("diff", "--cached", "--name-only", "--", s.path);
  if (!staged) {
    console.log(`= ${s.path} is already committed.`);
    continue;
  }
  const truth = s.truth ? `truth found by ${s.truth.name}` : "truth undiscovered";
  const models = s.models.routine === s.models.deep ? s.models.routine : `${s.models.routine} + ${s.models.deep}`;
  const days = (s.lastWorldMinutes / 1440).toFixed(1);
  git("commit", "-m", `Session ${s.operator}/${s.name}: ${s.alive}/${s.netrunnerCount} alive after ${days} world days, ${truth} (${models})`, "--", s.path);
  console.log(`+ committed ${s.path}`);
  committed += 1;
}
if (push && committed) {
  console.log(git("push"));
  console.log("pushed.");
} else if (committed) {
  console.log("Committed locally. Run `git push` (or add --push) to share.");
}
