import { GoogleGenAI } from "@google/genai";

const _p = "AI_INTEGRATIONS";
const _n = "GEMINI";

let _ai: GoogleGenAI | null = null;
let _configSnapshot = "";

function getConfigSnapshot(): string {
  return `${process.env[`${_p}_${_n}_BASE_URL`] ?? ""}|${process.env[`${_p}_${_n}_API_KEY`] ?? ""}`;
}

function createClient(): GoogleGenAI {
  const baseUrl = process.env[`${_p}_${_n}_BASE_URL`];
  const apiKey = process.env[`${_p}_${_n}_API_KEY`];
  if (!baseUrl || !apiKey) {
    throw new Error(
      "Gemini AI integration is not configured. Please set the API Key and Base URL in the settings panel.",
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "", baseUrl },
  });
}

export const ai: GoogleGenAI = new Proxy({} as GoogleGenAI, {
  get(_target, prop) {
    const snapshot = getConfigSnapshot();
    if (!_ai || _configSnapshot !== snapshot) {
      _ai = createClient();
      _configSnapshot = snapshot;
    }
    const value = (_ai as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(_ai) : value;
  },
});
