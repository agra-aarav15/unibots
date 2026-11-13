import { Trans, useLingui } from "@lingui/react/macro";
import { CLI_MODEL_PLACEHOLDER, CLI_PROMPT_PLACEHOLDER } from "@unibot/contracts";
import { Disclosure, Input, ModelThinkingOptions } from "@unibot/ui-web";
import type { ModelSettingsState } from "./use-model-settings";

/**
 * The form for a command connection: the command to run, where to run it, and
 * the name the connection answers as. The command is the whole integration, so
 * nothing about a particular CLI is assumed.
 */
export function CliModelFields({
  busy,
  command,
  contextWindow,
  invalidatePreflight,
  maxTokens,
  modelId,
  setCommand,
  setContextWindow,
  setCwd,
  setError,
  setMaxTokens,
  setModelId,
  setNotice,
  cwd,
}: Pick<
  ModelSettingsState,
  | "busy"
  | "command"
  | "contextWindow"
  | "invalidatePreflight"
  | "maxTokens"
  | "modelId"
  | "setCommand"
  | "setContextWindow"
  | "setCwd"
  | "setError"
  | "setMaxTokens"
  | "setModelId"
  | "setNotice"
  | "cwd"
>) {
  const { t } = useLingui();
  const edit = (apply: () => void) => {
    invalidatePreflight();
    apply();
    setError(null);
    setNotice(null);
  };
  return (
    <div className="block text-[13.5px] text-muted-foreground">
      <label className="block" htmlFor="model-cli-command">
        <Trans>Command</Trans>
        <Input
          id="model-cli-command"
          value={command}
          onChange={(event) => edit(() => setCommand(event.target.value))}
          disabled={busy}
          aria-label={t`Command to run`}
          placeholder={`opencode run ${CLI_PROMPT_PLACEHOLDER}`}
          autoComplete="off"
          spellCheck={false}
          className="mt-2 h-10 font-mono text-foreground"
        />
      </label>
      <Disclosure className="mt-3 text-[13.5px] text-muted-foreground" summary={<Trans>Setup help</Trans>}>
        <p className="mt-1">
          <Trans>
            Use {CLI_PROMPT_PLACEHOLDER} for the message and {CLI_MODEL_PLACEHOLDER} for the model
            name. Without {CLI_PROMPT_PLACEHOLDER}, the message is written to the command's input.
          </Trans>
        </p>
      </Disclosure>
      <label className="mt-4 block" htmlFor="model-cli-cwd">
        <Trans>Folder</Trans>
        <Input
          id="model-cli-cwd"
          value={cwd}
          onChange={(event) => edit(() => setCwd(event.target.value))}
          disabled={busy}
          aria-label={t`Working folder`}
          placeholder={t`Optional`}
          autoComplete="off"
          spellCheck={false}
          className="mt-2 h-10 font-mono text-foreground"
        />
      </label>
      <label className="mt-4 block" htmlFor="model-cli-model">
        <Trans>Model name</Trans>
        <Input
          id="model-cli-model"
          value={modelId}
          onChange={(event) => edit(() => setModelId(event.target.value))}
          disabled={busy}
          aria-label={t`Model name`}
          placeholder="cli"
          autoComplete="off"
          spellCheck={false}
          className="mt-2 h-10 text-foreground"
        />
      </label>
      <ModelThinkingOptions
        showThinking={false}
        disabled={busy}
        advancedLabel={t`Advanced`}
        maxTokens={maxTokens}
        onMaxTokensChange={(value) => edit(() => setMaxTokens(value))}
        maxTokensLabel={t`Maximum output tokens`}
        contextWindow={contextWindow}
        onContextWindowChange={(value) => edit(() => setContextWindow(value))}
        contextWindowLabel={t`Context limit`}
      />
    </div>
  );
}