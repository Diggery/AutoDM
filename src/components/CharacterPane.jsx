import { useState, useEffect, useRef } from 'react';
import { getCharactersByUser, createCharacter, updateCharacter, updateCampaignMember, getCharactersByCampaign, assignCharacterToCampaign } from '../services/db';
import { rolemasterSystem } from '../rules/Rolemaster';
import { db } from '../firebase';
import { doc, onSnapshot, collection, query, where } from 'firebase/firestore';
import { Plus, User, ArrowLeft, MoreVertical, Search, CheckCircle, X } from 'lucide-react';
import './CharacterPane.css';

export default function CharacterPane({ user, campaignId, onSelectCharacter }) {
  const [characters, setCharacters] = useState([]);
  const [allUserCharacters, setAllUserCharacters] = useState([]); // For import
  const [controlledId, setControlledId] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [hoveredCharId, setHoveredCharId] = useState(null); // For "RELINQUISH" hover
  const [isCreating, setIsCreating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [newCharName, setNewCharName] = useState('');
  const [viewMode, setViewMode] = useState('roster');
  const [campaignMembers, setCampaignMembers] = useState({});
  const addMenuRef = useRef(null);

  useEffect(() => {
    if (user && campaignId) {
      loadAllUserCharacters();
      
      // Real-time synchronization for campaign characters
      const q = query(collection(db, 'characters'), where('campaignId', '==', campaignId));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const chars = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setCharacters(chars);
      }, (err) => {
        console.error("Error syncing characters:", err);
      });
      
      return () => unsubscribe();
    }
  }, [user, campaignId]);

  // Sync the app-level active character whenever controlledId or characters list change
  useEffect(() => {
    if (controlledId && characters.length > 0) {
      const myChar = characters.find(c => c.id === controlledId);
      if (myChar) {
        onSelectCharacter(myChar);
      }
    } else if (controlledId === null) {
      onSelectCharacter(null);
    }
  }, [controlledId, characters, onSelectCharacter]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target)) {
        setIsAddMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!campaignId) return;
    const unsubscribe = onSnapshot(doc(db, 'campaigns', campaignId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const members = data.members || {};
        setCampaignMembers(members);
        
        // If the current user is not in the members map yet (e.g. legacy campaign), add them
        if (!members[user.uid]) {
          updateCampaignMember(campaignId, user.uid, {
            uid: user.uid,
            displayName: user.displayName || user.email?.split('@')[0] || 'Unknown User',
            photoURL: user.photoURL || '',
            activeCharacterId: null
          });
        }
        
        // If the current user has an active character in this campaign, sync local state
        const myMemberData = members[user.uid];
        if (myMemberData?.activeCharacterId) {
          setControlledId(myMemberData.activeCharacterId);
        }
      }
    });
    return () => unsubscribe();
  }, [campaignId, user.uid]);

  // loadCharacters is now handled by the onSnapshot listener above

  const loadAllUserCharacters = async () => {
    try {
      const chars = await getCharactersByUser(user.uid);
      setAllUserCharacters(chars);
    } catch (err) {
      console.error("Error loading all user characters:", err);
    }
  };

  const handleSelect = async (char) => {
    // If already controlling, relinquish control. Otherwise, take it.
    const isRelinquishing = controlledId === char.id;
    const nextCharId = isRelinquishing ? null : char.id;

    setControlledId(nextCharId);
    if (onSelectCharacter) onSelectCharacter(isRelinquishing ? null : char);
    
    // Sync to Firestore
    if (campaignId) {
      try {
        await updateCampaignMember(campaignId, user.uid, { activeCharacterId: nextCharId });
      } catch (err) {
        console.error("Error updating campaign member:", err);
      }
    }
  };

  const handleView = (char) => {
    setViewingId(char.id);
    setViewMode('sheet');
  };

  const handleUpdateActiveCharacter = async (updates) => {
    if (!viewingId) return;
    try {
      // We only update Firestore; the onSnapshot listener will handle updating local state
      await updateCharacter(viewingId, updates);
    } catch (err) {
      console.error("Failed to update character", err);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newCharName.trim()) return;
    
    // Dynamically request a default template from the active game system
    const rules = rolemasterSystem;
    const template = rules.getCharacterTemplate(newCharName);
    
    const newChar = await createCharacter(user.uid, template, campaignId);
    
    setIsCreating(false);
    setNewCharName('');
    handleView(newChar);
  };

  const handleImport = async (char) => {
    try {
      await assignCharacterToCampaign(char.id, campaignId);
      setIsImporting(false);
    } catch (err) {
      console.error("Error importing character:", err);
    }
  };

  const handleRemoveFromCampaign = async (char) => {
    if (!window.confirm(`Are you sure you want to remove ${char.name} from this campaign? It will NOT be deleted.`)) {
      return;
    }

    try {
      // 1. Relinquish control if this character is currently controlled by anyone
      const controller = Object.entries(campaignMembers).find(([uid, m]) => m.activeCharacterId === char.id);
      if (controller) {
        const [uid] = controller;
        await updateCampaignMember(campaignId, uid, { activeCharacterId: null });
      }

      // 2. Remove campaign association from the character itself
      await assignCharacterToCampaign(char.id, null);

      // 3. Reset local states if it was the one we were viewing or controlling
      if (viewingId === char.id) setViewMode('roster');
      if (controlledId === char.id) setControlledId(null);
    } catch (err) {
      console.error("Error removing character from campaign:", err);
    }
  };

  const selectedCharacter = characters.find(c => c.id === viewingId);
  const SystemSheet = rolemasterSystem.CharacterSheet;

  return (
    <div className="character-pane glass-panel">
      {viewMode === 'roster' ? (
        <>
          <div className="pane-header">
            <h2>Campaign Characters</h2>
            <div className="add-character-context" ref={addMenuRef}>
              <button className="btn-icon" onClick={() => setIsAddMenuOpen(!isAddMenuOpen)} title="Add Character">
                <Plus size={20} />
              </button>
              {isAddMenuOpen && (
                <div className="add-dropdown glass-panel">
                  <button onClick={() => { setIsCreating(true); setIsAddMenuOpen(false); setIsImporting(false); }}>
                    <Plus size={16} /> Create New
                  </button>
                  <button onClick={() => { setIsImporting(true); loadAllUserCharacters(); setIsAddMenuOpen(false); setIsCreating(false); }}>
                    <Search size={16} /> Import
                  </button>
                </div>
              )}
            </div>
          </div>

          {isCreating && (
            <form className="create-form" onSubmit={handleCreate}>
              <input 
                autoFocus
                value={newCharName} 
                onChange={(e) => setNewCharName(e.target.value)} 
                placeholder="Character Name..."
                className="input-field"
              />
              <div className="form-actions">
                <button type="button" className="btn secondary-btn" onClick={() => setIsCreating(false)}>Cancel</button>
                <button type="submit" className="btn primary-btn" disabled={!newCharName.trim()}>Save</button>
              </div>
            </form>
          )}

          {isImporting && (
            <div className="import-container">
              <div className="import-header">
                <h3>Import Character</h3>
                <button className="btn-icon" onClick={() => setIsImporting(false)}><ArrowLeft size={16} /></button>
              </div>
              <div className="import-list">
                {allUserCharacters
                  .filter(c => c.campaignId !== campaignId)
                  .map(char => (
                    <div key={char.id} className="import-item" onClick={() => handleImport(char)}>
                      <div className="char-info">
                        <strong>{char.name}</strong>
                        <span>{char.campaignId ? 'Already In Campaign' : 'Available'}</span>
                      </div>
                      <Plus size={18} />
                    </div>
                  ))}
                {allUserCharacters.filter(c => c.campaignId !== campaignId).length === 0 && (
                  <div className="empty-msg">No characters available to import.</div>
                )}
              </div>
            </div>
          )}

          <div className="character-list">
            {characters.length === 0 && !isCreating && (
              <div className="empty-msg">No characters yet. Create one!</div>
            )}
            {characters.map(char => {
              // Find if anyone is controlling this character in this campaign
              const controller = Object.values(campaignMembers).find(m => m.activeCharacterId === char.id);
              
              return (
                <div 
                  key={char.id} 
                  onClick={() => handleView(char)}
                  className="character-card"
                  style={{ display: 'flex', alignItems: 'center' }}
                >
                  <div className="char-avatar"><User size={24} /></div>
                  <div className="char-info" style={{ flex: 1 }}>
                    <h4>{char.name}</h4>
                    <span className="char-stats">HP: {char.hp?.current}/{char.hp?.max}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                      {controller && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                          Player: {controller.displayName || 'Unknown'}
                        </span>
                      )}
                      <button 
                        className={`btn roster-select-btn ${controlledId === char.id ? 'btn-selected' : 'btn-select-outline'}`}
                        onMouseEnter={() => setHoveredCharId(char.id)}
                        onMouseLeave={() => setHoveredCharId(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelect(char);
                        }}
                      >
                        {controlledId === char.id 
                          ? (hoveredCharId === char.id ? 'RELINQUISH' : 'CONTROLLED')
                          : (controller ? 'TAKE OVER' : 'CONTROL')}
                      </button>
                    </div>
                    <button 
                      className="btn btn-icon remove-char-btn"
                      title="Remove from campaign"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFromCampaign(char);
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <div className="pane-header" style={{ justifyContent: 'flex-start', gap: '12px' }}>
            <button className="btn-icon" onClick={() => setViewMode('roster')} title="Back to Roster">
              <ArrowLeft size={20} />
            </button>
            <h2 style={{ fontSize: '1.25rem' }}>Character Sheet</h2>
          </div>
          <div style={{ flex: 1, overflowY: 'hidden' }}>
            {selectedCharacter && SystemSheet ? (
              <SystemSheet 
                characterData={selectedCharacter}
                onUpdateCharacter={handleUpdateActiveCharacter}
              />
            ) : (
              <div style={{ padding: '16px' }}>No sheet available.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
