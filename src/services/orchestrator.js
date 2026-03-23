import { db } from '../firebase';
import { collection, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';

import { getActiveCampaignEntities, spawnNPCs, updateCharacter, startEncounter, setInitiatives, nextTurn, endEncounter, getCampaignById } from './db';
import { getRulesetById } from '../rules';
import { SYSTEM_PROMPTS } from '../prompts';
import { GoogleGenerativeAI } from '@google/generative-ai';
import equipmentData from '../rules/Rolemaster/data/equipment_data.json';

/**
 * Tool names used by the AI Agent.
 */
const TOOL_NAMES = {
  RESOLVE_ACTION: "resolveAction",
  SPAWN_NPCS: "spawn_npcs",
  ROLL_DICE: "roll_dice",
  AWARD_WEALTH: "award_wealth",
  AWARD_ITEM: "award_item",
  AWARD_EQUIPMENT: "award_equipment",
  EQUIP_ITEM: "equip_item",
  START_ENCOUNTER: "start_encounter",
  SET_INITIATIVE: "set_initiative",
  NEXT_TURN: "next_turn",
  END_ENCOUNTER: "end_encounter"
};

/**
 * The Orchestrator manages the flow between the Player's intent, the Database state,
 * the Rule Module, and the LLM Narrator.
 */
export async function processPlayerIntent(campaignId, user, intentText, apiKey, model, diceRoller, activeCharacter, rulesetId = 'rolemaster', campaignData = {}, history = [], isSystemSignal = false) {
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
  let shouldAdvanceTurn = false;
  let hasAdvancedTurn = false;


  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const wrappedDiceRoller = async (notation) => {
      // Generate a unique ID for this specific roll event if not already set
      if (!rollId) rollId = `roll_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

      // 🎲 This trigger will now IMPERATIVELY await the 3D animation in Chat.jsx before returning
      // Pass the rollId so the UI can track this as an 'already rolled' event
      const diceData = await diceRoller(notation, null, rollId); 

      let total = 10;
      let results = [10];

      // Support both simple number (fallback) and detailed result object
      // Gracefully handle UI physics timeouts returning null
      if (diceData && typeof diceData === 'object') {
        total = diceData.total || 10;
        results = diceData.results || [10];
      } else if (typeof diceData === 'number') {
        total = diceData;
        results = [diceData];
      } else {
        console.warn("[Orchestrator] ⚠️ 3D dice engine timeout. Falling back to generic result.");
      }

      // Use 1d100+1d10 notation for percentile rolls to force a d100 and d10 in the 3D engine
      const displayNotation = (notation === '1d100' || notation === 'd%') ? '1d100+1d10' : notation;

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
  let encounterState = campaignData?.encounterState || { isActive: false };

  // Always fetch fresh campaign data to avoid stale prop issues on page load/rapid actions
  if (campaignId) {
    try {
      const freshCampaign = await getCampaignById(campaignId);
      if (freshCampaign) {
        console.log("[Orchestrator] 💡 Fresh state fetched safely.");
        encounterState = freshCampaign.encounterState || { isActive: false };
        // IMPORTANT: Update local campaignData reference for any other logic that uses it
        campaignData.encounterState = encounterState;
      }
    } catch (e) {
      console.warn("[Orchestrator] Failed to fetch fresh campaign data, using props.", e);
    }
  }

  if (intentText.toLowerCase().includes("@dm")) {
    console.log(`[Orchestrator] 🧊 Initial State check: isActive=${encounterState.isActive}, currentTurnId=${encounterState.currentTurnId}`);
  }





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
    - Any player is allowed to ask questions, and you should answer, even out of turn, but they can only get information, not take actions.
    - If it IS the player's turn, resolve their action. The turn will automatically advance if you use the "resolveAction" tool.
    - If it is an NPC's turn, you MUST act as that NPC. 
    - [CRITICAL]: When acting as an NPC, you MUST use the "resolveAction" tool with the correct 'actorId' (e.g. "${currentCombatant.id}") so the system knows it is the NPC attacking, not the player.
    - [STRICT RULE]: Never narrate that it is someone's turn unless the [CURRENT TURN] in the database (shown above) matches your narration. If you need to change the current turn, use the tools.
    - ONE ACTION PER TURN: Once you have resolved an NPC's action, your turn is DONE. Do NOT chain multiple NPC turns together. Wait for the next Turn Signal from the system.
    - If the players defeat all attacking NPCs, make peace with the NPCs, or are defeated, use the "end_encounter" tool.
    `;
  } else {
    encounterRulesText = `\n\n
    [DM DIRECTIVE FOR ENCOUNTER START]: You should decide to enter Encounter Mode by using the "start_encounter" tool in two situations:
    1. A player attacks an NPC.
    2. You (the DM) decide an NPC will attack a character or the party.
    
    [CRITICAL]: When calling "start_encounter", you MUST pass the "initiatorId" (e.g. "${character.id}" if the player started it) to give them the first turn in the initiative order.
    
    [CRITICAL]: If the NPCs involved in the fight are not already listed as campaign entities, you MUST call "spawn_npcs" to create them BEFORE or AT THE SAME TIME as calling "start_encounter". 
    
    When combat starts, all players present will be added to the encounter, and you should send a message describing the situation and how initiative is being handled. Note: Initiative is rolled automatically by the system when you start the encounter.`;
  }

  encounterRulesText += '\n [CRITICAL]: If the player\'s intent is ever ambiguous or unclear, you should ask for clarification before taking any actions or calling any tools.';

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelInstance = genAI.getGenerativeModel({
    model: model,
    systemInstruction: SYSTEM_PROMPTS.AUTO_DM_BASE + (scenarioText ? `\n\nQuest Scenario: ${scenarioText}` : '') + rulesText + encounterRulesText,
    tools: [{
      functionDeclarations: [
        {
          name: "resolveAction",
          description: "Execute a rules-based, intentional physical or mental action. Use this for actions like 'attack', 'hide', 'climb', or using a skill. For NPC actions, you MUST provide the 'actorId' from the encounter combatants. Do NOT use this for purely informational questions. Supported Weapons: " + availableWeapons.join(', '),
          parameters: {
            type: "OBJECT",
            properties: {
              actionType: { type: "STRING", description: "The type of action or skill name (e.g. 'Stalking/Hiding', 'Perception', 'Athletics'). Use the exact name from [PLAYER SKILLS] if it fits the intent." },
              actorId: { type: "STRING", description: "The unique ID of the entity taking the action. Use this for NPC turns (found in [ENCOUNTER MODE ACTIVE])." },
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
          description: "Transitions the game to Encounter Mode when combat begins. Pass 'initiatorId' if someone started the fight to give them the first turn.",
          parameters: {
            type: "OBJECT",
            properties: {
              initiatorId: { type: "STRING", description: "The ID of the character who initiated the combat." }
            }
          }
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
  const response = result.response;
  let calls = response.functionCalls() || [];
  
  let rollsSent = false;
  let actionDetails = "";
  let initialNarration = response.text() || "";


  // Recursive tool loop: keep executing tools as long as the AI provides them
  while (calls.length > 0) {
    console.log(`[Orchestrator] 🛑 Intercepted ${calls.length} Function Call(s)`);
    const toolResponses = [];

    for (const call of calls) {
      switch (call.name) {
        case TOOL_NAMES.RESOLVE_ACTION: {
          const actionArgs = call.args;
          let actorEntity = character; // Default to player

          // During encounters, if the DM didn't specify an actorId, 
          // we should ALWAYS assume the current turn-holder is the actor (PC or NPC).
          if (encounterState.isActive && !actionArgs.actorId) {
            const currentTurnActor = encounterState.combatants.find(c => c.id === encounterState.currentTurnId);
            if (currentTurnActor) {
               console.log(`[Orchestrator] ⚔️ Defaulting actor to current turn actor: ${currentTurnActor.name} (${currentTurnActor.id})`);
               const activeEntities = await getActiveCampaignEntities(campaignId);
               const foundActor = activeEntities.find(e => e.id === currentTurnActor.id);
               if (foundActor) {
                 actorEntity = { ...foundActor };
                 // If it's the player's turn, merge with 'character' prop just in case
                 if (currentTurnActor.type === 'pc') {
                   actorEntity = { ...actorEntity, ...character };
                 }
               } else {
                 actorEntity = currentTurnActor;
               }
            }
          }

          // If the DM explicitly specified an actorId (for NPC turns or remote player turns)
          if (actionArgs.actorId) {
            const activeEntities = await getActiveCampaignEntities(campaignId);
            const foundActor = activeEntities.find(e => e.id === actionArgs.actorId);
            if (foundActor) {
              actorEntity = foundActor;
              console.log(`[Orchestrator] ⚔️ Explicit Actor specified by DM: ${actorEntity.name} (${actorEntity.id})`);
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

          // Mark actor as having acted in the database
          // RE-CHECK state from DB right before marking (extreme defensive measure)
          if (!encounterState.isActive && campaignId) {
            const recheck = await getCampaignById(campaignId);
            if (recheck?.encounterState?.isActive) {
              console.log("[Orchestrator] 🛡️ RE-CHECK found active encounter. Syncing state.");
              encounterState = recheck.encounterState;
            }
          }

          if (encounterState.isActive) {
            console.log(`[Orchestrator] ⚔️ Marking action for: ${actorEntity.name} (ID: ${actorEntity.id || 'N/A'})`);
            const updatedCombatants = encounterState.combatants.map(c => {
              const actorId = actorEntity.id;
              const actorName = (actorEntity.name || '').toLowerCase().trim();
              const combatantId = c.id;
              const combatantName = (c.name || '').toLowerCase().trim();
              
              const idMatch = actorId && combatantId && actorId === combatantId;
              const nameMatch = actorName && combatantName && (actorName === combatantName || combatantName.includes(actorName) || actorName.includes(combatantName));
              const isMatch = idMatch || nameMatch;
              
              console.log(`[Orchestrator] TRACE Matching: ${combatantName} (ID: ${combatantId}) vs Actor: ${actorName} (ID: ${actorId}). Result: ID=${idMatch}, Name=${nameMatch}`);
              
              if (isMatch) console.log(`[Orchestrator] ✅ MATCH FOUND for acted combatant: ${c.name}`);
              return isMatch ? { ...c, hasActed: true } : c;
            });



            const campaignDocRef = doc(db, 'campaigns', campaignId);
            await updateDoc(campaignDocRef, {
              'encounterState.combatants': updatedCombatants
            });
            // Update local encounterState for subsequent tool calls in the same loop
            encounterState.combatants = updatedCombatants;
          }


          // Auto-advance turn if in encounter mode AND it's an NPC turn
          // We defer this until after the dice/narration loop below
          if (encounterState.isActive && actorEntity.type === 'npc' && !actionArgs.actionType.toLowerCase().includes('perception')) {
            console.log("[Orchestrator] ⚔️ NPC Action resolved. Turn will auto-advance after animations.");
            shouldAdvanceTurn = true;
          }

          toolResponses.push({
            functionResponse: {
              name: TOOL_NAMES.RESOLVE_ACTION,
              response: {
                outcome: ruleResult,
                turnAdvancement: shouldAdvanceTurn ? "NPC turn complete. Turn will advance automatically." : "No turn change"
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

            actionDetails += `\n${detailText}`;
          }
          break;
        }

        case TOOL_NAMES.SPAWN_NPCS: {
          const { npcType, count = 1 } = call.args;
          const stats = rules.getNPCStats ? rules.getNPCStats(npcType) : {};

          if (stats) {
            const spawnedIds = await spawnNPCs(campaignId, npcType, count, stats);
            toolResponses.push({
              functionResponse: {
                name: TOOL_NAMES.SPAWN_NPCS,
                response: { success: true, message: `Successfully spawned ${count} ${npcType}(s).`, npcDetails: stats }
              }
            });
          }
          break;
        }

        case TOOL_NAMES.ROLL_DICE: {
          const notation = call.args.notation || "1d20";
          const totalResult = await wrappedDiceRoller(notation);
          actionDetails += `\n🎲 Rolling ${notation}... Result: **${totalResult}**`;
          toolResponses.push({
            functionResponse: {
              name: TOOL_NAMES.ROLL_DICE,
              response: { success: true, total: totalResult }
            }
          });
          break;
        }

        case TOOL_NAMES.AWARD_WEALTH: {
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
              name: TOOL_NAMES.AWARD_WEALTH,
              response: { success: true, awarded: { gold, gems, jewelry } }
            }
          });
          break;
        }

        case TOOL_NAMES.AWARD_ITEM: {
          const { name, description, value } = call.args;
          if (character.id) {
            const currentItems = character.items || [];
            await updateCharacter(character.id, {
              items: [...currentItems, { name, description, value, acquiredAt: new Date().toISOString() }]
            });
          }
          toolResponses.push({
            functionResponse: {
              name: TOOL_NAMES.AWARD_ITEM,
              response: { success: true, itemName: name }
            }
          });
          break;
        }

        case TOOL_NAMES.AWARD_EQUIPMENT: {
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
                name: TOOL_NAMES.AWARD_EQUIPMENT,
                response: { success: true, itemAdded: foundItem.name, itemStats: foundItem }
              }
            });
          }
          break;
        }

        case TOOL_NAMES.EQUIP_ITEM: {
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
                name: TOOL_NAMES.EQUIP_ITEM,
                response: { success: true, itemName: itemName, status: status ? "equipped" : "unequipped" }
              }
            });
          }
          break;
        }


        case TOOL_NAMES.START_ENCOUNTER: {
          const { initiatorId = null } = call.args;
          await startEncounter(campaignId, initiatorId);
          toolResponses.push({
            functionResponse: {
              name: TOOL_NAMES.START_ENCOUNTER,
              response: { success: true, message: "Encounter mode started! All players and nearby NPCs have been added. Initiative has been rolled automatically." }
            }
          });
          break;
        }

        case TOOL_NAMES.SET_INITIATIVE: {
          const { initiatives } = call.args;
          if (initiatives && Array.isArray(initiatives)) {
            await setInitiatives(campaignId, initiatives);
          }
          toolResponses.push({
            functionResponse: {
              name: TOOL_NAMES.SET_INITIATIVE,
              response: { success: true, message: "Initiatives updated successfully." }
            }
          });
          break;
        }

        case TOOL_NAMES.NEXT_TURN: {
          console.log("[Orchestrator] ⏭️ 'next_turn' tool called by AI.");
          await nextTurn(campaignId);
          toolResponses.push({
            functionResponse: {
              name: TOOL_NAMES.NEXT_TURN,
              response: { success: true, message: "Advanced to next turn." }
            }
          });
          break;
        }

        case TOOL_NAMES.END_ENCOUNTER: {
          await endEncounter(campaignId);
          toolResponses.push({
            functionResponse: {
              name: TOOL_NAMES.END_ENCOUNTER,
              response: { success: true, message: "Encounter ended. Returned to Adventure Mode." }
            }
          });
          break;
        }
      }
    }

    // After executing all calls, send the responses back to the AI
    if (toolResponses.length > 0) {
      // 1. If we have rolls from this tool pass, trigger them and wait BEFORE the AI narrations
      if (rollId && rolls.length > 0 && !rollsSent) {
        console.log("[Orchestrator] 🎲 Triggering dice and waiting...");
        await addDoc(collection(db, 'campaigns', campaignId, 'messages'), {
          text: `🎲 Rolling dice...`,
          uid: 'system_ai',
          displayName: 'System',
          photoURL: '',
          createdAt: serverTimestamp(),
          isAi: true,
          type: 'Hidden',
          rollId: rollId,
          diceRolls: rolls
        });
        rollsSent = true;
        // The imperative sync in Chat.jsx already waited for the 3D animation,
        // but we add a small buffer for the system message to settle.
        await sleep(1000); 
      }

      if (shouldAdvanceTurn && encounterState.isActive) {
        console.log("[Orchestrator] ⏭️ NPC turn resolved. Advancing after pacing delay.");
        // Extra buffer for narration and action details to be read
        await sleep(2000); 
        await nextTurn(campaignId);
        shouldAdvanceTurn = false;
        hasAdvancedTurn = true;
      }



      // 2. If we had an initial narration wait till now to show it (narrative flow)
      if (initialNarration) {
        await addDoc(collection(db, 'campaigns', campaignId, 'messages'), {
          text: initialNarration,
          uid: 'system_ai',
          displayName: 'AutoDM Agent',
          photoURL: '',
          createdAt: serverTimestamp(),
          isAi: true,
          triggeredBy: user.uid,
          type: 'DungeonMaster'
        });
        initialNarration = ""; // Only send once
      }

      // Small pause for realism/pacing
      await sleep(500);

      const nextResult = await chat.sendMessage(toolResponses);
      const nextResponse = nextResult.response;
      const nextText = nextResponse.text() || "";

      // 3. Save the story narration for this turn
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

  // 4. Final safety: if AI just replied without tools, show initial narration
  if (initialNarration) {
    await addDoc(collection(db, 'campaigns', campaignId, 'messages'), {
      text: initialNarration,
      uid: 'system_ai',
      displayName: 'AutoDM Agent',
      photoURL: '',
      createdAt: serverTimestamp(),
      isAi: true,
      triggeredBy: user.uid,
      type: 'DungeonMaster'
    });
  }

  if (response.functionCalls()?.length === 0) {
    console.log("[Orchestrator] No rule tools called. Direct Conversational LLM Response.");
  }

  console.log("=========================================");

  // 5. Save the final action details to Firestore as a 'Details' log
  if (actionDetails && actionDetails.trim()) {
    // Small delay to ensure it appears after the DM recap
    await sleep(200);
    
    const msgData = {
      text: actionDetails.trim(),
      uid: 'system_ai',
      displayName: 'System',
      photoURL: '',
      createdAt: serverTimestamp(),
      isAi: true,
      triggeredBy: user.uid,
      type: 'Details'
    };

    // Only attach rolls if they haven't been sent on a previous narration line
    if (!rollsSent && rollId && rolls.length > 0) {
      msgData.rollId = rollId;
      msgData.diceRolls = rolls;
    }
    
    await addDoc(collection(db, 'campaigns', campaignId, 'messages'), msgData);
  }

  // 6. Final safety: Ensure NPC turns ALWAYS advance if they were initiated by the system and haven't already advanced.
  // This prevents the game from hanging if the AI fails to use a turn-ending tool or times out.
  if (encounterState?.isActive && !hasAdvancedTurn && isSystemSignal) {
    const currentCombatant = encounterState.combatants?.find(c => c.id === encounterState.currentTurnId);
    if (currentCombatant && currentCombatant.type === 'npc') {
      console.log("[Orchestrator] 🛡️ Final safety check: NPC turn active at end of SYSTEM intent. Forcing turn advance.");
      // Extra buffer for narration and action details to be read
      await sleep(2000);
      await nextTurn(campaignId);
    }
  }

}
