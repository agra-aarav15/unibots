import type { ModelHeaderRow } from "@rakazo/contracts";
import { serverHeadersFromRows } from "@rakazo/contracts";
import { Stack, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HeaderRowsEditor } from "../components/header-rows-editor";
import { NativeActionButton } from "../components/native-action-button";
import { cancelHeaderOptions, trailingHeaderOptions } from "../components/sheet-header";
import {
  apiBaseWarning,
  currentApiBase,
  defaultApiBase,
  normalizeApiBase,
  probeApiBase,
  resetApiBase,
  saveApiBase,
  usesCustomApiBase,
} from "../lib/api";
import Constants from "expo-constants";
import { useI18n } from "../lib/i18n";
import { PAIRING_CODE_LENGTH, pairWithComputer } from "../lib/pair-device";
import { useMobileTokens } from "../lib/native";
import { serverHeaders } from "../lib/server-headers";
import { useSideInsets } from "../lib/side-insets";
import { errorText } from "../lib/user-error";

export default function ServerScreen() {
  const sideInsets = useSideInsets();
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const router = useRouter();
  const current = currentApiBase();
  const [draft, setDraft] = useState(current);
  const [headerRows, setHeaderRows] = useState<ModelHeaderRow[]>(() =>
    Object.entries(serverHeaders(current)).map(([name, value]) => ({ name, value })),
  );
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const active = useRef(true);
  const saving = useRef(false);

  useEffect(() => {
    return () => {
      active.current = false;
    };
  }, []);

  function close() {
    if (!active.current) return;
    active.current = false;
    if (router.canGoBack()) router.back();
    else router.replace("/sign-in");
  }

  const parsedDraft = normalizeApiBase(draft);
  const warning = parsedDraft.ok ? apiBaseWarning(parsedDraft.url) : null;

  async function save() {
    if (saving.current) return;
    saving.current = true;
    setPending(true);
    setError(null);
    try {
      let headers: Record<string, string>;
      try {
        headers = serverHeadersFromRows(headerRows);
      } catch (headerError) {
        setError(errorText(headerError));
        return;
      }
      const probed = await probeApiBase(draft, fetch, headers);
      if (!active.current) return;
      if (!probed.ok) {
        setError(probed.error);
        return;
      }
      const saved = await saveApiBase(probed.url, headers);
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      close();
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  /** Redeems the code the desktop showed, using the address typed above. */
  async function pair() {
    if (saving.current) return;
    saving.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await pairWithComputer({
        url: draft,
        code,
        deviceName: Constants.deviceName ?? (Platform.OS === "ios" ? "iPhone" : "Android"),
        platform: Platform.OS === "ios" ? "ios" : "android",
      });
      if (!active.current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      close();
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  async function restoreDefault() {
    if (saving.current) return;
    saving.current = true;
    setPending(true);
    setError(null);
    try {
      const saved = await resetApiBase();
      if (!active.current) return;
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      close();
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return (
    <SafeAreaView edges={["bottom"]} style={{ flex: 1, backgroundColor: tokens.background }}>
      <Stack.Screen
        options={{
          title: t("Server"),
          ...cancelHeaderOptions(t("Cancel"), close),
          ...trailingHeaderOptions(
            pending ? t("Checking…") : t("Save"),
            () => void save(),
            pending,
          ),
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={sideInsets}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            testID="server-address"
            accessibilityLabel={t("Server")}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={(value) => {
              setDraft(value);
              setError(null);
            }}
            onSubmitEditing={() => void save()}
            placeholder={defaultApiBase()}
            placeholderTextColor={tokens.mutedForeground}
            returnKeyType="go"
            style={{
              backgroundColor: tokens.muted,
              borderRadius: 13,
              padding: 16,
              color: tokens.foreground,
              fontSize: 16,
            }}
            textContentType="URL"
            value={draft}
          />
          {warning ? (
            <Text style={{ color: tokens.mutedForeground, marginTop: 12, fontSize: 13 }}>
              {warning}
            </Text>
          ) : null}
          <HeaderRowsEditor
            rows={headerRows}
            onChange={(rows) => {
              setHeaderRows(rows);
              setError(null);
            }}
            disabled={pending}
          />
          <TextInput
            testID="pairing-code"
            accessibilityLabel={t("Pairing code")}
            autoComplete="off"
            editable={!pending}
            keyboardType="number-pad"
            maxLength={PAIRING_CODE_LENGTH}
            onChangeText={(value) => {
              setCode(value.replace(/\D/g, ""));
              setError(null);
            }}
            placeholder={t("Pairing code")}
            placeholderTextColor={tokens.mutedForeground}
            style={{
              backgroundColor: tokens.muted,
              borderRadius: 13,
              padding: 16,
              marginTop: 12,
              color: tokens.foreground,
              fontSize: 16,
            }}
            value={code}
          />
          {code.length === PAIRING_CODE_LENGTH ? (
            <NativeActionButton
              disabled={pending}
              label={t("Pair with computer")}
              onPress={() => void pair()}
              style={{ marginTop: 12, alignSelf: "flex-start" }}
            />
          ) : null}
          {error ? <Text style={{ color: tokens.destructive, marginTop: 12 }}>{error}</Text> : null}
          {usesCustomApiBase(current) || draft.trim() !== current ? (
            <NativeActionButton
              disabled={pending}
              label={t("Use default server")}
              onPress={() => void restoreDefault()}
              prominence="plain"
              style={{ marginTop: 28, alignSelf: "center" }}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
