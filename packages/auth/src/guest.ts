import type { AgeTier } from "@freecall/protocol";

export interface GuestCapabilities {
  canDm: boolean;
  canUpload: boolean;
  canEditProfile: boolean;
  maxDailyMinutes: number;
  elevatedSampling: boolean;
}

export function getGuestCapabilities(ageTier: AgeTier, guestMinutesPerDay: number = 30): GuestCapabilities {
  const isSelfDeclared = ageTier === "t0_declared";

  return {
    canDm: !isSelfDeclared,
    canUpload: !isSelfDeclared,
    canEditProfile: !isSelfDeclared,
    maxDailyMinutes: isSelfDeclared ? guestMinutesPerDay : Infinity,
    elevatedSampling: isSelfDeclared,
  };
}

export function isGuestCapExceeded(callMinutesUsedToday: number, allowedMinutes: number): boolean {
  if (allowedMinutes === Infinity) return false;
  return callMinutesUsedToday >= allowedMinutes;
}
