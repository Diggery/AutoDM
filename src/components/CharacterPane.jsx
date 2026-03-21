import { useState, useEffect } from 'react';
import { getCharactersByUser, createCharacter, updateCharacter } from '../services/db';
import { rolemasterSystem } from '../rules/Rolemaster';
import { Plus, User, ArrowLeft } from 'lucide-react';
import './CharacterPane.css';

export default function CharacterPane({ user, onSelectCharacter }) {
  const [characters, setCharacters] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newCharName, setNewCharName] = useState('');
  const [viewMode, setViewMode] = useState('roster');

  useEffect(() => {
    if (user) loadCharacters();
  }, [user]);

  const loadCharacters = async () => {
    try {
      const chars = await getCharactersByUser(user.uid);
      setCharacters(chars);
      if (chars.length > 0 && !activeId) {
        handleSelect(chars[0]);
      }
    } catch (err) {
      console.error("Error loading characters:", err);
    }
  };

  const handleSelect = (char) => {
    setActiveId(char.id);
    if (onSelectCharacter) onSelectCharacter(char);
    setViewMode('sheet');
  };

  const handleUpdateActiveCharacter = async (updates) => {
    if (!activeId) return;
    try {
      await updateCharacter(activeId, updates);
      const updatedChars = characters.map(c => 
        c.id === activeId ? { ...c, ...updates } : c
      );
      setCharacters(updatedChars);
      
      const newActive = updatedChars.find(c => c.id === activeId);
      if (onSelectCharacter) onSelectCharacter(newActive);
    } catch (err) {
      console.error("Failed to update character", err);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newCharName.trim()) return;
    
    // Dynamically request a default template from the active game system
    // Hardcoded to Rolemaster until campaign UI lets players pick systems
    const rules = rolemasterSystem;
    const template = rules.getCharacterTemplate(newCharName);
    
    const newChar = await createCharacter(user.uid, template);
    
    setIsCreating(false);
    setNewCharName('');
    await loadCharacters();
    handleSelect(newChar);
  };

  const selectedCharacter = characters.find(c => c.id === activeId);
  const SystemSheet = rolemasterSystem.CharacterSheet;

  return (
    <div className="character-pane glass-panel">
      {viewMode === 'roster' ? (
        <>
          <div className="pane-header">
            <h2>Your Characters</h2>
            <button className="btn-icon" onClick={() => setIsCreating(!isCreating)} title="Create Character">
              <Plus size={20} />
            </button>
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
              <button type="submit" className="btn primary-btn" disabled={!newCharName.trim()}>Save</button>
            </form>
          )}

          <div className="character-list">
            {characters.length === 0 && !isCreating && (
              <div className="empty-msg">No characters yet. Create one!</div>
            )}
            {characters.map(char => (
              <div 
                key={char.id} 
                onClick={() => handleSelect(char)}
                className={`character-card ${activeId === char.id ? 'active' : ''}`}
              >
                <div className="char-avatar"><User size={24} /></div>
                <div className="char-info">
                  <h4>{char.name}</h4>
                  <span className="char-stats">HP: {char.hp?.current}/{char.hp?.max}</span>
                </div>
              </div>
            ))}
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
