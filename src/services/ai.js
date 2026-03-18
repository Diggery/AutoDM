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
    const ai = new GoogleGenAI(apiKey);
    const modelInstance = ai.getGenerativeModel({ 
      model: model,
      systemInstruction: "You are AutoDM, a helpful AI Dungeon Master. You can roll dice for the players when they ask. Use the roll_dice tool to trigger a 3D dice animation. After the roll, the system will provide the results, and you should describe the outcome to the player.",
      tools: [
        {
          functionDeclarations: [
            {
              name: "roll_dice",
              description: "Roll 3D dice using standard dice notation (e.g., '2d20', 'd6', '3d10+5').",
              parameters: {
                type: "object",
                properties: {
                  notation: {
                    type: "string",
                    description: "The dice notation to roll. Examples: '2d20', '1d6', '4d10+2'."
                  }
                },
                required: ["notation"]
              }
            }
          ]
        }
      ]
    });

    const chat = modelInstance.startChat();
    const result = await chat.sendMessage(prompt);
    const response = result.response;
    
    // Check for tool calls
    const call = response.functionCalls()?.[0];
    if (call) {
      return {
        type: 'tool_call',
        name: call.name,
        args: call.args
      };
    }

    return {
      type: 'text',
      text: response.text()
    };
  } catch (error) {
    console.error('AI Service Error:', error);
    throw new Error(error.message || 'Failed to fetch AI response');
  }
}

