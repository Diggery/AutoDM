import dotenv from 'dotenv';
import { vi, test } from 'vitest';
import { ADVENTURES } from '../adventures/index.js';

// Load environment variables from .env
dotenv.config();

// Mock firestore BEFORE importing services
vi.mock('firebase/firestore', () => ({
  collection: (db, ...path) => ({ path }),
  addDoc: async (col, data) => { 
    console.log(`[Firestore Mock] ADD to ${col.path.join('/')}:`, JSON.stringify(data, null, 2));
    return { id: 'mock-doc-id' };
  },
  updateDoc: async (docRef, data) => {
    console.log(`[Firestore Mock] UPDATE ${docRef.path.join('/')}:`, JSON.stringify(data, null, 2));
  },
  getDoc: async (docRef) => ({ 
    exists: () => true, 
    data: () => ({ activeEntities: [] }) 
  }),
  doc: (db, ...path) => ({ path }),
  serverTimestamp: () => new Date().toISOString(),
  arrayUnion: (...args) => args,
  query: () => ({}),
  where: () => ({}),
  getDocs: async () => ({ empty: true, docs: [] }),
  getFirestore: () => ({})
}));

import { processPlayerIntent } from '../services/orchestrator.js';

const apiKey = process.env.VITE_GEMINI_API_KEY;
const campaignId = 'test-scenario-goblin-quest';
const user = { displayName: 'TestPlayer' };
const model = 'gemini-2.5-flash';
const adventure = ADVENTURES.find(a => a.id === 'goblin_quest');

// Simple dice roller for the test
const diceRoller = async (notation) => {
  const [count, sides] = notation.split('d').map(n => parseInt(n) || 1);
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }
  console.log(`[DiceBox] Rolled ${notation}: ${total}`);
  return total;
};

// Test character
const activeCharacter = {
  name: "Barnaby",
  weaponSkill: 50,
  skills: { lockpicking: { bonus: 20 } },
  equipment: { weapons: [{ name: "Broadsword", equipped: true }] }
};

const scenario = [
  "Hello! What do I see?",
  "I try to pick the lock on the door.",
  "I enter and attack the Goblin!"
];

async function runScenario() {
  console.log(`🚀 Starting Scenario Test: ${adventure.name}...`);
  
  if (!apiKey) {
    console.error("❌ ERROR: VITE_GEMINI_API_KEY is missing");
    return;
  }

  for (const intent of scenario) {
    console.log(`\n\n--- PLAYER: "${intent}" ---`);
    await processPlayerIntent(
      campaignId,
      user,
      intent,
      apiKey,
      model,
      diceRoller,
      activeCharacter,
      'rolemaster',
      adventure.scenarioText
    );
  }
}

test('Adventure Scenario: Goblin Quest', async () => {
  await runScenario();
}, 120000);
