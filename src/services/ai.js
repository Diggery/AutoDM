import { GoogleGenAI } from '@google/genai';

export const AVAILABLE_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini Flash' },
  { id: 'gemini-1.5-pro', label: 'Gemini Pro' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' }
];

export async function getAiResponse(apiKey, prompt, model = AVAILABLE_MODELS[0].id) {
  if (!apiKey) {
    throw new Error('API Key is missing. Please configure it in Settings.');
  }

  try {
    const ai = new GoogleGenAI({ apiKey: apiKey });

    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
    });

    return response.text;
  } catch (error) {
    console.error('AI Service Error:', error);
    throw new Error(error.message || 'Failed to fetch AI response');
  }
}
