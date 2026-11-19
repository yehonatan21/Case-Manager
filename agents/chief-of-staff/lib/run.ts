/** Shared plumbing for scripts/: flags, JSON output on stdout, errors as JSON on stderr with exit code 1. */

export function flag(name: string, argv = process.argv): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i > 0 ? argv[i + 1] : undefined;
}

/** Positional arguments (anything that isn't a --flag or a flag's value). */
export function positional(argv = process.argv): string[] {
  const out: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    if (argv[i]!.startsWith("--")) i++;
    else out.push(argv[i]!);
  }
  return out;
}

export function num(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value.replace(/[,_₪$]/g, ""));
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${value}"`);
  return n;
}

export function runScript(main: () => Promise<unknown> | unknown, usage: string) {
  if (process.argv.includes("--help")) {
    console.log(usage);
    process.exit(0);
  }
  Promise.resolve()
    .then(main)
    .then((out) => {
      console.log(JSON.stringify(out, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err), usage }, null, 2));
      process.exit(1);
    });
}
