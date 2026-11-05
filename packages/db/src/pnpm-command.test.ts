import { describe, expect, it } from "vitest";
import { pnpmCommand } from "./pnpm-command.js";

const windowsEnv = { npm_execpath: undefined, ComSpec: "C:\\Windows\\system32\\cmd.exe" };

describe("pnpmCommand", () => {
  it("runs the JavaScript entry the invoking shell used", () => {
    expect(
      pnpmCommand(
        ["exec", "prisma", "migrate", "deploy"],
        // The caller is Windows, and so is the entry: on any other platform this path is not
        // absolute and the entry is deliberately ignored, so the platform is stated, not inherited.
        { npm_execpath: "C:\\Users\\Owner\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs" },
        "win32",
      ),
    ).toEqual({
      file: process.execPath,
      args: [
        "C:\\Users\\Owner\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs",
        "exec",
        "prisma",
        "migrate",
        "deploy",
      ],
    });
  });

  it("uses a shell on Windows when no entry was passed down", () => {
    expect(pnpmCommand(["db:migrate"], windowsEnv, "win32")).toEqual({
      file: "C:\\Windows\\system32\\cmd.exe",
      args: ["/c", "pnpm", "db:migrate"],
    });
  });

  it("falls back to cmd.exe when ComSpec is unset", () => {
    expect(pnpmCommand(["db:migrate"], { npm_execpath: undefined }, "win32")).toEqual({
      file: "cmd.exe",
      args: ["/c", "pnpm", "db:migrate"],
    });
  });

  it("ignores an entry that is not a pnpm script, such as a wrapper", () => {
    expect(
      pnpmCommand(["db:migrate"], { npm_execpath: "/usr/lib/node_modules/npm/bin/npm-cli.js" }, "linux"),
    ).toEqual({ file: "pnpm", args: ["db:migrate"] });
    expect(pnpmCommand(["db:migrate"], { npm_execpath: "relative/pnpm.cjs" }, "linux")).toEqual({
      file: "pnpm",
      args: ["db:migrate"],
    });
  });

  it("runs a bare pnpm where a shell can resolve it", () => {
    expect(pnpmCommand(["db:migrate"], {}, "linux")).toEqual({
      file: "pnpm",
      args: ["db:migrate"],
    });
  });
});
