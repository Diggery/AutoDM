import { db } from '../firebase';
import { collection, doc, getDoc, getDocs, query, where, addDoc, updateDoc, deleteDoc, arrayUnion, setDoc } from 'firebase/firestore';

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
export async function createCampaign(user, name, rulesetId = 'rolemaster') {
  // Generate a simple unique join code
  const joinCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  
  const payload = {
    name,
    rulesetId,
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
    activeEntities: []
  };
  
  const docRef = await addDoc(collection(db, 'campaigns'), payload);
  return { id: docRef.id, ...payload };
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
    const campaignDoc = await getDoc(doc(db, 'campaigns', campaignId));
    if (!campaignDoc.exists()) return [];
    
    const entityIds = campaignDoc.data().activeEntities || [];
    if (entityIds.length === 0) return [];
    
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
