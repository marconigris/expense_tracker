// No server-only imports here: client components use these too.
export const PARTNER_AREAS = { brasil: "hogar-brasil", cabarete: "hogar-cabarete", europa: "hogar-europa", personal: null, camp: null } as const;
export const PARTNER_AREA_LABELS: Record<string, string> = { brasil: "Brasil", cabarete: "Cabarete", europa: "Europa", personal: "Personal", camp: "Camp" };
/** Moni's own areas: only in her view, never in the balance with Marco. */
export const PRIVATE_PARTNER_AREAS = ["personal", "camp"];
/** Business spending: shown per month but kept out of her consumption total. */
export const BUSINESS_PARTNER_AREAS = ["camp"];
