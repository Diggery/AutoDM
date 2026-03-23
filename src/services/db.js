import { db } from '../firebase';
import { collection, doc, getDoc, getDocs, query, where, addDoc, updateDoc, deleteDoc, arrayUnion, setDoc } from 'firebase/firestore';
import { getRulesetById } from '../rules';

/**
 * Creates a new Character (PC or NPC).
 */
export async function createCharacter(userId, characterData, campaignId = null) {
  const payload = {
    ownerId: userId,
    campaignId: campaignId,
    type: characterData.type || 'pc',
    // We let the active Rule Module structure the rest entirely!
    ...characterData,
    createdAt: new Date()
  };
  
  const docRef = await addDoc(collection(db, 'characters'), payload);
  return { id: docRef.id, ...payload };
}

/**
 * Updates an existing character.
 */
export async function updateCharacter(characterId, characterData) {
  const docRef = doc(db, 'characters', characterId);
  await updateDoc(docRef, characterData);
}

/**
 * Fetches all PCs owned by a user.
 */
export async function getCharactersByUser(userId) {
  const q = query(collection(db, 'characters'), where('ownerId', '==', userId), where('type', '==', 'pc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function getCharacterById(characterId) {
  const c = await getDoc(doc(db, 'characters', characterId));
  return c.exists() ? { id: c.id, ...c.data() } : null;
}

/**
 * Fetches all characters (PC/NPC) linked to a specific campaign.
 */
export async function getCharactersByCampaign(campaignId) {
  const q = query(collection(db, 'characters'), where('campaignId', '==', campaignId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Assigns an existing character to a campaign.
 */
export async function assignCharacterToCampaign(characterId, campaignId) {
  const docRef = doc(db, 'characters', characterId);
  await updateDoc(docRef, { campaignId });
}

/**
 * Fetches a single campaign by ID.
 */
export async function getCampaignById(campaignId) {
  const docRef = doc(db, 'campaigns', campaignId);
  const campaignDoc = await getDoc(docRef);
  return campaignDoc.exists() ? { id: campaignDoc.id, ...campaignDoc.data() } : null;
}

/**
 * Fetches all campaigns where the user is an owner or a member.
 */
export async function getCampaignsByUser(userId) {
  try {
    // Firestore doesn't support logical OR in a single query for different fields easily without complex indexing
    // So we perform two queries and merge them, or use 'memberIds' array-contains which includes owners if we add them
    const q = query(collection(db, 'campaigns'), where('memberIds', 'array-contains', userId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) {
    console.error("Error fetching campaigns:", err);
    return [];
  }
}

/**
 * Creates a new campaign.
 */
export async function createCampaign(user, name, rulesetId = 'rolemaster', apiKey = '', adventureId = '', scenarioText = '') {
  // Generate a simple unique join code
  const joinCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  
  const payload = {
    name,
    rulesetId,
    apiKey, // Shared API key for the campaign
    ownerId: user.uid,
    memberIds: [user.uid],
    members: {
      [user.uid]: {
        uid: user.uid,
        displayName: user.displayName || user.email?.split('@')[0] || 'Unknown User',
        photoURL: user.photoURL || '',
        activeCharacterId: null
      }
    },
    joinCode,
    createdAt: new Date(),
    activeEntities: [],
    adventureId,
    scenarioText
  };
  
  const docRef = await addDoc(collection(db, 'campaigns'), payload);
  return { id: docRef.id, ...payload };
}

/**
 * Updates the shared API key for a campaign.
 * // TODO: Secure this key by moving it to a proxy backend (Firebase Cloud Function) to avoid client-side exposure.
 */
export async function updateCampaignApiKey(campaignId, apiKey) {
  const docRef = doc(db, 'campaigns', campaignId);
  await updateDoc(docRef, { apiKey });
}

/**
 * Joins a campaign using a join code.
 */
export async function joinCampaignByCode(user, joinCode) {
  const q = query(collection(db, 'campaigns'), where('joinCode', '==', joinCode.toUpperCase()));
  const snapshot = await getDocs(q);
  
  if (snapshot.empty) {
    throw new Error("Invalid join code");
  }
  
  const campaignDoc = snapshot.docs[0];
  const campaignId = campaignDoc.id;
  
  await updateDoc(doc(db, 'campaigns', campaignId), {
    memberIds: arrayUnion(user.uid),
    [`members.${user.uid}`]: {
      uid: user.uid,
      displayName: user.displayName || user.email?.split('@')[0] || 'Unknown User',
      photoURL: user.photoURL || '',
      activeCharacterId: null
    }
  });
  
  return { id: campaignId, ...campaignDoc.data() };
}

/**
 * Updates a member's data in the campaign.
 */
export async function updateCampaignMember(campaignId, userId, updates) {
  const docRef = doc(db, 'campaigns', campaignId);
  const finalUpdates = {};
  for (const key in updates) {
    finalUpdates[`members.${userId}.${key}`] = updates[key];
  }
  await updateDoc(docRef, finalUpdates);
}

/**
 * Deletes a campaign.
 * NOTE: For a real app, you'd want to delete subcollections too (messages), 
 * but Firestore doesn't do that automatically.
 */
export async function deleteCampaign(campaignId) {
  await deleteDoc(doc(db, 'campaigns', campaignId));
}

/**
 * Fetches all entities (PCs or NPCs) currently active in a specific campaign.
 */
export async function getActiveCampaignEntities(campaignId) {
  try {
    const q = query(collection(db, 'characters'), where('campaignId', '==', campaignId));
    const snapshot = await getDocs(q);
    
    // Also check for 'activeEntities' in campaign doc (for legacy or specifically tracked IDs)
    const campaignDoc = await getDoc(doc(db, 'campaigns', campaignId));
    const trackedIds = campaignDoc.exists() ? (campaignDoc.data().activeEntities || []) : [];
    
    const entities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // If there are tracked IDs not caught by the query (unlikely but possible for NPCs), fetch them
    for (const id of trackedIds) {
      if (!entities.find(e => e.id === id)) {
        const char = await getCharacterById(id);
        if (char) entities.push(char);
      }
    }
    
    return entities;
  } catch (err) {
    console.error('Error fetching campaign entities', err);
    return [];
  }
}

/**
 * Spawns multiple NPCs of a given type and adds them to the campaign's active entities.
 */
export async function spawnNPCs(campaignId, npcType, count, stats) {
  const entityIds = [];
  
  for (let i = 1; i <= count; i++) {
    const name = count > 1 ? `${npcType} ${i}` : npcType;
    const charData = {
      name,
      type: 'npc',
      npcType,
      ...stats,
      currentHp: stats.hp || stats.hits || 20,
      maxHp: stats.hp || stats.hits || 20,
    };
    
    const char = await createCharacter('system_ai', charData, campaignId);
    entityIds.push(char.id);
  }
  
  const campaignDoc = doc(db, 'campaigns', campaignId);
  await updateDoc(campaignDoc, {
    activeEntities: arrayUnion(...entityIds)
  });
  
  return entityIds;
}

/**
 * Starts an encounter for the campaign with all currently active entities.
 */
export async function startEncounter(campaignId, initiatorId = null) {
  const campaignDocRef = doc(db, 'campaigns', campaignId);
  const campaignSnap = await getDoc(campaignDocRef);
  if (!campaignSnap.exists()) return;
  const campaignData = campaignSnap.data();

  const entities = await getActiveCampaignEntities(campaignId);
  
  // Load the ruleset to get accurate initiative rolls
  const rulesetId = (campaignData.rulesetId || 'rolemaster').toLowerCase();
  const rules = getRulesetById(rulesetId)?.system;

  const combatants = entities.map(e => {
    let init = rules ? rules.rollInitiative(e) : Math.random();
    
    // If this is the initiator, they get "Advantage" (placed at top)
    if (initiatorId && e.id === initiatorId) {
      init = 100;
    }

    return {
      id: e.id,
      name: e.name || 'Unknown',
      type: e.type || 'npc',
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
      round: 1
    }
  });
}

/**
 * Bulk updates initiatives for combatants and sorts them.
 * initiatives is an array of { idOrName: 'string', initiative: number }
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
  
  // Sort descending by initiative score
  combatants.sort((a, b) => b.initiative - a.initiative);
  
  // Update the current turn to the first in the list
  const currentTurnId = combatants.length > 0 ? combatants[0].id : null;
  
  await updateDoc(campaignDocRef, {
    'encounterState.combatants': combatants,
    'encounterState.currentTurnId': currentTurnId
  });
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
  
  // Reset hasActed for all combatants when advancing the turn/round
  const updatedCombatants = state.combatants.map(c => ({ ...c, hasActed: false }));
  
  await updateDoc(campaignDocRef, {
    'encounterState.currentTurnId': state.combatants[nextIdx].id,
    'encounterState.round': newRound,
    'encounterState.combatants': updatedCombatants
  });


  console.log(`[Database] ⚔️ Turn Advanced from ${state.combatants[currentIdx].name} to ${state.combatants[nextIdx].name} (ID: ${state.combatants[nextIdx].id}). It is now Round ${newRound}.`);
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
      round: 0
    }
  });
}

/**
 * Resets the entire campaign session:
 * 1. Clears chat history (handled in Chat.jsx)
 * 2. Removes all spawned NPCs from the database
 * 3. Clears activeEntities and resets encounterState
 */
export async function resetCampaign(campaignId) {
  const campaignDocRef = doc(db, 'campaigns', campaignId);
  const campaignSnap = await getDoc(campaignDocRef);
  
  if (campaignSnap.exists()) {
    const data = campaignSnap.data();
    const npcIds = data.activeEntities || [];
    
    // We fetch and delete NPCs one by one (or could batch if needed)
    for (const id of npcIds) {
      try {
        const charRef = doc(db, 'characters', id);
        const charSnap = await getDoc(charRef);
        if (charSnap.exists() && charSnap.data().type === 'npc') {
          await deleteDoc(charRef);
        }
      } catch (err) {
        console.error(`Failed to delete NPC ${id}:`, err);
      }
    }

    // Reset the campaign document state
    await updateDoc(campaignDocRef, {
      activeEntities: [],
      encounterState: {
        isActive: false,
        combatants: [],
        currentTurnId: null,
        round: 0
      }
    });
  }
}
