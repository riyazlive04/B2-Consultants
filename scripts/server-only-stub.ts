/**
 * A no-op stand-in for the `server-only` package, for SCRIPT RUNS ONLY.
 *
 * `server-only` throws on import unless Node is running with `--conditions=react-server`, which is
 * how Next loads a server module. A plain `tsx` script cannot use that condition, because it also
 * resolves React to its server subset - and that subset refuses to load outside a framework, which
 * is exactly what `@react-pdf/renderer` needs React for.
 *
 * So a script that renders a real document through the real server modules has to satisfy one of
 * the two and not the other. `tsconfig.scripts.json` maps `server-only` here; nothing in `src/`
 * does, and nothing bundled for the app ever sees this file. The guarantee that matters - that a
 * server module never reaches the BROWSER - is enforced by the Next build, not by this shim.
 */

export {};
