import tailwindPlugin from "bun-plugin-tailwind";

Bun.build({
  entrypoints: ["./src/index.html"],
  outdir: "./dist",
  minify: {
    whitespace: true,
    identifiers: true,
    syntax: true,
  },
  plugins: [tailwindPlugin],
});
