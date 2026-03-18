import { GoogleGenerativeAI } from '@google/generative-ai';

export const AVAILABLE_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-flash-latest', label: 'Gemini Flash Latest' },
];

export async function getAiResponse(apiKey, prompt, model = AVAILABLE_MODELS[0].id) {
  if (!apiKey || apiKey === 'undefined') {
    throw new Error('Gemini API Key is invalid or not found. Please check your settings.');
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    // Some keys require 'models/' prefix, some don't. The SDK usually handles it, 
    // but we'll ensure we use the base ID.
    const modelId = model.includes('/') ? model.split('/').pop() : model;

    const modelInstance = genAI.getGenerativeModel({
      model: modelId,
      systemInstruction: "You are AutoDM, a helpful AI Dungeon Master. You can roll dice for the players when they ask. Use the roll_dice tool to trigger a 3D dice animation. After the roll, the system will provide the results, and you should describe the outcome to the player.",
      tools: [
        {
          functionDeclarations: [
            {
              name: "roll_dice",
              description: "Roll 3D dice using standard dice notation (e.g., '2d20', 'd6', '3d10+5').",
              parameters: {
                type: "OBJECT",
                properties: {
                  notation: {
                    type: "STRING",
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

    // Handle tool calls
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

