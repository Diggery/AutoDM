import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
  const apiKey = process.argv[2] || process.env.VITE_FIREBASE_API_KEY;
  console.log('Testing with API Key:', apiKey ? (apiKey.substring(0, 8) + '...') : 'MISSING');

  if (!apiKey) {
    console.error('Error: VITE_FIREBASE_API_KEY is not set in your .env file.');
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    console.log('Listing available models via direct fetch...');
    const listResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const listData = await listResponse.json();
    
    if (listData.error) {
      console.error('API Error during listModels:', listData.error);
      return;
    }

    const modelNames = listData.models.map(m => m.name);
    console.log('Available Models:', modelNames);

    // Try to find a working model
    const candidateModels = [
      "models/gemini-1.5-flash",
      "models/gemini-1.5-flash-latest",
      "models/gemini-pro",
      "models/gemini-1.5-pro"
    ];

    const modelId = candidateModels.find(m => modelNames.includes(m)) || modelNames[0];

    if (!modelId) {
      console.error('No models found for this API key.');
      return;
    }

    const model = genAI.getGenerativeModel({ model: modelId });

    console.log(`Sending request to ${modelId}...`);
    const result = await model.generateContent("Say 'Hello, API is working!'");
    const response = await result.response;
    console.log('--- RESPONSE ---');
    console.log(response.text());
    console.log('--- SUCCESS ---');
  } catch (error) {
    console.error('--- ERROR ---');
    console.error(error);
  }
}

test();
