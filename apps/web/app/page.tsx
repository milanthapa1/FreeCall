import { headers } from "next/headers";
import { getTranslations, negotiateLocale } from "@freecall/i18n";
import { getResolvedMarket } from "@/lib/geo";
import { LandingFlow } from "@/components/LandingFlow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const headerList = await headers();
  const acceptLang = headerList.get("accept-language");
  const locale = negotiateLocale(acceptLang);
  const messages = getTranslations(locale);
  const { marketCode, decision } = await getResolvedMarket();

  // If the market is completely blocked, render the localized blocked notice
  if (!decision.enabled || !decision.matchingEnabled) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-zinc-950 p-6 text-center text-white">
        <div className="mx-auto size-16 place-items-center rounded-2xl bg-red-950/40 border border-red-800/60 grid text-3xl mb-4">
          🚫
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          {messages.blockedMarket.title}
        </h1>
        <p className="max-w-md text-sm text-zinc-400 mb-6">
          {messages.blockedMarket.message}
        </p>
        <span className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1 font-mono text-xs text-zinc-400">
          Region: {marketCode} | {decision.reasons.join(", ") || "Regulatory requirement"}
        </span>
      </div>
    );
  }

  return (
    <LandingFlow
      messages={messages}
      initialLocale={locale}
      marketCode={marketCode}
    />
  );
}
