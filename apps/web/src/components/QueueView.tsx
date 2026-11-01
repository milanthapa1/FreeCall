"use client";

interface QueueViewProps {
  positionBand?: "short" | "medium" | "long";
  country?: string;
  mode?: string;
  onCancel: () => void;
}

export function QueueView({
  positionBand = "short",
  country = "any",
  mode = "solo",
  onCancel,
}: QueueViewProps) {
  const bandDescription = {
    short: "Finding someone right away...",
    medium: "Searching across active users...",
    long: "Widening search to find the best match...",
  }[positionBand];

  return (
    <div className="relative flex min-h-[60vh] w-full max-w-lg flex-col items-center justify-center rounded-2xl border border-white/10 bg-zinc-900/80 p-8 text-center shadow-2xl backdrop-blur-md">
      {/* Radar pulse animation */}
      <div className="relative mb-8 flex h-32 w-32 items-center justify-center">
        <div className="absolute h-full w-full animate-ping rounded-full bg-emerald-500/20 duration-1000" />
        <div className="absolute h-24 w-24 animate-pulse rounded-full bg-emerald-500/30" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/30">
          <svg
            className="h-8 w-8 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </div>
      </div>

      <h2 className="mb-2 text-2xl font-bold tracking-tight text-white">Looking for a Partner</h2>
      <p className="mb-6 text-sm text-zinc-400">{bandDescription}</p>

      {/* Preferences Pill */}
      <div className="mb-8 flex flex-wrap items-center justify-center gap-2">
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-300">
          Mode: <strong className="text-white capitalize">{mode}</strong>
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-300">
          Country: <strong className="text-white uppercase">{country}</strong>
        </span>
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="w-full rounded-xl bg-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
      >
        Cancel Search
      </button>
    </div>
  );
}
