import OpenAI from "openai";

const _p = "AI_INTEGRATIONS";
const _n = "OPENAI";

function createOpenAIClient(): OpenAI {
  const baseURL = process.env[`${_p}_${_n}_BASE_URL`];
  const apiKey = process.env[`${_p}_${_n}_API_KEY`];

  if (!baseURL) {
    throw new Error(
      `${_p}_${_n}_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?`,
    );
  }

  if (!apiKey) {
    throw new Error(
      `${_p}_${_n}_API_KEY must be set. Did you forget to provision the OpenAI AI integration?`,
    );
  }

  return new OpenAI({ apiKey, baseURL });
}

let _openai: OpenAI | null = null;

export const openai: OpenAI = new Proxy({} as OpenAI, {
  get(_target, prop) {
    if (!_openai) {
      _openai = createOpenAIClient();
    }
    const value = (_openai as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(_openai) : value;
  },
});
