import { z } from "zod";
import { registerTool } from "./registry.js";
import { config } from "../config.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "https://api.octopus.energy";
const GRAPHQL_URL = "https://api.octopus.energy/v1/graphql/";
const GAS_VOLUME_CORRECTION = 1.02264;
const GAS_CALORIFIC_VALUE = 39.5;
const GAS_KWH_DIVISOR = 3.6;
const FETCH_TIMEOUT_MS = 15_000;
const GRAPHQL_TOKEN_LIFETIME_MS = 55 * 60 * 1000; // 55 minutes (tokens last 60)

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function basicAuthHeader(apiKey: string): string {
  return "Basic " + Buffer.from(`${apiKey}:`).toString("base64");
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function octopusFetch(
  path: string,
  apiKey: string,
  params?: Record<string, string>,
): Promise<any> {
  const url = new URL(path, BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") {
        url.searchParams.set(key, value);
      }
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        Authorization: basicAuthHeader(apiKey),
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// GraphQL token management
// ---------------------------------------------------------------------------

let graphqlToken: string | null = null;
let graphqlTokenExpiresAt = 0;

async function ensureGraphqlToken(apiKey: string): Promise<string> {
  if (graphqlToken && Date.now() < graphqlTokenExpiresAt - 60_000) {
    return graphqlToken;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `mutation { obtainKrakenToken(input: { APIKey: "${apiKey}" }) { token } }`,
      }),
    });

    const json = await res.json();
    const token = json?.data?.obtainKrakenToken?.token;
    if (!token) {
      const errMsg = json?.errors?.[0]?.message ?? "Unknown GraphQL auth error";
      throw new Error(`GraphQL auth failed: ${errMsg}`);
    }

    graphqlToken = token;
    graphqlTokenExpiresAt = Date.now() + GRAPHQL_TOKEN_LIFETIME_MS;
    return token;
  } finally {
    clearTimeout(timer);
  }
}

async function graphqlQuery(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
  _isRetry = false,
): Promise<any> {
  const token = await ensureGraphqlToken(apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
      },
      body: JSON.stringify({ query, variables }),
    });

    const json = await res.json();

    // Check for auth errors and retry once with a fresh token
    const errors = json?.errors ?? [];
    const isAuthError = errors.some(
      (e: any) => e?.extensions?.errorType === "AUTHORIZATION",
    );
    if (isAuthError && !_isRetry) {
      graphqlToken = null;
      graphqlTokenExpiresAt = 0;
      return graphqlQuery(apiKey, query, variables, true);
    }

    if (errors.length > 0 && !json?.data) {
      throw new Error(`GraphQL error: ${errors[0]?.message ?? "Unknown error"}`);
    }

    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Account data cache
// ---------------------------------------------------------------------------

interface MeterInfo {
  mpanOrMprn: string;
  serial: string;
  tariffCode: string;
}

interface AccountCache {
  electricity: MeterInfo | null;
  gas: MeterInfo | null;
  fetchedAt: number;
}

let accountCache: AccountCache | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function extractProductCode(tariffCode: string): string {
  // Tariff format: {fuel}-{registers}R-{product_code}-{region}
  // e.g. E-1R-VAR-22-11-01-N => product = VAR-22-11-01
  // Split on "-", drop first 2 segments and last segment, rejoin
  const parts = tariffCode.split("-");
  if (parts.length < 4) return tariffCode;
  return parts.slice(2, -1).join("-");
}

function findCurrentTariff(agreements: any[]): string | null {
  const now = new Date();
  for (const agreement of agreements) {
    const validTo = agreement.valid_to ? new Date(agreement.valid_to) : null;
    if (validTo === null || validTo > now) {
      return agreement.tariff_code;
    }
  }
  return null;
}

async function ensureAccountData(apiKey: string, accountNumber: string): Promise<AccountCache> {
  if (accountCache && Date.now() - accountCache.fetchedAt < CACHE_TTL_MS) {
    return accountCache;
  }

  const data = await octopusFetch(`/v1/accounts/${accountNumber}/`, apiKey);

  let electricity: MeterInfo | null = null;
  let gas: MeterInfo | null = null;

  // Account may have multiple properties; use the first one with meter points
  for (const property of data.properties ?? []) {
    if (!electricity) {
      for (const emp of property.electricity_meter_points ?? []) {
        // Skip export meters
        if (emp.is_export) continue;
        const tariff = findCurrentTariff(emp.agreements ?? []);
        if (tariff && emp.meters?.length > 0) {
          electricity = {
            mpanOrMprn: emp.mpan,
            serial: emp.meters[0].serial_number,
            tariffCode: tariff,
          };
          break;
        }
      }
    }

    if (!gas) {
      for (const gmp of property.gas_meter_points ?? []) {
        const tariff = findCurrentTariff(gmp.agreements ?? []);
        if (tariff && gmp.meters?.length > 0) {
          gas = {
            mpanOrMprn: gmp.mprn,
            serial: gmp.meters[0].serial_number,
            tariffCode: tariff,
          };
          break;
        }
      }
    }
  }

  accountCache = { electricity, gas, fetchedAt: Date.now() };
  return accountCache;
}

// ---------------------------------------------------------------------------
// Gas conversion
// ---------------------------------------------------------------------------

function gasM3ToKwh(m3: number): number {
  return (m3 * GAS_VOLUME_CORRECTION * GAS_CALORIFIC_VALUE) / GAS_KWH_DIVISOR;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function todayMidnightISO(): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

function nowISO(): string {
  return new Date().toISOString();
}

function toISODatetime(dateStr: string): string {
  // If already has T, assume it's ISO-ish; ensure trailing Z if no offset
  if (dateStr.includes("T")) {
    if (!dateStr.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(dateStr)) {
      return dateStr + "Z";
    }
    return dateStr;
  }
  // Plain date like 2026-03-14 => midnight UTC
  return dateStr + "T00:00:00Z";
}

// ---------------------------------------------------------------------------
// Consumption fetcher
// ---------------------------------------------------------------------------

interface ConsumptionRecord {
  interval_start: string;
  interval_end: string;
  consumption: number;
}

async function fetchConsumption(
  apiKey: string,
  meter: MeterInfo,
  fuel: "electricity" | "gas",
  periodFrom: string,
  periodTo: string,
  groupBy?: string,
): Promise<ConsumptionRecord[]> {
  const meterType = fuel === "electricity" ? "electricity-meter-points" : "gas-meter-points";
  const path = `/v1/${meterType}/${meter.mpanOrMprn}/meters/${meter.serial}/consumption/`;

  const params: Record<string, string> = {
    page_size: "25000",
    order_by: "period",
    period_from: periodFrom,
    period_to: periodTo,
  };

  // half_hour is the default — omit group_by for it
  if (groupBy && groupBy !== "half_hour") {
    params.group_by = groupBy;
  }

  const data = await octopusFetch(path, apiKey, params);
  const results: ConsumptionRecord[] = data.results ?? [];

  // Convert gas from m3 to kWh if needed
  if (fuel === "gas") {
    for (const r of results) {
      r.consumption = gasM3ToKwh(r.consumption);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Tariff fetcher
// ---------------------------------------------------------------------------

interface TariffRates {
  unitRate: number | null;   // p/kWh inc VAT
  standingCharge: number | null; // p/day inc VAT
  upcomingRates: Array<{ validFrom: string; validTo: string | null; value: number }>;
}

async function fetchTariffRates(
  apiKey: string,
  productCode: string,
  tariffCode: string,
  fuel: "electricity" | "gas",
): Promise<TariffRates> {
  const tariffType = fuel === "electricity" ? "electricity-tariffs" : "gas-tariffs";

  let unitRate: number | null = null;
  let standingCharge: number | null = null;
  const upcomingRates: TariffRates["upcomingRates"] = [];

  try {
    const unitData = await octopusFetch(
      `/v1/products/${productCode}/${tariffType}/${tariffCode}/standard-unit-rates/`,
      apiKey,
    );
    const unitResults = unitData.results ?? [];
    if (unitResults.length > 0) {
      // Find current rate (valid_to is null or in future)
      const now = new Date();
      for (const r of unitResults) {
        const validTo = r.valid_to ? new Date(r.valid_to) : null;
        if (validTo === null || validTo > now) {
          if (unitRate === null) {
            unitRate = r.value_inc_vat;
          }
          // Collect upcoming rate changes
          if (r.valid_from && new Date(r.valid_from) > now) {
            upcomingRates.push({
              validFrom: r.valid_from,
              validTo: r.valid_to,
              value: r.value_inc_vat,
            });
          }
        }
      }
      // Fallback: use the first result if no current one found
      if (unitRate === null && unitResults.length > 0) {
        unitRate = unitResults[0].value_inc_vat;
      }
    }
  } catch (err: any) {
    console.error(`[octopus] Failed to fetch unit rates for ${tariffCode}: ${err.message}`);
  }

  try {
    const scData = await octopusFetch(
      `/v1/products/${productCode}/${tariffType}/${tariffCode}/standing-charges/`,
      apiKey,
    );
    const scResults = scData.results ?? [];
    if (scResults.length > 0) {
      const now = new Date();
      for (const r of scResults) {
        const validTo = r.valid_to ? new Date(r.valid_to) : null;
        if (validTo === null || validTo > now) {
          standingCharge = r.value_inc_vat;
          break;
        }
      }
      if (standingCharge === null) {
        standingCharge = scResults[0].value_inc_vat;
      }
    }
  } catch (err: any) {
    console.error(`[octopus] Failed to fetch standing charges for ${tariffCode}: ${err.message}`);
  }

  return { unitRate, standingCharge, upcomingRates };
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleSummary(apiKey: string, accountNumber: string): Promise<string> {
  const account = await ensureAccountData(apiKey, accountNumber);

  const periodFrom = todayMidnightISO();
  const periodTo = nowISO();
  const lines: string[] = [];
  let totalCostPounds = 0;

  // Electricity
  if (account.electricity) {
    const productCode = extractProductCode(account.electricity.tariffCode);
    const [consumption, rates] = await Promise.all([
      fetchConsumption(apiKey, account.electricity, "electricity", periodFrom, periodTo).catch(() => []),
      fetchTariffRates(apiKey, productCode, account.electricity.tariffCode, "electricity").catch(() => ({ unitRate: null, standingCharge: null, upcomingRates: [] })),
    ]);

    const totalKwh = consumption.reduce((sum, r) => sum + r.consumption, 0);
    const unitCostPounds = rates.unitRate != null ? (totalKwh * rates.unitRate) / 100 : 0;
    const standingPounds = rates.standingCharge != null ? rates.standingCharge / 100 : 0;
    const costPounds = unitCostPounds + standingPounds;
    totalCostPounds += costPounds;

    lines.push("**Electricity**");
    lines.push(`  Usage today: ${totalKwh.toFixed(2)} kWh`);
    if (rates.unitRate != null) {
      lines.push(`  Unit rate: ${rates.unitRate.toFixed(2)}p/kWh (inc VAT)`);
    }
    if (rates.standingCharge != null) {
      lines.push(`  Standing charge: ${rates.standingCharge.toFixed(2)}p/day (inc VAT)`);
    }
    lines.push(`  Est. cost today: \u00A3${costPounds.toFixed(2)}`);
    if (consumption.length === 0) {
      lines.push("  (No consumption data yet -- smart meter data has a 24-48h delay)");
    }
    lines.push("");
  } else {
    lines.push("**Electricity**: No meter found on account");
    lines.push("");
  }

  // Gas
  if (account.gas) {
    const productCode = extractProductCode(account.gas.tariffCode);
    const [consumption, rates] = await Promise.all([
      fetchConsumption(apiKey, account.gas, "gas", periodFrom, periodTo).catch(() => []),
      fetchTariffRates(apiKey, productCode, account.gas.tariffCode, "gas").catch(() => ({ unitRate: null, standingCharge: null, upcomingRates: [] })),
    ]);

    const totalKwh = consumption.reduce((sum, r) => sum + r.consumption, 0);
    const unitCostPounds = rates.unitRate != null ? (totalKwh * rates.unitRate) / 100 : 0;
    const standingPounds = rates.standingCharge != null ? rates.standingCharge / 100 : 0;
    const costPounds = unitCostPounds + standingPounds;
    totalCostPounds += costPounds;

    lines.push("**Gas**");
    lines.push(`  Usage today: ${totalKwh.toFixed(2)} kWh`);
    if (rates.unitRate != null) {
      lines.push(`  Unit rate: ${rates.unitRate.toFixed(2)}p/kWh (inc VAT)`);
    }
    if (rates.standingCharge != null) {
      lines.push(`  Standing charge: ${rates.standingCharge.toFixed(2)}p/day (inc VAT)`);
    }
    lines.push(`  Est. cost today: \u00A3${costPounds.toFixed(2)}`);
    if (consumption.length === 0) {
      lines.push("  (No consumption data yet -- smart meter data has a 24-48h delay)");
    }
    lines.push("");
  } else {
    lines.push("**Gas**: No meter found on account");
    lines.push("");
  }

  lines.push(`**Total est. cost today: \u00A3${totalCostPounds.toFixed(2)}**`);

  // Append account balance from GraphQL
  try {
    const balancePence = await fetchAccountBalance(apiKey, accountNumber);
    if (balancePence != null) {
      const balanceStr = formatPence(balancePence);
      const label = balancePence >= 0 ? "in credit" : "owed";
      lines.push("");
      lines.push(`**Account balance: ${balanceStr} (${label})**`);
    }
  } catch {
    lines.push("");
    lines.push("**Account balance: unavailable**");
  }

  return lines.join("\n");
}

async function handleUsage(
  apiKey: string,
  accountNumber: string,
  periodFrom?: string,
  periodTo?: string,
  groupBy?: string,
  fuel?: string,
): Promise<string> {
  const account = await ensureAccountData(apiKey, accountNumber);

  const from = periodFrom ? toISODatetime(periodFrom) : todayMidnightISO();
  const to = periodTo ? toISODatetime(periodTo) : nowISO();
  const group = groupBy ?? "day";
  const fuelFilter = fuel ?? "both";

  const lines: string[] = [];

  if ((fuelFilter === "both" || fuelFilter === "electricity") && account.electricity) {
    const consumption = await fetchConsumption(
      apiKey, account.electricity, "electricity", from, to, group,
    );

    lines.push("**Electricity Usage**");
    if (consumption.length === 0) {
      lines.push("  No data available (smart meter data has a 24-48h delay)");
    } else {
      let total = 0;
      for (const r of consumption) {
        const start = new Date(r.interval_start);
        const label = group === "half_hour" || group === "hour"
          ? start.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })
          : start.toLocaleDateString("en-GB", { dateStyle: "medium" });
        lines.push(`  ${label}: ${r.consumption.toFixed(3)} kWh`);
        total += r.consumption;
      }
      lines.push(`  **Total: ${total.toFixed(2)} kWh**`);
    }
    lines.push("");
  } else if (fuelFilter === "electricity" && !account.electricity) {
    lines.push("**Electricity**: No meter found on account");
    lines.push("");
  }

  if ((fuelFilter === "both" || fuelFilter === "gas") && account.gas) {
    const consumption = await fetchConsumption(
      apiKey, account.gas, "gas", from, to, group,
    );

    lines.push("**Gas Usage**");
    if (consumption.length === 0) {
      lines.push("  No data available (smart meter data has a 24-48h delay)");
    } else {
      let total = 0;
      for (const r of consumption) {
        const start = new Date(r.interval_start);
        const label = group === "half_hour" || group === "hour"
          ? start.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })
          : start.toLocaleDateString("en-GB", { dateStyle: "medium" });
        lines.push(`  ${label}: ${r.consumption.toFixed(3)} kWh`);
        total += r.consumption;
      }
      lines.push(`  **Total: ${total.toFixed(2)} kWh**`);
    }
    lines.push("");
  } else if (fuelFilter === "gas" && !account.gas) {
    lines.push("**Gas**: No meter found on account");
    lines.push("");
  }

  if (lines.length === 0) {
    return "No meter data available for the requested fuel type.";
  }

  return lines.join("\n");
}

async function handleTariff(apiKey: string, accountNumber: string): Promise<string> {
  const account = await ensureAccountData(apiKey, accountNumber);
  const lines: string[] = [];

  if (account.electricity) {
    const productCode = extractProductCode(account.electricity.tariffCode);
    const rates = await fetchTariffRates(
      apiKey, productCode, account.electricity.tariffCode, "electricity",
    );

    lines.push("**Electricity Tariff**");
    lines.push(`  Tariff code: ${account.electricity.tariffCode}`);
    lines.push(`  Product: ${productCode}`);
    if (rates.unitRate != null) {
      lines.push(`  Unit rate: ${rates.unitRate.toFixed(2)}p/kWh (inc VAT)`);
    } else {
      lines.push("  Unit rate: unavailable");
    }
    if (rates.standingCharge != null) {
      lines.push(`  Standing charge: ${rates.standingCharge.toFixed(2)}p/day (inc VAT)`);
    } else {
      lines.push("  Standing charge: unavailable");
    }
    if (rates.upcomingRates.length > 0) {
      lines.push("  Upcoming rate changes:");
      for (const r of rates.upcomingRates.slice(0, 5)) {
        const from = new Date(r.validFrom).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
        const toStr = r.validTo
          ? new Date(r.validTo).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
          : "ongoing";
        lines.push(`    ${from} - ${toStr}: ${r.value.toFixed(2)}p/kWh`);
      }
    }
    lines.push("");
  } else {
    lines.push("**Electricity**: No meter found on account");
    lines.push("");
  }

  if (account.gas) {
    const productCode = extractProductCode(account.gas.tariffCode);
    const rates = await fetchTariffRates(
      apiKey, productCode, account.gas.tariffCode, "gas",
    );

    lines.push("**Gas Tariff**");
    lines.push(`  Tariff code: ${account.gas.tariffCode}`);
    lines.push(`  Product: ${productCode}`);
    if (rates.unitRate != null) {
      lines.push(`  Unit rate: ${rates.unitRate.toFixed(2)}p/kWh (inc VAT)`);
    } else {
      lines.push("  Unit rate: unavailable");
    }
    if (rates.standingCharge != null) {
      lines.push(`  Standing charge: ${rates.standingCharge.toFixed(2)}p/day (inc VAT)`);
    } else {
      lines.push("  Standing charge: unavailable");
    }
    if (rates.upcomingRates.length > 0) {
      lines.push("  Upcoming rate changes:");
      for (const r of rates.upcomingRates.slice(0, 5)) {
        const from = new Date(r.validFrom).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
        const toStr = r.validTo
          ? new Date(r.validTo).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
          : "ongoing";
        lines.push(`    ${from} - ${toStr}: ${r.value.toFixed(2)}p/kWh`);
      }
    }
    lines.push("");
  } else {
    lines.push("**Gas**: No meter found on account");
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// GraphQL helpers
// ---------------------------------------------------------------------------

async function fetchAccountBalance(apiKey: string, accountNumber: string): Promise<number | null> {
  try {
    const data = await graphqlQuery(apiKey, `
      query($account: String!) {
        account(accountNumber: $account) {
          balance
        }
      }
    `, { account: accountNumber });
    const balance = data?.account?.balance;
    return typeof balance === "number" ? balance : null;
  } catch (err: any) {
    console.error(`[octopus] Failed to fetch account balance: ${err.message}`);
    return null;
  }
}

function formatPence(pence: number): string {
  const pounds = pence / 100;
  const sign = pounds < 0 ? "-" : "";
  return `${sign}\u00A3${Math.abs(pounds).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Bills handler
// ---------------------------------------------------------------------------

async function handleBills(apiKey: string, accountNumber: string): Promise<string> {
  const data = await graphqlQuery(apiKey, `
    query($account: String!) {
      account(accountNumber: $account) {
        balance
        bills(first: 10) {
          edges {
            node {
              ... on StatementType {
                id
                fromDate
                toDate
                issuedDate
                closingBalance
                openingBalance
              }
            }
          }
        }
      }
    }
  `, { account: accountNumber });

  const account = data?.account;
  if (!account) {
    return "Error: Could not retrieve account data via GraphQL.";
  }

  const lines: string[] = [];

  // Account balance (in pence)
  const balance: number | null = typeof account.balance === "number" ? account.balance : null;
  if (balance != null) {
    const balanceStr = formatPence(balance);
    const label = balance >= 0 ? "in credit" : "owed";
    lines.push(`**Account Balance**: ${balanceStr} (${label})`);
  } else {
    lines.push("**Account Balance**: unavailable");
  }
  lines.push("");

  // Recent bills
  const edges = account.bills?.edges ?? [];
  if (edges.length === 0) {
    lines.push("**Recent Bills**: none found");
  } else {
    lines.push("**Recent Bills**");
    for (const edge of edges) {
      const bill = edge?.node;
      if (!bill) continue;

      const fromDate = bill.fromDate
        ? new Date(bill.fromDate).toLocaleDateString("en-GB", { dateStyle: "medium" })
        : "?";
      const toDate = bill.toDate
        ? new Date(bill.toDate).toLocaleDateString("en-GB", { dateStyle: "medium" })
        : "?";
      const issuedDate = bill.issuedDate
        ? new Date(bill.issuedDate).toLocaleDateString("en-GB", { dateStyle: "medium" })
        : "";

      const parts = [`  ${fromDate} - ${toDate}`];
      if (issuedDate) parts.push(`issued ${issuedDate}`);
      if (typeof bill.openingBalance === "number" && typeof bill.closingBalance === "number") {
        parts.push(`opening ${formatPence(bill.openingBalance)}, closing ${formatPence(bill.closingBalance)}`);
      }
      lines.push(parts.join(" | "));
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Compare handler
// ---------------------------------------------------------------------------

function mondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function handleCompare(
  apiKey: string,
  accountNumber: string,
  periodFrom?: string,
  periodTo?: string,
  compareFrom?: string,
  compareTo?: string,
  fuel?: string,
): Promise<string> {
  const account = await ensureAccountData(apiKey, accountNumber);
  const fuelFilter = fuel ?? "both";

  // Default current period: this week (Mon-Sun)
  const now = new Date();
  const currentFrom = periodFrom
    ? new Date(toISODatetime(periodFrom))
    : mondayOfWeek(now);
  const currentTo = periodTo
    ? new Date(toISODatetime(periodTo))
    : addDays(mondayOfWeek(now), 7);

  const periodLengthMs = currentTo.getTime() - currentFrom.getTime();
  const periodLengthDays = Math.max(1, Math.round(periodLengthMs / (24 * 60 * 60 * 1000)));

  // Default comparison period: previous week (same length)
  const compFrom = compareFrom
    ? new Date(toISODatetime(compareFrom))
    : new Date(currentFrom.getTime() - periodLengthMs);
  const compTo = compareTo
    ? new Date(toISODatetime(compareTo))
    : new Date(currentTo.getTime() - periodLengthMs);

  const currentFromISO = currentFrom.toISOString();
  const currentToISO = currentTo.toISOString();
  const compFromISO = compFrom.toISOString();
  const compToISO = compTo.toISOString();

  const lines: string[] = ["**Energy Comparison**", ""];

  let totalCostCurrent = 0;
  let totalCostPrevious = 0;

  const fuels: Array<{ key: "electricity" | "gas"; label: string; meter: MeterInfo | null }> = [];
  if (fuelFilter === "both" || fuelFilter === "electricity") {
    fuels.push({ key: "electricity", label: "Electricity", meter: account.electricity });
  }
  if (fuelFilter === "both" || fuelFilter === "gas") {
    fuels.push({ key: "gas", label: "Gas", meter: account.gas });
  }

  for (const { key, label, meter } of fuels) {
    if (!meter) {
      lines.push(`**${label}**: No meter found on account`);
      lines.push("");
      continue;
    }

    const productCode = extractProductCode(meter.tariffCode);

    const [currentConsumption, previousConsumption, rates] = await Promise.all([
      fetchConsumption(apiKey, meter, key, currentFromISO, currentToISO).catch(() => []),
      fetchConsumption(apiKey, meter, key, compFromISO, compToISO).catch(() => []),
      fetchTariffRates(apiKey, productCode, meter.tariffCode, key).catch(
        () => ({ unitRate: null, standingCharge: null, upcomingRates: [] }),
      ),
    ]);

    const currentKwh = currentConsumption.reduce((s, r) => s + r.consumption, 0);
    const previousKwh = previousConsumption.reduce((s, r) => s + r.consumption, 0);

    // Cost calculation: unit cost + standing charges for the period
    const unitRatePounds = (rates.unitRate ?? 0) / 100;
    const standingDailyPounds = (rates.standingCharge ?? 0) / 100;

    const currentCost = currentKwh * unitRatePounds + standingDailyPounds * periodLengthDays;
    const previousCost = previousKwh * unitRatePounds + standingDailyPounds * periodLengthDays;
    totalCostCurrent += currentCost;
    totalCostPrevious += previousCost;

    const kwhDiff = currentKwh - previousKwh;
    const kwhPct = previousKwh > 0 ? (kwhDiff / previousKwh) * 100 : 0;
    const sign = kwhDiff >= 0 ? "+" : "";

    lines.push(`**${label}**`);
    lines.push(`  This period: ${currentKwh.toFixed(1)} kWh (\u00A3${currentCost.toFixed(2)})`);
    lines.push(`  Last period: ${previousKwh.toFixed(1)} kWh (\u00A3${previousCost.toFixed(2)})`);
    lines.push(`  Change: ${sign}${kwhDiff.toFixed(1)} kWh (${sign}${kwhPct.toFixed(1)}%)`);

    if (currentConsumption.length === 0) {
      lines.push("  (No data for current period -- smart meter data has a 24-48h delay)");
    }
    if (previousConsumption.length === 0) {
      lines.push("  (No data for comparison period)");
    }
    lines.push("");
  }

  // Total cost change
  const costDiff = totalCostCurrent - totalCostPrevious;
  const costPct = totalCostPrevious > 0 ? (costDiff / totalCostPrevious) * 100 : 0;
  const costSign = costDiff >= 0 ? "+" : "";
  lines.push(`**Total cost change: ${costSign}\u00A3${Math.abs(costDiff).toFixed(2)} (${costSign}${costPct.toFixed(1)}%)**`);

  // Add period labels
  const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { dateStyle: "medium" });
  lines.push("");
  lines.push(`Current period: ${fmtDate(currentFrom)} - ${fmtDate(currentTo)}`);
  lines.push(`Comparison period: ${fmtDate(compFrom)} - ${fmtDate(compTo)}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

registerTool({
  name: "octopus_energy",
  category: "always",
  description:
    "Query Octopus Energy account data. " +
    "Actions: summary (today's usage + costs + balance), usage (consumption data for a period), " +
    "tariff (current rates), bills (account balance + recent bills), compare (compare two periods). " +
    "Requires OCTOPUS_API_KEY and OCTOPUS_ACCOUNT_NUMBER env vars.",
  zodSchema: {
    action: z.enum(["summary", "usage", "tariff", "bills", "compare"]),
    period_from: z.string().optional().describe("ISO 8601 date, e.g. 2026-03-14"),
    period_to: z.string().optional().describe("ISO 8601 date, e.g. 2026-03-15"),
    group_by: z.enum(["half_hour", "hour", "day", "week", "month"]).optional(),
    fuel: z.enum(["electricity", "gas", "both"]).optional(),
    compare_from: z.string().optional().describe("Start of comparison period, ISO 8601 date"),
    compare_to: z.string().optional().describe("End of comparison period, ISO 8601 date"),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["summary", "usage", "tariff", "bills", "compare"],
        description:
          "summary: today's electricity + gas usage, costs, and current rates. " +
          "usage: consumption data for a date range (defaults to today, grouped by day). " +
          "tariff: current tariff codes, unit rates, and standing charges. " +
          "bills: account balance and recent billing statements. " +
          "compare: compare energy usage between two periods (defaults to this week vs last week).",
      },
      period_from: {
        type: "string",
        description: "Start date in ISO 8601 format, e.g. 2026-03-14. Defaults to start of today (or this Monday for compare).",
      },
      period_to: {
        type: "string",
        description: "End date in ISO 8601 format, e.g. 2026-03-15. Defaults to now (or this Sunday for compare).",
      },
      group_by: {
        type: "string",
        enum: ["half_hour", "hour", "day", "week", "month"],
        description: "Aggregation period. Defaults to day.",
      },
      fuel: {
        type: "string",
        enum: ["electricity", "gas", "both"],
        description: "Which fuel to query. Defaults to both.",
      },
      compare_from: {
        type: "string",
        description: "Start of comparison period in ISO 8601 format. Defaults to previous week.",
      },
      compare_to: {
        type: "string",
        description: "End of comparison period in ISO 8601 format. Defaults to same length as current period.",
      },
    },
  },
  execute: async (args: any): Promise<string> => {
    const apiKey = config.octopus.apiKey;
    const accountNumber = config.octopus.accountNumber;

    if (!apiKey || !accountNumber) {
      return "Error: Octopus Energy not configured. Set OCTOPUS_API_KEY and OCTOPUS_ACCOUNT_NUMBER environment variables.";
    }

    const { action, period_from, period_to, group_by, fuel, compare_from, compare_to } = args;

    try {
      switch (action) {
        case "summary":
          return await handleSummary(apiKey, accountNumber);

        case "usage":
          return await handleUsage(apiKey, accountNumber, period_from, period_to, group_by, fuel);

        case "tariff":
          return await handleTariff(apiKey, accountNumber);

        case "bills":
          return await handleBills(apiKey, accountNumber);

        case "compare":
          return await handleCompare(
            apiKey, accountNumber, period_from, period_to, compare_from, compare_to, fuel,
          );

        default:
          return `Unknown action: ${action}`;
      }
    } catch (err: any) {
      console.error("[octopus_energy] Error:", err.message);
      return `Error querying Octopus Energy: ${err.message}`;
    }
  },
});

console.log("[tools] octopus_energy registered");
