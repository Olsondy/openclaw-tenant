import { describe, expect, test } from "bun:test";
import { readFile } from "fs/promises";
import { resolve } from "path";

const provisionDockerScriptPath = resolve(
  import.meta.dir,
  "../../../../../../openclaw/provision-docker.sh",
);

describe("provision-docker.sh plugin bootstrap", () => {
  test("enables bundled feishu plugin instead of installing from local path", async () => {
    const content = await readFile(provisionDockerScriptPath, "utf8");

    expect(content).toContain("node dist/index.js plugins enable feishu");
    expect(content).not.toContain("node dist/index.js plugins install ./extensions/feishu");
  });
});
