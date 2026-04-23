import Anthropic from "@anthropic-ai/sdk";

const _p = "AI_INTEGRATIONS";
const _n = "ANTHROPIC";

let _anthropic: Anthropic | null = null;
let _configSnapshot = "";

function getConfigSnapshot(): string {
  return `${process.env[`${_p}_${_n}_BASE_URL`] ?? ""}|${process.env[`${_p}_${_n}_API_KEY`] ?? ""}`;
}

function createClient(): Anthropic {
  const baseURL = process.env[`${_p}_${_n}_BASE_URL`];
  const apiKey = process.env[`${_p}_${_n}_API_KEY`];
  if (!baseURL || !apiKey) {
    throw new Error(
      "Anthropic AI integration is not configured. Please set the API Key and Base URL in the settings panel.",
    );
  }
  return new Anthropic({ apiKey, baseURL });
}

export const anthropic: Anthropic = new Proxy({} as Anthropic, {
  get(_target, prop) {
    const snapshot = getConfigSnapshot();
    if (!_anthropic || _configSnapshot !== snapshot) {
      _anthropic = createClient();
      _configSnapshot = snapshot;
    }
    const value = (_anthropic as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(_anthropic) : value;
  },
});
