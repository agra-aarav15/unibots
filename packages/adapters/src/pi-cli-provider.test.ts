import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createModels,
  normalizeContext,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { CLI_PROVIDER_ID } from "@unibot/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCliProgram, splitCliTemplate, substituteCliTemplate } from "./cli-command.js";
import { buildModelConnectPlaintext, modelCredentialDto } from "./model-connect.js";
import { parseModelSecret, secretValuesToRedact } from "./pi-oauth.js";
import {
  CLI_CATALOG_MODEL_ID,
  createAnsiStripper,
  registerCliCatalog,
  registerCliRuntime,
  renderCliPrompt,
} from "./pi-cli-provider.js";

const directories: string[] = [];

function fixture(files: Record<string, string>): string {
  const directory = mkdtempSync(path.join(tmpdir(), "unibot-cli-"));
  directories.push(directory);
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(directory, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** Reads the prompt from the first argument, or from standard input when there is none. */
const ECHO_ANSWER = `
let input = process.argv[2];
if (input === undefined) {
  input = "";
  for await (const chunk of process.stdin) input += chunk;
}
process.stdout.write("echo: " + input.trim());
`;

const FAIL_ANSWER = `process.stderr.write("unknown model\\n"); process.exit(3);`;

function answerScript(name = "answer.mjs"): string {
  return path.join(fixture({ [name]: ECHO_ANSWER }), name);
}

function ask(command: string, prompt: string, modelId = "fake"): Promise<AssistantMessage> {
  const models = registerCliRuntime(createModels(), { modelId, command });
  const provider = models.getProvider(CLI_PROVIDER_ID)!;
  const model = models.getModel(CLI_PROVIDER_ID, modelId)!;
  return provider
    .streamSimple(
      model,
      normalizeContext({ messages: [{ role: "user", content: prompt, timestamp: 1 }] }),
      { apiKey: "local" },
    )
    .result();
}

function textOf(message: AssistantMessage): string {
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

describe("command template", () => {
  it("splits quotes and keeps a quoted empty argument", () => {
    expect(splitCliTemplate(`run --model gpt "a b" ''`)).toEqual([
      "run",
      "--model",
      "gpt",
      "a b",
      "",
    ]);
  });

  it("substitutes placeholders once so a prompt cannot inject another", () => {
    expect(substituteCliTemplate(["run", "{{prompt}}"], { prompt: "{{model}} hi" })).toEqual([
      "run",
      "{{model}} hi",
    ]);
  });

  it("refuses an unclosed quote", () => {
    expect(() => splitCliTemplate(`run "unfinished`)).toThrow(/unclosed quote/);
  });
});

describe("resolveCliProgram", () => {
  it("runs a real executable directly", () => {
    const script = answerScript();
    expect(resolveCliProgram(process.execPath)).toEqual({ file: process.execPath, prefix: [] });
    expect(path.isAbsolute(script)).toBe(true);
  });

  it("reads the program and script out of an npm Windows shim", () => {
    const directory = fixture({
      "tool.cmd": [
        "@ECHO off",
        "GOTO start",
        ":start",
        "SETLOCAL",
        "CALL :find_dp0",
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\tool\\index.js" %*',
        "",
      ].join("\r\n"),
      "node_modules/tool/index.js": "process.exit(0)",
    });
    const resolved = resolveCliProgram(
      path.join(directory, "tool.cmd"),
      { ...process.env, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      "win32",
    );
    expect(resolved.file).toBe(process.execPath);
    expect(resolved.prefix).toEqual([path.join(directory, "node_modules/tool/index.js")]);
  });

  it("prefers the Windows shim over the POSIX script npm writes beside it", () => {
    const directory = fixture({
      tool: "#!/bin/sh\nexec node \"$0.js\" \"$@\"\n",
      "tool.cmd": [
        "@ECHO off",
        "SETLOCAL",
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\tool\\index.js" %*',
        "",
      ].join("\r\n"),
      "node_modules/tool/index.js": "process.exit(0)",
    });
    const resolved = resolveCliProgram(
      "tool",
      { ...process.env, PATH: directory, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      "win32",
    );
    expect(resolved.file).toBe(process.execPath);
    expect(resolved.prefix).toEqual([path.join(directory, "node_modules/tool/index.js")]);
  });

  it("names an unknown command instead of running it through a shell", () => {
    expect(() => resolveCliProgram("unibot-missing-command")).toThrow(/Command not found/);
  });
});

describe("renderCliPrompt", () => {
  it("passes a lone user turn through untouched", () => {
    expect(renderCliPrompt([{ role: "user", content: "hello" }])).toBe("hello");
  });

  it("keeps the system prompt above a transcript", () => {
    const prompt = renderCliPrompt([
      { role: "system", content: "Be brief." },
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: [{ type: "text", text: "third" }] },
    ]);
    expect(prompt).toContain("Be brief.");
    expect(prompt).toContain("User: first");
    expect(prompt).toContain("Assistant: second");
    expect(prompt).toContain("User: third");
    expect(prompt).toContain("Reply with the assistant's next message only");
  });

  it("ignores images a command cannot see", () => {
    expect(
      renderCliPrompt([
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image_url", image_url: { url: "data:," } },
          ],
        },
      ]),
    ).toBe("look");
  });
});

describe("createAnsiStripper", () => {
  it("holds back an escape sequence split across chunks", () => {
    const strip = createAnsiStripper();
    expect(strip("hello \u001B[3")).toBe("hello ");
    expect(strip("2mworld")).toBe("world");
  });
});

describe("connecting a command", () => {
  it("round-trips the command and its limits through the stored secret", () => {
    const plaintext = buildModelConnectPlaintext({
      provider: CLI_PROVIDER_ID,
      command: "kilo run {{prompt}}",
      cwd: "F:/work",
      modelId: "kilo",
      contextWindow: 200_000,
      maxTokens: 8_000,
    });
    expect(parseModelSecret(plaintext)).toEqual({
      kind: "cli",
      command: "kilo run {{prompt}}",
      cwd: "F:/work",
      contextWindow: 200_000,
      maxTokens: 8_000,
    });
    // A command is configuration, not a credential; nothing is redacted from it.
    expect(secretValuesToRedact(parseModelSecret(plaintext))).toEqual([]);
  });

  it("keeps the previous command's limits when a save omits them", () => {
    const first = buildModelConnectPlaintext({
      provider: CLI_PROVIDER_ID,
      command: "first {{prompt}}",
      modelId: "cli",
      contextWindow: 100_000,
      maxTokens: 4_000,
    });
    const second = buildModelConnectPlaintext(
      { provider: CLI_PROVIDER_ID, command: "second {{prompt}}", modelId: "cli" },
      first,
    );
    expect(parseModelSecret(second)).toMatchObject({
      command: "second {{prompt}}",
      contextWindow: 100_000,
      maxTokens: 4_000,
    });
  });

  it("requires a command and a model at the connect boundary", () => {
    expect(() =>
      buildModelConnectPlaintext({ provider: CLI_PROVIDER_ID, modelId: "cli" }),
    ).toThrow(/command is required/i);
    expect(() =>
      buildModelConnectPlaintext({ provider: CLI_PROVIDER_ID, command: "run {{prompt}}" }),
    ).toThrow(/Model id is required/i);
  });

  it("reports the command to settings as a command connection", () => {
    const plaintext = buildModelConnectPlaintext({
      provider: CLI_PROVIDER_ID,
      command: "claurst -p {{prompt}}",
      cwd: "F:/work",
      modelId: "claurst",
    });
    expect(
      modelCredentialDto(
        { id: "credential-fixture", provider: CLI_PROVIDER_ID, label: "claurst", defaultModel: "claurst" },
        plaintext,
      ),
    ).toMatchObject({
      authKind: "cli",
      command: "claurst -p {{prompt}}",
      cwd: "F:/work",
      hasKey: false,
      provider: CLI_PROVIDER_ID,
    });
  });
});

describe("command provider", () => {
  it("offers a placeholder catalog entry before a command is connected", () => {
    const models = registerCliCatalog(createModels());
    expect(models.getProvider(CLI_PROVIDER_ID)?.name).toBe("Command line");
    expect(models.getModel(CLI_PROVIDER_ID, CLI_CATALOG_MODEL_ID)?.id).toBe(CLI_CATALOG_MODEL_ID);
  });

  it("answers from the command's output", async () => {
    const message = await ask(`"${process.execPath}" "${answerScript()}" {{prompt}}`, "hi there");
    expect(textOf(message)).toBe("echo: hi there");
    expect(message.stopReason).toBe("stop");
  });

  it("writes the prompt to standard input when the template has no placeholder", async () => {
    const message = await ask(`"${process.execPath}" "${answerScript()}"`, "from stdin");
    expect(textOf(message)).toBe("echo: from stdin");
  });

  it("keeps a multi-line prompt intact through argv", () => {
    const prompt = renderCliPrompt([
      { role: "user", content: "line one" },
      { role: "assistant", content: "line two" },
      { role: "user", content: 'quoted "and" more' },
    ]);
    expect(prompt).toContain('quoted "and" more');
    expect(prompt.split("\n").length).toBeGreaterThan(1);
  });

  it("reports a command that fails before answering", async () => {
    const directory = fixture({ "fail.mjs": FAIL_ANSWER });
    const message = await ask(
      `"${process.execPath}" "${path.join(directory, "fail.mjs")}" {{prompt}}`,
      "hi",
    );
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toContain("unknown model");
  });

  it("refuses to run an empty command", async () => {
    const models = registerCliCatalog(createModels());
    const provider = models.getProvider(CLI_PROVIDER_ID)!;
    const model = models.getModel(CLI_PROVIDER_ID, CLI_CATALOG_MODEL_ID)!;
    const message = await provider
      .streamSimple(
        model,
        normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 1 }] }),
        { apiKey: "local" },
      )
      .result();
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toContain("Connect a command");
  });
});