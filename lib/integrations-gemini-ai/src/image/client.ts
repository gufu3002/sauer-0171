import { GoogleGenAI, Modality } from "@google/genai";

const _p = "AI_INTEGRATIONS";
const _n = "GEMINI";

function getEnv(suffix: string): string {
  const key = `${_p}_${_n}_${suffix}`;
  const val = process.env[key];
  if (!val) {
    throw new Error(
      `${key} must be set. Did you forget to provision the Gemini AI integration?`,
    );
  }
  return val;
}

export const ai = new GoogleGenAI({
  apiKey: getEnv("API_KEY"),
  httpOptions: {
    apiVersion: "",
    baseUrl: getEnv("BASE_URL"),
  },
});

export async function generateImage(
  prompt: string
): Promise<{ b64_json: string; mimeType: string }> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
    },
  });

  const candidate = response.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find(
    (part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData
  );

  if (!imagePart?.inlineData?.data) {
    throw new Error("No image data in response");
  }

  return {
    b64_json: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || "image/png",
  };
}
