/** One file in a unified diff. */
export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
  /** The file's part of the patch, from its "diff --git" line. */
  patch: string;
}

/** Splits `git diff` output into files with line counts. */
export function splitDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const chunk of diff.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith("diff --git ")) continue;
    const head = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk);
    const plus = /^\+\+\+ (?:b\/)?(.+)$/m.exec(chunk)?.[1];
    const path = plus && plus !== "/dev/null" ? plus : (head?.[2] ?? head?.[1] ?? "?");
    let additions = 0;
    let deletions = 0;
    for (const line of chunk.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }
    files.push({ path, additions, deletions, binary: /^Binary files /m.test(chunk), patch: chunk });
  }
  return files;
}

export interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

export function diffStats(diff: string): DiffStats {
  const files = splitDiff(diff);
  return {
    files: files.length,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
  };
}
