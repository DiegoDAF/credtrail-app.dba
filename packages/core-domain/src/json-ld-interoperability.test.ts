import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import sources from "./contexts/sources.json";

it("keeps official context documents byte-for-byte pinned", () => {
  for (const source of sources)
    expect(
      createHash("sha256")
        .update(readFileSync(new URL(`./contexts/${source.file}`, import.meta.url)))
        .digest("hex"),
    ).toBe(source.sha256);
});
