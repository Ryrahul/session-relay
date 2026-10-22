import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/** Yields parsed JSON objects from a JSONL file, skipping blank or broken lines. */
export async function* jsonLines(file: string): AsyncGenerator<any> {
  const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // Partially written last line while the tool is still running.
      }
    }
  } finally {
    rl.close();
  }
}

export function titleFrom(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 80 ? one.slice(0, 79) + "…" : one || "Untitled session";
}
