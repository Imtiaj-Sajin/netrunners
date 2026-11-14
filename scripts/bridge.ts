// The mind's side of the Claude Code bridge.
//   npx tsx scripts/bridge.ts next <Name> [--wait=280]
// Blocks until the world needs <Name> to decide (or reflect), then prints ONLY what <Name>
// perceives, plus where to write the answer. Prints STOP when the world has ended.
import fs from "node:fs";
import path from "node:path";
import { BRIDGE_DIR, bridgeName } from "../src/mind/bridge.js";

const [cmd, rawName] = process.argv.slice(2);
const wait = Number(process.argv.find((a) => a.startsWith("--wait="))?.split("=")[1] ?? 280);
if (cmd !== "next" || !rawName) {
  console.log("usage: npx tsx scripts/bridge.ts next <Name> [--wait=280]");
  process.exit(1);
}
const name = bridgeName(rawName);
const inbox = path.join(BRIDGE_DIR, "inbox", name);
const seen = path.join(BRIDGE_DIR, "seen", name);
const stopFile = path.join(BRIDGE_DIR, "STOP");

const DECISION = `{"thought":"your private inner voice, 1-3 sentences","action":"one of: move talk post read_net search_net search_deepnet take_contract join_contract work abandon_contract rest leisure explore buy use_item give steal attack propose_bond accept_bond decline_bond break_bond unlock craft_shard upload_shard reflect wait solve read post_job rate","target":"","message":"","duration":0,"amount":0,"whisper":false,"anonymous":false,"private_intent":"","sincere":true,"category":"none","bond":"none","emotions":[{"name":"joy","change":0.1}],"opinions":[{"name":"SomeName","trust":0.05,"liking":0.05,"note":"short"}],"commitment":""}`;
const REFLECTION = `{"insights":["2-5 things you now understand"],"self_view":"who you are now, 1-3 sentences","goals":["1-4 concrete goals"],"enjoy":"what you have found you enjoy","opinions":[{"name":"SomeName","trust":0.05,"liking":-0.05,"note":"your considered judgment"}]}`;

const pending = () => (fs.existsSync(inbox) ? fs.readdirSync(inbox).filter((f) => f.endsWith(".json")).sort() : []);

const started = Date.now();
while (true) {
  if (fs.existsSync(stopFile)) {
    console.log("STOP: the world has ended. Your life there is over and recorded. You can finish now.");
    process.exit(0);
  }
  const files = pending();
  if (files.length) {
    for (const f of files) {
      const job = JSON.parse(fs.readFileSync(path.join(inbox, f), "utf8"));
      console.log(`\n================ A MOMENT FOR ${job.name.toUpperCase()} · ${job.kind === "reflect" ? "REFLECTION" : "DECISION"} · ${job.id} ================\n`);
      if (!fs.existsSync(seen)) {
        console.log("WHO YOU ARE (shown once; remember it):\n");
        console.log(job.system);
        fs.mkdirSync(path.dirname(seen), { recursive: true });
        fs.writeFileSync(seen, job.id);
        console.log("\n---------------- NOW ----------------\n");
      }
      console.log(job.user);
      console.log(`\n---------------- ANSWER ----------------`);
      console.log(`Write ONLY one JSON object (no prose, no code fence) to this exact file:\n${job.answerTo}`);
      console.log(job.kind === "reflect"
        ? `Reflection format:\n${REFLECTION}`
        : `Decision format (every field present; "" / 0 / false / "none" when unused; emotion changes -0.3..0.3, opinion changes -0.2..0.2):\n${DECISION}`);
    }
    console.log(`\nAfter writing ${files.length > 1 ? "each answer" : "the answer"}, run the same command again to wait for your next moment.`);
    process.exit(0);
  }
  if ((Date.now() - started) / 1000 > wait) {
    console.log("Nothing needs you yet (you are busy doing something, or time is passing). Run the same command again.");
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 500));
}
