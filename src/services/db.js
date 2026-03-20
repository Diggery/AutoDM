import { db } from '../firebase';
import { collection, doc, getDoc, getDocs, query, where, addDoc, updateDoc } from 'firebase/firestore';

/**
 * Creates a new Character (PC or NPC).
 */
export async function createCharacter(userId, characterData) {
  const payload = {
    ownerId: userId,
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

/**
 * Fetches a single character by ID.
 */
export async function getCharacterById(characterId) {
  const c = await getDoc(doc(db, 'characters', characterId));
  return c.exists() ? { id: c.id, ...c.data() } : null;
}

/**
 * Fetches all entities (PCs or NPCs) currently active in a specific campaign.
 * The campaign document contains an array of active character IDs.
 */
export async function getActiveCampaignEntities(campaignId) {
  try {
    const campaignDoc = await getDoc(doc(db, 'campaigns', campaignId));
    if (!campaignDoc.exists()) return [];
    
    const entityIds = campaignDoc.data().activeEntities || [];
    if (entityIds.length === 0) return [];
    
    // Fetch all those characters
    const entities = [];
    for (const id of entityIds) {
      const char = await getCharacterById(id);
      if (char) entities.push(char);
    }
    return entities;
  } catch (err) {
    console.error('Error fetching campaign entities', err);
    return [];
  }
}

/**
 * Creates/Gets a default mock campaign to satisfy the prototype architecture
 */
export async function getOrCreateDefaultCampaign() {
  const campaignId = 'default_campaign_v1';
  const c = await getDoc(doc(db, 'campaigns', campaignId));
  
  if (!c.exists()) {
    // Create the default campaign bridging the gap
    await setDoc(doc(db, 'campaigns', campaignId), {
      name: "The Sandbox",
      activeEntities: [] // We will push character IDs into here as they join
    });
    return { id: campaignId, name: "The Sandbox", activeEntities: [] };
  }
  
  return { id: c.id, ...c.data() };
}
