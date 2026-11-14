import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Atomic-ish write: write a temp file then rename over the target. */
export function writeJson(file: string, data: unknown, pretty = true) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows can refuse a rename while another process reads the file; fall back.
    fs.copyFileSync(tmp, file);
    fs.rmSync(tmp, { force: true });
  }
}

export function appendJsonl(file: string, rows: unknown[]) {
  if (!rows.length) return;
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

/** Read a .jsonl file, or its .jsonl.gz sibling if the plain one was compressed. */
export function readJsonl<T>(file: string): T[] {
  let text = "";
  if (fs.existsSync(file)) text = fs.readFileSync(file, "utf8");
  else if (fs.existsSync(file + ".gz")) text = zlib.gunzipSync(fs.readFileSync(file + ".gz")).toString("utf8");
  else return [];
  const out: T[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      /* skip a torn last line from a crash */
    }
  }
  return out;
}

export function gzipFile(file: string) {
  if (!fs.existsSync(file)) return;
  fs.writeFileSync(file + ".gz", zlib.gzipSync(fs.readFileSync(file), { level: 9 }));
  fs.rmSync(file, { force: true });
}

export function fileSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    try {
      return fs.statSync(file + ".gz").size;
    } catch {
      return 0;
    }
  }
}
