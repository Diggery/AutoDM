import { useState, useEffect } from 'react';
import { getCharactersByUser, createCharacter } from '../services/db';
import { rolemasterSystem } from '../rules/Rolemaster';
import { Plus, User } from 'lucide-react';
import './CharacterPane.css';

export default function CharacterPane({ user, onSelectCharacter }) {
  const [characters, setCharacters] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newCharName, setNewCharName] = useState('');

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

  return (
    <div className="character-pane glass-panel">
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
    </div>
  );
}
