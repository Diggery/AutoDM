import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getActiveCampaignEntities } from './db';
import { getRulesetById } from '../rules';
import { SYSTEM_PROMPTS } from '../prompts';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * The Orchestrator manages the flow between the Player's intent, the Database state,
 * the Rule Module, and the LLM Narrator.
 */
export async function processPlayerIntent(campaignId, user, intentText, apiKey, model, diceRoller, activeCharacter, rulesetId = 'rolemaster') {
  // Load the ruleset dynamically
  const rules = getRulesetById(rulesetId)?.system;
  if (!rules) throw new Error(`Ruleset ${rulesetId} not found`);

  const allWeapons = rules.getAvailableWeapons ? rules.getAvailableWeapons() : [];
  
  // Optimize LLM prompt: if the user explicitly mentions a weapon, only supply matching weapons
  const lowerIntent = intentText.toLowerCase();
  const matchedWeapons = allWeapons.filter(w => lowerIntent.includes(w.toLowerCase()));
  const availableWeapons = matchedWeapons.length > 0 ? matchedWeapons : allWeapons;
  
  // Use the active character provided by the UI, or fallback to a mock if none selected
  const character = activeCharacter || { name: player.displayName, weaponSkill: 50, quickness: 75 };

  // 2. Set up Gemini specifically as the Orchestrator
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelInstance = genAI.getGenerativeModel({
    model: model,
    systemInstruction: SYSTEM_PROMPTS.AUTO_DM_BASE,
    tools: [{
        functionDeclarations: [
          {
            name: "resolveAction",
            description: "Execute a rules-based action for the player, e.g. attacking or casting a spell. ALWAYS use this if the player is attempting an action that requires a dice roll or rules arbitration. Supported Weapons: " + availableWeapons.join(', '),
            parameters: {
              type: "OBJECT",
              properties: {
                actionType: { type: "STRING", description: "The type of action (e.g. 'attack', 'stealth', 'perception')" },
                target: { type: "STRING", description: "The target of the action, if any." },
                weapon: { type: "STRING", description: "The weapon used for the action (mapped from Supported Weapons), if applicable." }
              },
              required: ["actionType"]
            }
          },
          {
            name: "roll_dice",
            description: "Roll 3D dice using standard dice notation (e.g., '2d20', 'd6', '3d10+5') for simple, arbitrary dice rolls outside of rule actions.",
            parameters: {
              type: "OBJECT",
              properties: {
                notation: { type: "STRING", description: "The dice notation to roll. Examples: '2d20', '1d6', '4d10+2'." }
              },
              required: ["notation"]
            }
          }
        ]
    }]
  });

  const chat = modelInstance.startChat();
  
  console.log("=========================================");
  console.log("[Orchestrator] Player Intent:", intentText);
  console.log("[Orchestrator] Active Character:", character);

  // Ask Gemini to process the text. It might just reply (if conversational) or it might call resolveAction
  const result = await chat.sendMessage(intentText);
  const response = result.response;

  const call = response.functionCalls()?.[0];
  
  let finalNarrative = response.text();

  if (call && call.name === "resolveAction") {
    console.log("[Orchestrator] 🛑 Intercepted Function Call:", call.name, call.args);

    // 3. The Orchestrator intercepts the tool call and runs the determinist Rule Module
    const actionArgs = call.args;

    // Evaluate default equipped weapon if none explicitly named by AI
    let weaponToUse = actionArgs.weapon;
    if (!weaponToUse && character.equipment && Array.isArray(character.equipment.weapons)) {
       const equipped = character.equipment.weapons.find(w => w.equipped);
       if (equipped) weaponToUse = equipped.name;
    }

    // Lookup target entity from DB for rules module context
    let targetEntity = {};
    if (actionArgs.target) {
       const activeEntities = await getActiveCampaignEntities(campaignId);
       const lowerTarget = actionArgs.target.toLowerCase();
       const matched = activeEntities.find(e => e.name && (e.name.toLowerCase().includes(lowerTarget) || lowerTarget.includes(e.name.toLowerCase())));
       if (matched) targetEntity = matched;
    }

    // We pass intent to the Rule System
    const ruleResult = await rules.resolveAction({ 
      action: actionArgs.actionType, 
      target: actionArgs.target,
      weapon: weaponToUse
    }, character, targetEntity, diceRoller);
    
    console.log("[Orchestrator] 🎲 Rule Module Result:", ruleResult);

    // 4. Send the result back to the Narrator to generate the final prose
    const narrationResult = await chat.sendMessage([{
      functionResponse: {
        name: "resolveAction",
        response: {
           outcome: ruleResult
        }
      }
    }]);
    
    finalNarrative = narrationResult.response.text();
    console.log("[Orchestrator] 📖 Narrator Prose Generated");
    
    // In a full app, we would apply effects to the DB here:
    // if(ruleResult.damageApplied > 0) updateMonsterHealth(...)
  } else if (call && call.name === "roll_dice") {
    console.log("[Orchestrator] 🛑 Intercepted Function Call:", call.name, call.args);
    const notation = call.args.notation || "1d20";
    const totalResult = await diceRoller(notation);
    finalNarrative = `🎲 Rolling ${notation}... Result: **${totalResult}**`;
    console.log("[Orchestrator] 🎲 Raw Dice Output Created:", totalResult);
  } else {
    console.log("[Orchestrator] No rule tools called. Direct Conversational LLM Response.");
  }

  console.log("=========================================");

  // 5. Save the final narrative to Firestore
  await addDoc(collection(db, 'campaigns', campaignId, 'messages'), {
    text: finalNarrative,
    uid: 'system_ai',
    displayName: 'AutoDM Agent',
    photoURL: '',
    createdAt: serverTimestamp(),
    isAi: true
  });
}
