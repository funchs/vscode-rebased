import esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const baseOptions = {
  bundle: true,
  format: "cjs",
  minify: production,
  sourcemap: !production,
  platform: "node",
  logLevel: "info",
};

const extensionBuild = {
  ...baseOptions,
  entryPoints: ["src/extension.ts"],
  outfile: "out/extension.js",
  external: ["vscode"],
};

const webviewBuilds = [
  { in: "src/webview/rebase.ts", out: "out/webview/rebase.js" },
  { in: "src/webview/log.ts",    out: "out/webview/log.js" },
  { in: "src/webview/commit.ts", out: "out/webview/commit.js" },
  { in: "src/webview/hunks.ts",  out: "out/webview/hunks.js" },
  { in: "src/webview/reflog.ts", out: "out/webview/reflog.js" },
  { in: "src/webview/details.ts", out: "out/webview/details.js" },
].map((w) => ({
  ...baseOptions,
  entryPoints: [w.in],
  outfile: w.out,
  platform: "browser",
  format: "iife",
  external: [],
}));

async function run() {
  const contexts = await Promise.all(
    [extensionBuild, ...webviewBuilds].map((opts) => esbuild.context(opts))
  );
  if (watch) {
    await Promise.all(contexts.map((c) => c.watch()));
    console.log("watching...");
  } else {
    await Promise.all(contexts.map((c) => c.rebuild()));
    await Promise.all(contexts.map((c) => c.dispose()));
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
