import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Pass `--expose-gc` to the worker so `global.gc()` is available
    // for the loudness-target memory regression test in
    // `src/transforms/loudness-target/unit.test.ts`. Vitest does not
    // expose `global.gc` by default; the forks pool's `execArgv`
    // forwards the V8 flag to each forked worker. The pool choice
    // (`forks` vs `threads`) is identical for non-memory-tested code
    // — `forks` is V8's default vitest pool through 1.x and remains
    // a supported option in 3.x — so this change is scoped to enabling
    // GC and does not alter test parallelism semantics.
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--expose-gc"],
      },
    },
  },
});
