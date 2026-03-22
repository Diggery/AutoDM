import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getActiveCampaignEntities, spawnNPCs, updateCharacter } from './db';
import { getRulesetById } from '../rules';
import { SYSTEM_PROMPTS } from '../prompts';
import { GoogleGenerativeAI } from '@google/generative-ai';
import equipmentData from '../rules/Rolemaster/data/equipment_data.json';

/**
 * The Orchestrator manages the flow between the Player's intent, the Database state,
 * the Rule Module, and the LLM Narrator.
 */
export async function processPlayerIntent(campaignId, user, intentText, apiKey, model, diceRoller, activeCharacter, rulesetId = 'rolemaster', scenarioText = '', history = []) {
  // Load the ruleset dynamically
  const rules = getRulesetById(rulesetId)?.system;
  if (!rules) throw new Error(`Ruleset ${rulesetId} not found`);

  const allWeapons = rules.getAvailableWeapons ? rules.getAvailableWeapons() : [];
  const allNPCs = rules.getAvailableNPCs ? rules.getAvailableNPCs() : [];

  // Optimize LLM prompt: if the user explicitly mentions a weapon, only supply matching weapons
  const lowerIntent = intentText.toLowerCase();
  const matchedWeapons = allWeapons.filter(w => lowerIntent.includes(w.toLowerCase()));
  const availableWeapons = matchedWeapons.length > 0 ? matchedWeapons : allWeapons;

  // Use the active character provided by the UI, or fallback to a mock if none selected
  const character = activeCharacter || { name: user.displayName, weaponSkill: 50, quickness: 75 };

  // 2. Set up Gemini specifically as the Orchestrator with a wrapper to collect rolls
  const rolls = [];
  let rollId = null;

  const wrappedDiceRoller = async (notation) => {
    const diceData = await diceRoller(notation);
    // Support both simple number (fallback) and detailed result object
    const total = typeof diceData === 'object' ? diceData.total : diceData;
    const results = typeof diceData === 'object' ? diceData.results : [diceData];
    
    // Use 1d100+1d10 notation for percentile rolls to force a d100 and d10 in the 3D engine
    const displayNotation = (notation === '1d100' || notation === 'd%') ? '1d100+1d10' : notation;

    // Generate a unique ID for this specific roll event if not already set
    if (!rollId) rollId = `roll_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    
    rolls.push({ notation: displayNotation, total, results });
    return total;
  };

  // Extract weapons and skills from character for validation and mapping
  const weaponsList = (character.weapons || []).map(w => w.name).join(', ') || 'None';
  const equippedWeapon = (character.weapons || []).find(w => w.in_use)?.name || 'None';
  const skillsList = character.skills ? Object.keys(character.skills).join(', ') : 'None';
  
  const rulesText = `\n\n[PLAYER INVENTORY]: ${weaponsList}\n
  [EQUIPPED WEAPON]: ${equippedWeapon}\n
  [PLAYER SKILLS]: ${skillsList}\n
  [DM DIRECTIVE]: ALWAYS use the "resolveAction" tool for any action requiring a roll, bonus, or rule check (e.g. attacks, skill checks).
  [DM DIRECTIVE]: NEVER generate dice rolls, bonuses, or results math yourself in your narration. Wait for the tool output results.
  [DM DIRECTIVE]: If the player attacks, you MUST call "resolveAction" and then ONLY narrate based on the outcome provided by the tool.
  [DM DIRECTIVE]: If the player tries to equip, draw, or attack with a weapon NOT in their inventory, you MUST remind them they don't have it and ask them to use what they possess.
  [DM DIRECTIVE]: If the player tries to cast any spells or use magic, you MUST respond with: "Sorry, I am not equipped to resolve spells and magic just yet, soon though!"
  [DM DIRECTIVE]: You (the DM) MUST ONLY award items, wealth (gold, gems, jewelry), or equipment using the provided tools IF the player explicitly asks for them or describes finding them. Do NOT spontaneously give out rewards unless prompted by the user's intent.
  [DM DIRECTIVE]: If the player attacks without specifying a weapon, use their currently equipped weapon (listed above as [EQUIPPED WEAPON]). If they have NO weapon equipped, you MUST make it clear in your narration that they are attacking with their "bare hands".`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelInstance = genAI.getGenerativeModel({
    model: model,
    systemInstruction: SYSTEM_PROMPTS.AUTO_DM_BASE + (scenarioText ? `\n\nQuest Scenario: ${scenarioText}` : '') + rulesText,
    tools: [{
      functionDeclarations: [
        {
          name: "resolveAction",
          description: "Execute a rules-based action for the player. ALWAYS use this for any action requiring a roll or bonus. Map the user's intent to one of the [PLAYER SKILLS] if applicable. Supported Weapons: " + availableWeapons.join(', '),
          parameters: {
            type: "OBJECT",
            properties: {
              actionType: { type: "STRING", description: "The type of action or skill name (e.g. 'Stalking/Hiding', 'Perception', 'Athletics'). Use the exact name from [PLAYER SKILLS] if it fits the intent." },
              target: { type: "STRING", description: "The target of the action, if any." },
              weapon: { type: "STRING", description: "The weapon used for an attack (mapped from Supported Weapons or [PLAYER INVENTORY])." }
            },
            required: ["actionType"]
          }
        },
        {
          name: "spawn_npcs",
          description: "Create new NPC entities (monsters/enemies) in the campaign. Use this when the DM introduces new foes or NPCs. Available NPCs: " + allNPCs.join(', '),
          parameters: {
            type: "OBJECT",
            properties: {
              npcType: { type: "STRING", description: "The type of NPC to spawn (e.g. 'Orc', 'Goblin')." },
              count: { type: "NUMBER", description: "The number of NPCs to spawn. Default is 1." }
            },
            required: ["npcType"]
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
        },
        {
          name: "award_wealth",
          description: "Award gold, gems, or jewelry to the active character's wealth. Use this when the character finds treasury, loot or receives payment.",
          parameters: {
            type: "OBJECT",
            properties: {
              gold: { type: "NUMBER", description: "Amount of gold to add." },
              gems: { type: "NUMBER", description: "Amount of gems to add." },
              jewelry: { type: "NUMBER", description: "Amount of jewelry to add." }
            }
          }
        },
        {
          name: "award_item",
          description: "Award a general item (non-combat equipment) to the character's items list. Use this for quest items, tools, or miscellaneous loot.",
          parameters: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING", description: "The name of the item." },
              description: { type: "STRING", description: "A brief description of the item." },
              value: { type: "NUMBER", description: "The value of the item in gold." }
            },
            required: ["name"]
          }
        },
        {
          name: "award_equipment",
          description: "Award a piece of combat equipment (weapon, armor, or shield) to the character. This should match items found in the rulebook/equipment library.",
          parameters: {
            type: "OBJECT",
            properties: {
              category: { type: "STRING", enum: ["weapons", "armour"], description: "The category of equipment." },
              itemName: { type: "STRING", description: "The exact name of the weapon, armor, or shield from the equipment library." },
              specialBonus: { type: "NUMBER", description: "Any magical or quality bonus (e.g. 5 for a +5 weapon)." }
            },
            required: ["category", "itemName"]
          }
        },
        {
          name: "equip_item",
          description: "Toggle the 'in_use' (active) status of a piece of equipment already in the character's inventory. Use this when the player asks to draw, wield, wear, or equip an item they possess.",
          parameters: {
            type: "OBJECT",
            properties: {
              category: { type: "STRING", enum: ["weapons", "armour"], description: "The category of the item." },
              itemName: { type: "STRING", description: "The exact name of the item from their [PLAYER INVENTORY] to equip or unequip." },
              status: { type: "BOOLEAN", description: "Set to true to equip/wield, false to unequip/stow." }
            },
            required: ["category", "itemName", "status"]
          }
        }
      ]
    }]
  });

  const chat = modelInstance.startChat({ history });

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
    if (!weaponToUse) {
      if (character.weapons && Array.isArray(character.weapons)) {
        const equipped = character.weapons.find(w => w.in_use);
        if (equipped) weaponToUse = equipped.name;
      } else if (character.equipment && Array.isArray(character.equipment.weapons)) {
        const equipped = character.equipment.weapons.find(w => w.equipped);
        if (equipped) weaponToUse = equipped.name;
      }
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
    }, character, targetEntity, wrappedDiceRoller);

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

    // Post Action Details message as requested
    if (ruleResult && typeof ruleResult.roll !== 'undefined') {
      const bonus = ruleResult.bonus || 0;
      let detailText = "";
      const normalizedAction = (actionArgs.actionType || '').toLowerCase().trim();

      if (normalizedAction === 'attack') {
        detailText = `${character.name} attacked with ${weaponToUse || 'their bare hands'} and rolled a ${ruleResult.roll} plus an OB of ${bonus} for a total of ${ruleResult.totalScore}, which was a ${ruleResult.outcome.toLowerCase()}.`;
      } else {
        const actionLabel = actionArgs.actionType.charAt(0).toUpperCase() + actionArgs.actionType.slice(1);
        detailText = `${character.name} attempted a ${actionLabel} skill check and rolled a ${ruleResult.roll} plus a bonus of ${bonus} for a total of ${ruleResult.totalScore}, which was a ${ruleResult.outcome.toLowerCase()}.`;
      }

      await addDoc(collection(db, 'campaigns', campaignId, 'messages'), {
        text: detailText,
        uid: 'system_ai',
        displayName: 'Action Details',
        photoURL: '',
        createdAt: serverTimestamp(),
        isAi: true,
        type: 'Details',
        rollId: rollId,
        diceRolls: rolls
      });
    }
  } else if (call && call.name === "spawn_npcs") {
    console.log("[Orchestrator] 🛑 Intercepted Function Call:", call.name, call.args);
    const { npcType, count = 1 } = call.args;

    // Get base stats from rules
    const stats = rules.getNPCStats ? rules.getNPCStats(npcType) : {};

    if (stats) {
      const spawnedIds = await spawnNPCs(campaignId, npcType, count, stats);
      console.log(`[Orchestrator] 🐉 Spawned ${count} ${npcType}(s):`, spawnedIds);

      const narrationResult = await chat.sendMessage([{
        functionResponse: {
          name: "spawn_npcs",
          response: {
            success: true,
            message: `Successfully spawned ${count} ${npcType}(s).`,
            npcDetails: stats
          }
        }
      }]);

      finalNarrative = narrationResult.response.text();
    } else {
      finalNarrative = `I tried to summon ${npcType}, but I couldn't find its stats in the records!`;
    }
  } else if (call && call.name === "roll_dice") {
    console.log("[Orchestrator] 🛑 Intercepted Function Call:", call.name, call.args);
    const notation = call.args.notation || "1d20";
    const totalResult = await wrappedDiceRoller(notation);
    finalNarrative = `🎲 Rolling ${notation}... Result: **${totalResult}**`;
    console.log("[Orchestrator] 🎲 Raw Dice Output Created:", totalResult);
  } else if (call && call.name === "award_wealth") {
    console.log("[Orchestrator] 🛑 Intercepted Function Call:", call.name, call.args);
    const { gold = 0, gems = 0, jewelry = 0 } = call.args;
    
    if (character.id) {
      const currentWealth = character.wealth || { gold: 0, gems: 0, jewelry: 0 };
      await updateCharacter(character.id, {
        wealth: {
          gold: (currentWealth.gold || 0) + gold,
          gems: (currentWealth.gems || 0) + gems,
          jewelry: (currentWealth.jewelry || 0) + jewelry
        }
      });
    }

    const narrationResult = await chat.sendMessage([{
      functionResponse: {
        name: "award_wealth",
        response: { success: true, awarded: { gold, gems, jewelry } }
      }
    }]);
    finalNarrative = narrationResult.response.text();
  } else if (call && call.name === "award_item") {
    console.log("[Orchestrator] 🛑 Intercepted Function Call:", call.name, call.args);
    const { name, description, value } = call.args;

    if (character.id) {
      const currentItems = character.items || [];
      await updateCharacter(character.id, {
        items: [...currentItems, { name, description, value, acquiredAt: new Date().toISOString() }]
      });
    }

    const narrationResult = await chat.sendMessage([{
      functionResponse: {
        name: "award_item",
        response: { success: true, itemName: name }
      }
    }]);
    finalNarrative = narrationResult.response.text();
  } else if (call && call.name === "award_equipment") {
    console.log("[Orchestrator] 🛑 Intercepted Function Call:", call.name, call.args);
    const { category, itemName, specialBonus = 0 } = call.args;

    const items = equipmentData.equipment_list?.[category];
    let foundItem = null;
    if (items) {
      for (const subCat of Object.values(items)) {
        foundItem = subCat.find(i => i.name.toLowerCase() === itemName.toLowerCase());
        if (foundItem) break;
      }
    }

    if (foundItem && character.id) {
      const currentList = character[category] || [];
      const newItem = { 
        ...foundItem, 
        special_bonus: specialBonus, 
        in_use: false, 
        acquiredAt: new Date().toISOString() 
      };
      await updateCharacter(character.id, {
        [category]: [...currentList, newItem]
      });

      const narrationResult = await chat.sendMessage([{
        functionResponse: {
          name: "award_equipment",
          response: {
            success: true,
            itemAdded: foundItem.name,
            itemStats: foundItem
          }
        }
      }]);
      finalNarrative = narrationResult.response.text();
    } else {
      const narrationResult = await chat.sendMessage([{
        functionResponse: {
          name: "award_equipment",
          response: {
            success: false,
            error: `Item "${itemName}" not found in ${category} library.`
          }
        }
      }]);
      finalNarrative = narrationResult.response.text();
    }
  } else if (call && call.name === "equip_item") {
    console.log("[Orchestrator] 🛑 Intercepted Function Call:", call.name, call.args);
    const { category, itemName, status } = call.args;

    if (character.id) {
      const currentList = character[category] || [];
      let newList = [...currentList];
      const itemIdx = newList.findIndex(item => item.name.toLowerCase() === itemName.toLowerCase());
      
      if (itemIdx !== -1) {
        const togglingOn = (status === true || status === 'true');
        newList[itemIdx] = { ...newList[itemIdx], in_use: togglingOn };

        if (togglingOn) {
          if (category === 'weapons') {
            // One weapon only
            newList = newList.map((item, idx) => ({
              ...item,
              in_use: idx === itemIdx
            }));
          } else if (category === 'armour') {
            const isShield = !!newList[itemIdx].bonus_versus_melee;
            newList = newList.map((item, idx) => {
              if (idx === itemIdx) return item;
              const checkingShield = !!item.bonus_versus_melee;
              if (isShield === checkingShield) {
                return { ...item, in_use: false };
              }
              return item;
            });
          }
        }
      }

      await updateCharacter(character.id, { [category]: newList });

      const narrationResult = await chat.sendMessage([{
        functionResponse: {
          name: "equip_item",
          response: {
            success: true,
            itemName: itemName,
            status: status ? "equipped" : "unequipped"
          }
        }
      }]);
      finalNarrative = narrationResult.response.text();
    }
  } else {
    console.log("[Orchestrator] No rule tools called. Direct Conversational LLM Response.");
  }

  console.log("=========================================");

  // 5. Save the final narrative to Firestore with roll metadata
  await addDoc(collection(db, 'campaigns', campaignId, 'messages'), {
    text: finalNarrative,
    uid: 'system_ai',
    displayName: 'AutoDM Agent',
    photoURL: '',
    createdAt: serverTimestamp(),
    isAi: true,
    triggeredBy: user.uid,
    type: 'DungeonMaster',
    rollId: rollId,
    diceRolls: rolls // Synchronize 3D dice across all clients
  });
}
