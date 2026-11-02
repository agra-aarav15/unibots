/** @jsxRuntime automatic */
import type { TransactionalEmail } from "@rakazo/adapter-kit";
import { ANDROID_APK_URL, IOS_APP_STORE_URL } from "@rakazo/contracts";
import { displayName } from "@rakazo/core";
import { lightTokens } from "@rakazo/ui-tokens";
import { Hr, Link, Text } from "react-email";
import { linkStyle, message } from "./email.js";

const APPS = [
  ["iPhone", IOS_APP_STORE_URL],
  ["Android", ANDROID_APK_URL],
  ["Mac", "https://rakazo.com/api/download?platform=mac"],
  ["Windows", "https://rakazo.com/api/download?platform=windows"],
  ["Linux", "https://rakazo.com/api/download?platform=linux"],
] as const;

export function welcomeEmail(
  user: { email: string; name: string },
  unsubscribeUrl: string,
): Promise<TransactionalEmail> {
  return message(
    user.email,
    "Welcome to Unibots",
    <>
      <Text>Hi {displayName(user.name, "there")},</Text>
      <Text>Thanks for signing up for Unibots.</Text>
      <Text>
        Unibots also has apps for{" "}
        {APPS.map(([name, href], index) => (
          <span key={name}>
            {index === APPS.length - 1 ? "and " : ""}
            <Link href={href} style={linkStyle}>
              {name}
            </Link>
            {index === APPS.length - 1 ? "." : ", "}
          </span>
        ))}
      </Text>
      <Text>
        Questions or ideas?{" "}
        <Link href="https://discord.gg/RWwKa2Sn7h" style={linkStyle}>
          Join us on Discord
        </Link>
        .
      </Text>
      <Text>
        Unibots is open source. If you like it,{" "}
        <Link href="https://github.com/agra-aarav15/unibots" style={linkStyle}>
          a star on GitHub
        </Link>{" "}
        helps others find it.
      </Text>
      <Text>
        Want to run it on your own servers?{" "}
        <Link
          href="https://github.com/agra-aarav15/unibots/blob/main/docs/self-host.md"
          style={linkStyle}
        >
          Self-host Unibots
        </Link>
        .
      </Text>
      <Text>Have any questions? Reply to this email.</Text>
      <Text>Elie</Text>
      <Hr style={{ borderColor: lightTokens.border, marginTop: "32px" }} />
      <Text style={{ color: lightTokens.mutedForeground, fontSize: "12px" }}>
        <Link href={unsubscribeUrl} style={{ color: lightTokens.mutedForeground }}>
          Unsubscribe
        </Link>
      </Text>
    </>,
    {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  );
}
