import { db } from '../firebase';
import { doc, getDoc, updateDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getRulesetById } from '../rules';
import { getActiveCampaignEntities, updateCharacter, getCharacterById } from './db';

/**
 * Service to manage Encounter Mode lifecycle and state transitions.
 */

/**
 * Starts an encounter for the campaign with all currently active entities.
 */
export async function startEncounter(campaignId, initiatorId = null) {
  const campaignDocRef = doc(db, 'campaigns', campaignId);
  const campaignSnap = await getDoc(campaignDocRef);
  if (!campaignSnap.exists()) return;
  const campaignData = campaignSnap.data();

  const entities = await getActiveCampaignEntities(campaignId);
  
  const rulesetId = (campaignData.rulesetId || 'rolemaster').toLowerCase();
  const rules = getRulesetById(rulesetId)?.system;

  const combatants = entities.map(e => {
    let init = rules ? rules.rollInitiative(e) : Math.random();

    return {
      id: e.id,
      name: e.name || 'Unknown',
      type: e.type || 'pc',
      initiative: init,
      hasActed: false
    };
  });

  // Sort descending by initiative score
  combatants.sort((a, b) => b.initiative - a.initiative);

  await updateDoc(campaignDocRef, {
    encounterState: {
      isActive: true,
      combatants,
      currentTurnId: combatants.length > 0 ? combatants[0].id : null,
      round: 1,
      turnTriggered: null // Reset trigger claim
    }
  });

  console.log(`[EncounterService] ⚔️ Encounter started in campaign ${campaignId}.`);
}

/**
 * Advances the encounter to the next turn.
 */
export async function nextTurn(campaignId) {
  const campaignDocRef = doc(db, 'campaigns', campaignId);
  const campaignDoc = await getDoc(campaignDocRef);
  if (!campaignDoc.exists()) return;
  
  const state = campaignDoc.data().encounterState;
  if (!state || !state.isActive || !state.combatants || state.combatants.length === 0) return;
  
  const currentIdx = state.combatants.findIndex(c => c.id === state.currentTurnId);
  let nextIdx = currentIdx + 1;
  let newRound = state.round || 1;
  
  if (nextIdx >= state.combatants.length) {
    nextIdx = 0;
    newRound += 1;
  }
  
  const nextCombatant = state.combatants[nextIdx];

  // Reset hasActed for ALL combatants when advancing the turn
  const updatedCombatants = state.combatants.map(c => ({ ...c, hasActed: false }));
  
  await updateDoc(campaignDocRef, {
    'encounterState.currentTurnId': nextCombatant.id,
    'encounterState.round': newRound,
    'encounterState.combatants': updatedCombatants,
    'encounterState.turnTriggered': null // Reset trigger claim for the new turn
  });

  console.log(`[EncounterService] ⏭️ Turn Advanced to ${nextCombatant.name}. Round ${newRound}.`);
}

/**
 * Mechanically applies damage to a combatant in the database.
 */
export async function applyDamage(campaignId, combatantId, damage) {
  if (damage <= 0) return null;

  console.log(`[EncounterService] 💥 Applying ${damage} damage to ${combatantId}`);

  // 1. Update the character document directly
  const character = await getCharacterById(combatantId);
  if (character) {
    const currentHp = character.currentHp || character.hp || 20;
    const newHp = Math.max(0, currentHp - damage);
    await updateCharacter(combatantId, { currentHp: newHp });
    console.log(`[EncounterService]   ${character.name} HP: ${currentHp} -> ${newHp}`);

    return { name: character.name, newHp };
  }
  return null;
}

/**
 * Ends the encounter.
 */
export async function endEncounter(campaignId) {
  const campaignDocRef = doc(db, 'campaigns', campaignId);
  await updateDoc(campaignDocRef, {
    encounterState: {
      isActive: false,
      combatants: [],
      currentTurnId: null,
      round: 0,
      turnTriggered: null
    }
  });
  console.log(`[EncounterService] 🏳️ Encounter ended in campaign ${campaignId}.`);
}

/**
 * Sets initiatives manually.
 */
export async function setInitiatives(campaignId, initiatives) {
  const campaignDocRef = doc(db, 'campaigns', campaignId);
  const campaignDoc = await getDoc(campaignDocRef);
  if (!campaignDoc.exists()) return;
  
  const state = campaignDoc.data().encounterState;
  if (!state || !state.isActive) return;
  
  let combatants = [...state.combatants];
  for (const item of initiatives) {
    const idx = combatants.findIndex(c => 
      c.id === item.idOrName || 
      c.name.toLowerCase() === item.idOrName.toLowerCase() ||
      c.name.toLowerCase().includes(item.idOrName.toLowerCase())
    );
    if (idx !== -1) {
      combatants[idx].initiative = item.initiative;
    }
  }
  
  combatants.sort((a, b) => b.initiative - a.initiative);
  const currentTurnId = combatants.length > 0 ? combatants[0].id : null;
  
  await updateDoc(campaignDocRef, {
    'encounterState.combatants': combatants,
    'encounterState.currentTurnId': currentTurnId,
    'encounterState.turnTriggered': null
  });
}
