import OpenAI from "openai";

const _p = "AI_INTEGRATIONS";
const _n = "OPENROUTER";

let _openrouter: OpenAI | null = null;

function createClient(): OpenAI {
  const baseURL = process.env[`${_p}_${_n}_BASE_URL`];
  const apiKey = process.env[`${_p}_${_n}_API_KEY`];
  if (!baseURL || !apiKey) {
    throw new Error(
      "OpenRouter AI integration is not configured. Please set the API Key and Base URL in the settings panel.",
    );
  }
  return new OpenAI({ baseURL, apiKey });
}

export const openrouter: OpenAI = new Proxy({} as OpenAI, {
  get(_target, prop) {
    if (!_openrouter) {
      _openrouter = createClient();
    }
    const value = (_openrouter as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(_openrouter) : value;
  },
});
