import dotenv from 'dotenv';
import { vi, test } from 'vitest';

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
const campaignId = 'test-systems-scenario';
const user = { displayName: 'TestPlayer' };
const model = 'gemini-2.5-flash';

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

// Test character with lockpicking bonus
const activeCharacter = {
  name: "Barnaby the Bold",
  weaponSkill: 50,
  quickness: 75,
  skills: {
    lockpicking: { bonus: 20 },
    stealth: { bonus: 15 }
  },
  equipment: {
    weapons: [{ name: "Broadsword", equipped: true }]
  }
};

const scenario = [
  "Hello! I'm standing in front of a heavy wooden door. It seems to be locked.",
  "I try to pick the lock on the door with my tools.",
  "I slowly push the door open and peer into the room.",
  "I draw my sword and attack the Goblin!"
];

async function runScenario() {
  console.log("🚀 Starting Systems Test Scenario...");
  console.log("Using API Key:", apiKey ? (apiKey.substring(0, 8) + "...") : "MISSING");
  
  if (!apiKey) {
    console.error("❌ ERROR: VITE_GEMINI_API_KEY is missing in .env");
    return;
  }

  for (const intent of scenario) {
    console.log(`\n\n--- PLAYER: "${intent}" ---`);
    try {
      await processPlayerIntent(
        campaignId,
        user,
        intent,
        apiKey,
        model,
        diceRoller,
        activeCharacter,
        'rolemaster'
      );
    } catch (error) {
      console.error("❌ Error during intent processing:", error);
    }
  }
  
  console.log("\n\n✅ Scenario Complete. Check Firestore (test-systems-scenario) for results.");
}

test('Systems Scenario: Locked Door and Goblin', async () => {
  await runScenario();
}, 120000); // 2 minute timeout for LLM calls
