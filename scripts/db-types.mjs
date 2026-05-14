import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const result = spawnSync(
  "supabase",
  ["gen", "types", "typescript", "--local"],
  {
    encoding: "utf8",
    shell: true,
  },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

writeFileSync("lib/db/types.ts", result.stdout);
process.stdout.write("Generated Supabase types at lib/db/types.ts\n");
