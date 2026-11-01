// Starting catalog of entities, accounts and categories. The seed script
// upserts these by slug, so editing this file and re-seeding is safe.

type EntitySeed = {
  slug: string;
  name: string;
  kind: "personal" | "business" | "household" | "property" | "investment" | "custody";
  marcoShare?: string;
  currency?: string;
  sharedWithMoni?: boolean;
  shortcut: string;
};

export const ENTITIES: EntitySeed[] = [
  { slug: "personal", name: "Personal", kind: "personal", shortcut: "p" },
  { slug: "coaching", name: "Coaching", kind: "business", shortcut: "c" },
  { slug: "bora", name: "Bora Vida", kind: "business", shortcut: "b" },
  { slug: "adventure", name: "Adventure Planning", kind: "business", shortcut: "a" },
  { slug: "hogar-europa", name: "Hogar Europa", kind: "household", marcoShare: "0.5", currency: "EUR", sharedWithMoni: true, shortcut: "e" },
  { slug: "hogar-cabarete", name: "Hogar Cabarete", kind: "household", marcoShare: "0.5", sharedWithMoni: true, shortcut: "k" },
  { slug: "hogar-brasil", name: "Hogar Brasil", kind: "household", marcoShare: "0.5", sharedWithMoni: true, shortcut: "r" },
  { slug: "la-mariposa", name: "La Mariposa", kind: "property", marcoShare: "0.5", sharedWithMoni: true, shortcut: "m" },
  { slug: "marquis", name: "Marquis Panamá", kind: "property", marcoShare: "0.33", shortcut: "q" },
  { slug: "inversiones", name: "Inversiones", kind: "investment", shortcut: "i" },
  // Dad's USD/EUR that Marco manages; reported quarterly and paid out to him.
  { slug: "papa", name: "Papá (custodia)", kind: "custody", shortcut: "d" },
];

type AccountSeed = {
  slug: string;
  name: string;
  institution: string;
  currency: string;
  kind: "bank" | "savings" | "broker" | "cash" | "crypto";
  defaultEntity: string;
  hint?: string;
  active?: boolean;
};

const REVOLUT_HINT =
  "Cuenta comodín: gastos personales y de los hogares (Europa, Cabarete, Brasil); entran cobros de clientes de coaching de Europa y a veces se pagan gastos de coaching.";

export const ACCOUNTS: AccountSeed[] = [
  { slug: "revolut-eur", name: "Revolut EUR", institution: "Revolut", currency: "EUR", kind: "bank", defaultEntity: "personal", hint: REVOLUT_HINT },
  { slug: "revolut-usd", name: "Revolut USD", institution: "Revolut", currency: "USD", kind: "bank", defaultEntity: "personal", hint: REVOLUT_HINT },
  { slug: "revolut-ahorro-eur", name: "Revolut Ahorro EUR", institution: "Revolut", currency: "EUR", kind: "savings", defaultEntity: "inversiones" },
  { slug: "revolut-ahorro-usd", name: "Revolut Ahorro USD", institution: "Revolut", currency: "USD", kind: "savings", defaultEntity: "inversiones" },
  { slug: "revolut-pro", name: "Revolut Pro", institution: "Revolut", currency: "EUR", kind: "bank", defaultEntity: "coaching", hint: "Links de pago: cobros de clientes de coaching." },
  { slug: "brubank-ars", name: "Brubank ARS", institution: "Brubank", currency: "ARS", kind: "bank", defaultEntity: "coaching", hint: "Cobros de coaching de clientes de Argentina, impuestos y coaching de negocio, algunos pagos en Brasil." },
  { slug: "brubank-usd", name: "Brubank USD", institution: "Brubank", currency: "USD", kind: "bank", defaultEntity: "coaching", hint: "Cobros de coaching de clientes de Argentina en dólares." },
  { slug: "arq-usd", name: "ARQ USD", institution: "ARQ", currency: "USD", kind: "bank", defaultEntity: "coaching", hint: "Pago de ads del coaching (Meta, Google) y gastos de Argentina en dólares; también pagos en Brasil." },
  { slug: "cocos-usd", name: "Cocos USD", institution: "Cocos", currency: "USD", kind: "broker", defaultEntity: "inversiones", hint: "Inversión. A veces se pagan cosas del coaching o de la vida en Brasil." },
  { slug: "cocos-ars", name: "Cocos ARS", institution: "Cocos", currency: "ARS", kind: "broker", defaultEntity: "inversiones", hint: "Inversión. A veces se pagan cosas del coaching o de la vida en Brasil." },
  { slug: "wise-usd", name: "Wise USD", institution: "Wise", currency: "USD", kind: "savings", defaultEntity: "inversiones" },
  { slug: "wise-eur", name: "Wise EUR", institution: "Wise", currency: "EUR", kind: "savings", defaultEntity: "inversiones" },
  { slug: "bunq-eur", name: "Bunq EUR", institution: "Bunq", currency: "EUR", kind: "savings", defaultEntity: "inversiones" },
  { slug: "cash-usd", name: "Efectivo USD", institution: "Efectivo", currency: "USD", kind: "cash", defaultEntity: "hogar-cabarete", hint: "Entra de los negocios; se gasta mayormente en Cabarete o se le paga a mi papá intereses de los negocios." },
  { slug: "cash-eur", name: "Efectivo EUR", institution: "Efectivo", currency: "EUR", kind: "cash", defaultEntity: "hogar-europa" },
  { slug: "binance", name: "Binance", institution: "Binance", currency: "USDT", kind: "crypto", defaultEntity: "inversiones" },
  { slug: "crypto-com", name: "Crypto.com", institution: "Crypto.com", currency: "USDT", kind: "crypto", defaultEntity: "inversiones" },
  { slug: "ibkr", name: "IBKR", institution: "Interactive Brokers", currency: "USD", kind: "broker", defaultEntity: "inversiones" },
  // Moved to ARQ in 2026; kept for history only.
  { slug: "usdt", name: "USDT", institution: "Crypto", currency: "USDT", kind: "crypto", defaultEntity: "personal", active: false },
];

export const CATEGORIES: Record<string, string[]> = {
  personal: ["Comida", "Restaurantes", "Transporte", "Viajes", "Salud", "Ropa", "Suscripciones", "Educación", "Regalos", "Impuestos", "Otros"],
  business: ["Cobro cliente", "Retiro", "Ads", "Software", "Coaching de negocio", "Monotributo", "Comisiones", "Intereses a papá", "Otros"],
  household: ["Alquiler", "Supermercado", "Restaurantes", "Servicios", "Transporte", "Casa", "Otros"],
  property: ["Aporte", "Distribución", "Mantenimiento", "Impuestos", "Otros"],
  investment: ["Intereses", "Rendimiento", "Comisiones"],
  custody: ["Intereses", "Intereses Ibiza", "Panamá", "Pago a papá", "Otros"],
};

// Rules known up front; everything else is learned from confirmations.
export const SEED_RULES: { pattern: string; entity?: string; category?: string; direction?: "in" | "out"; kind?: "transfer" }[] = [
  { pattern: "exchanged to", kind: "transfer" },
  { pattern: "exchanged from", kind: "transfer" },
  { pattern: "monotributo", entity: "coaching", category: "Monotributo", direction: "out" },
  { pattern: "arca", entity: "coaching", category: "Monotributo", direction: "out" },
  { pattern: "afip", entity: "coaching", category: "Monotributo", direction: "out" },
  { pattern: "facebk", entity: "coaching", category: "Ads", direction: "out" },
  { pattern: "meta ads", entity: "coaching", category: "Ads", direction: "out" },
  { pattern: "google ads", entity: "coaching", category: "Ads", direction: "out" },
];

// Dad's balances on 2026-01-01, from his quarterly sheet.
export const CUSTODY_OPENING = [
  { description: "Saldo inicial papá: banco USD", amount: "46859", currency: "USD" },
  { description: "Saldo inicial papá: efectivo USD", amount: "30405", currency: "USD" },
  { description: "Saldo inicial papá: banco EUR", amount: "25000", currency: "EUR" },
];
