import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getActiveCampaignEntities, spawnNPCs, updateCharacter, startEncounter, setInitiatives, nextTurn, endEncounter, getCampaignById } from './db';
import { getRulesetById } from '../rules';
import { SYSTEM_PROMPTS } from '../prompts';
import { GoogleGenerativeAI } from '@google/generative-ai';
import equipmentData from '../rules/Rolemaster/data/equipment_data.json';

/**
 * The Orchestrator manages the flow between the Player's intent, the Database state,
 * the Rule Module, and the LLM Narrator.
 */
export async function processPlayerIntent(campaignId, user, intentText, apiKey, model, diceRoller, activeCharacter, rulesetId = 'rolemaster', campaignData = {}, history = []) {
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
  [DM DIRECTIVE]: ALWAYS use the "resolveAction" tool for any intentional action requiring a roll, bonus, or rule check (e.g. attacks, skill checks).
  [DM DIRECTIVE]: If the player is just asking for information, a description, or a status update (e.g. "How many enemies?", "What do I see?"), do NOT use any tools. Just answer the question narratively.
  [DM DIRECTIVE]: NEVER generate dice rolls, bonuses, or results math yourself in your narration. Wait for the tool output results.
  [DM DIRECTIVE]: If the player attacks, you MUST call "resolveAction" and then ONLY narrate based on the outcome provided by the tool.
  [DM DIRECTIVE]: If the player tries to equip, draw, or attack with a weapon NOT in their inventory, you MUST remind them they don't have it and ask them to use what they possess.
  [DM DIRECTIVE]: If the player tries to cast any spells or use magic, you MUST respond with: "Sorry, I am not equipped to resolve spells and magic just yet, soon though!"
  [DM DIRECTIVE]: You (the DM) MUST ONLY award items, wealth (gold, gems, jewelry), or equipment using the provided tools IF the player explicitly asks for them or describes finding them. Do NOT spontaneously give out rewards unless prompted by the user's intent.
  [DM DIRECTIVE]: If the player attacks without specifying a weapon, use their currently equipped weapon (listed above as [EQUIPPED WEAPON]). If they have NO weapon equipped, you MUST make it clear in your narration that they are attacking with their "bare hands".`;

  const scenarioText = campaignData?.scenarioText || '';
  const encounterState = campaignData?.encounterState || { isActive: false };

  let encounterRulesText = "";
  if (encounterState.isActive) {
    const { combatants = [], currentTurnId, round = 1 } = encounterState;
    const currentCombatant = combatants.find(c => c.id === currentTurnId) || {};

    encounterRulesText = `\n\n[ENCOUNTER MODE ACTIVE]: Round ${round}.
    The following combatants are in the encounter in this initiative order:
    ${combatants.map(c => `- ${c.name} (Initiative: ${c.initiative}, Type: ${c.type})`).join('\n')}
    
    [CURRENT TURN]: It is currently ${currentCombatant.name || 'Unknown'}'s turn.
    
    [DM DIRECTIVE FOR ENCOUNTER]: 
    - You must STRICTLY ENFORCE turn order. 
    - If a player (${character.name}) tries to take an action but it is NOT their turn, you MUST reject the action and tell them to wait for their turn.
    - Any players is allowed to ask questions, and you should answer, even out of turn, but they can only get information, not take actions.
    - If it IS the player's turn, resolve their action. The turn will automatically advance if you use the "resolveAction" tool. If the player does something purely narrative that requires no roll, you MUST call "next_turn" to advance the initiative state.
    - If it is an NPC's turn, you MUST take it immediately. Use the "resolveAction" tool (which auto-advances the turn) OR use the "next_turn" tool manually after narrating their action.
    - [STRICT RULE]: Never narrate that it is someone's turn unless the [CURRENT TURN] in the database (shown above) matches your narration. If you need to change the current turn, use the tools.
    - Chaining turns: If the turn advances and it becomes another NPC's turn, take their turn too! Chaining multiple actions in one response is encouraged to keep combat moving.
    - If the players defeat all attacking NPCs, make peace with the NPCs, or are defeated, use the "end_encounter" tool.
    `;
  } else {
    encounterRulesText = `\n\n
    [DM DIRECTIVE FOR ENCOUNTER START]: You should decide to enter Encounter Mode by using the "start_encounter" tool in two situations:
    1. A player attacks an NPC.
    2. You (the DM) decide an NPC will attack a character or the party.
    
    [CRITICAL]: If the NPCs involved in the fight are not already listed as campaign entities, you MUST call "spawn_npcs" to create them BEFORE or AT THE SAME TIME as calling "start_encounter". Gemini supports multiple tool calls in one turn—use them!
    
    When combat starts, all players present will be added to the encounter, and you should send a message describing the situation.`;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelInstance = genAI.getGenerativeModel({
    model: model,
    systemInstruction: SYSTEM_PROMPTS.AUTO_DM_BASE + (scenarioText ? `\n\nQuest Scenario: ${scenarioText}` : '') + rulesText + encounterRulesText,
    tools: [{
      functionDeclarations: [
        {
          name: "resolveAction",
          description: "Execute a rules-based, intentional physical or mental action for the player. Use this for actions like 'attack', 'hide', 'climb', or using a skill. Do NOT use this for purely informational questions (e.g. 'how many', 'what do I see'). Supported Weapons: " + availableWeapons.join(', '),
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
        },
        {
          name: "start_encounter",
          description: "Transitions the game to Encounter Mode when combat begins. Use this when a player attacks an NPC or an NPC attacks a player.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "set_initiative",
          description: "Sets the initiative scores for combatants in the encounter.",
          parameters: {
            type: "OBJECT",
            properties: {
              initiatives: {
                type: "ARRAY",
                description: "List of initiative scores to update.",
                items: {
                  type: "OBJECT",
                  properties: {
                    idOrName: { type: "STRING", description: "The name of the combatant." },
                    initiative: { type: "NUMBER", description: "The initiative score." }
                  },
                  required: ["idOrName", "initiative"]
                }
              }
            },
            required: ["initiatives"]
          }
        },
        {
          name: "next_turn",
          description: "Advances the encounter to the next combatant in the initiative order.",
          parameters: { type: "OBJECT", properties: {} }
        },
        {
          name: "end_encounter",
          description: "Ends the current encounter and returns to Adventure Mode.",
          parameters: { type: "OBJECT", properties: {} }
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
  const response = result.response;  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  let calls = response.functionCalls() || [];
  let finalNarrative = response.text() || "";

  // Recursive tool loop: keep executing tools as long as the AI provides them
  while (calls.length > 0) {
    console.log(`[Orchestrator] 🛑 Intercepted ${calls.length} Function Call(s)`);
    const toolResponses = [];
    
    for (const call of calls) {
      if (call.name === "resolveAction") {
        const actionArgs = call.args;
        let actorEntity = character; // Default to player

        // If the DM specified an actorId (for NPC turns)
        if (actionArgs.actorId) {
          const activeEntities = await getActiveCampaignEntities(campaignId);
          const foundActor = activeEntities.find(e => e.id === actionArgs.actorId);
          if (foundActor) {
            actorEntity = foundActor;
          }
        }

        let weaponToUse = actionArgs.weapon;
        if (!weaponToUse) {
          if (actorEntity.weapons && Array.isArray(actorEntity.weapons)) {
            const equipped = actorEntity.weapons.find(w => w.in_use);
            if (equipped) weaponToUse = equipped.name;
          } else if (actorEntity.equipment && Array.isArray(actorEntity.equipment.weapons)) {
            const equipped = actorEntity.equipment.weapons.find(w => w.equipped);
            if (equipped) weaponToUse = equipped.name;
          }
        }

        let targetEntity = {};
        if (actionArgs.target) {
          const activeEntities = await getActiveCampaignEntities(campaignId);
          const lowerTarget = actionArgs.target.toLowerCase();
          const matched = activeEntities.find(e => e.name && (e.name.toLowerCase().includes(lowerTarget) || lowerTarget.includes(e.name.toLowerCase())));
          if (matched) targetEntity = matched;
        }

        const ruleResult = await rules.resolveAction({
          action: actionArgs.actionType,
          target: actionArgs.target,
          weapon: weaponToUse
        }, actorEntity, targetEntity, wrappedDiceRoller);

        // Auto-advance turn if in encounter mode
        let nextTurnInfo = null;
        if (encounterState.isActive && !actionArgs.actionType.toLowerCase().includes('perception')) {
           console.log("[Orchestrator] ⚔️ Action resolved in encounter. Auto-advancing turn.");
           await nextTurn(campaignId);
           
           // Fetch updated state to tell the AI whose turn it is now
           const updatedCampaign = await getCampaignById(campaignId);
           const state = updatedCampaign?.encounterState;
           if (state) {
             const nextActor = state.combatants.find(c => c.id === state.currentTurnId);
             nextTurnInfo = { id: state.currentTurnId, name: nextActor?.name || "Unknown" };
           }
        }

        toolResponses.push({
          functionResponse: {
            name: "resolveAction",
            response: { 
              outcome: ruleResult,
              turnAdvancement: nextTurnInfo ? `Turn has advanced to ${nextTurnInfo.name} (${nextTurnInfo.id})` : "No turn change"
            }
          }
        });

        if (ruleResult && typeof ruleResult.roll !== 'undefined') {
          const bonus = ruleResult.bonus || 0;
          let detailText = "";
          const normalizedAction = (actionArgs.actionType || '').toLowerCase().trim();

          if (normalizedAction === 'attack') {
            detailText = `${actorEntity.name} attacked ${actionArgs.target || 'a foe'} with ${weaponToUse || 'their bare hands'} and rolled a ${ruleResult.roll} plus a bonus of ${bonus} for a total of ${ruleResult.totalScore}, which was a ${ruleResult.outcome.toLowerCase()}.`;
          } else {
            const actionLabel = actionArgs.actionType.charAt(0).toUpperCase() + actionArgs.actionType.slice(1);
            detailText = `${actorEntity.name} attempted a ${actionLabel} skill check and rolled a ${ruleResult.roll} plus a bonus of ${bonus} for a total of ${ruleResult.totalScore}, which was a ${ruleResult.outcome.toLowerCase()}.`;
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
      } else if (call.name === "spawn_npcs") {
        const { npcType, count = 1 } = call.args;
        const stats = rules.getNPCStats ? rules.getNPCStats(npcType) : {};

        if (stats) {
          const spawnedIds = await spawnNPCs(campaignId, npcType, count, stats);
          toolResponses.push({
            functionResponse: {
              name: "spawn_npcs",
              response: { success: true, message: `Successfully spawned ${count} ${npcType}(s).`, npcDetails: stats }
            }
          });
        }
      } else if (call.name === "roll_dice") {
        const notation = call.args.notation || "1d20";
        const totalResult = await wrappedDiceRoller(notation);
        finalNarrative += `\n🎲 Rolling ${notation}... Result: **${totalResult}**`;
        toolResponses.push({
          functionResponse: {
            name: "roll_dice",
            response: { success: true, total: totalResult }
          }
        });
      } else if (call.name === "award_wealth") {
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
        toolResponses.push({
          functionResponse: {
            name: "award_wealth",
            response: { success: true, awarded: { gold, gems, jewelry } }
          }
        });
      } else if (call.name === "award_item") {
        const { name, description, value } = call.args;
        if (character.id) {
          const currentItems = character.items || [];
          await updateCharacter(character.id, {
            items: [...currentItems, { name, description, value, acquiredAt: new Date().toISOString() }]
          });
        }
        toolResponses.push({
          functionResponse: {
            name: "award_item",
            response: { success: true, itemName: name }
          }
        });
      } else if (call.name === "award_equipment") {
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
          const newItem = { ...foundItem, special_bonus: specialBonus, in_use: false, acquiredAt: new Date().toISOString() };
          await updateCharacter(character.id, { [category]: [...currentList, newItem] });
          toolResponses.push({
            functionResponse: {
              name: "award_equipment",
              response: { success: true, itemAdded: foundItem.name, itemStats: foundItem }
            }
          });
        }
      } else if (call.name === "equip_item") {
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
                newList = newList.map((item, idx) => ({ ...item, in_use: idx === itemIdx }));
              }
            }
          }
          await updateCharacter(character.id, { [category]: newList });
          toolResponses.push({
            functionResponse: {
              name: "equip_item",
              response: { success: true, itemName: itemName, status: status ? "equipped" : "unequipped" }
            }
          });
        }
      } else if (call.name === "start_encounter") {
        await startEncounter(campaignId);
        toolResponses.push({
          functionResponse: {
            name: "start_encounter",
            response: { success: true, message: "Encounter mode started! All players and nearby NPCs have been added. Please use the 'set_initiative' tool to assign initiative to the combatants." }
          }
        });
      } else if (call.name === "set_initiative") {
        const { initiatives } = call.args;
        if (initiatives && Array.isArray(initiatives)) {
          await setInitiatives(campaignId, initiatives);
        }
        toolResponses.push({
          functionResponse: {
            name: "set_initiative",
            response: { success: true, message: "Initiatives updated successfully." }
          }
        });
      } else if (call.name === "next_turn") {
        await nextTurn(campaignId);
        toolResponses.push({
          functionResponse: {
            name: "next_turn",
            response: { success: true, message: "Advanced to next turn." }
          }
        });
      } else if (call.name === "end_encounter") {
        await endEncounter(campaignId);
        toolResponses.push({
          functionResponse: {
            name: "end_encounter",
            response: { success: true, message: "Encounter ended. Returned to Adventure Mode." }
          }
        });
      }
    }

    // After executing all calls, send the responses back to the AI
    if (toolResponses.length > 0) {
      // Small pause between multiple actions for realism/pacing
      await sleep(1500); 

      const nextResult = await chat.sendMessage(toolResponses);
      const nextResponse = nextResult.response;
      const nextText = nextResponse.text() || "";
      
      // If there's narrative for this turn, save it to the DB now so it appears sequentially
      if (nextText) {
        await addDoc(collection(db, 'campaigns', campaignId, 'messages'), {
          text: nextText,
          uid: 'system_ai',
          displayName: 'AutoDM Agent',
          photoURL: '',
          createdAt: serverTimestamp(),
          isAi: true,
          triggeredBy: user.uid,
          type: 'DungeonMaster'
        });
      }

      calls = nextResponse.functionCalls() || [];
    } else {
      calls = [];
    }
  }

  if (response.functionCalls()?.length === 0) {
    console.log("[Orchestrator] No rule tools called. Direct Conversational LLM Response.");
  }

  console.log("=========================================");

  // 5. Save the final narrative to Firestore with roll metadata
  if (finalNarrative && finalNarrative.trim()) {
    await addDoc(collection(db, 'campaigns', campaignId, 'messages'), {
      text: finalNarrative.trim(),
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
}
