import { useState, useEffect } from 'react';
import { X, Key } from 'lucide-react';
import './SettingsModal.css';

export default function SettingsModal({ isOpen, onClose }) {
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    const savedKey = localStorage.getItem('auto_dm_gemini_key');
    if (savedKey) setApiKey(savedKey);
  }, [isOpen]); // Only reload if opened

  if (!isOpen) return null;

  const handleSave = () => {
    localStorage.setItem('auto_dm_gemini_key', apiKey);
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content glass-panel">
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        
        <div className="modal-body">
          <div className="setting-group">
            <label>
              <Key size={16} /> Gemini API Key
            </label>
            <p className="setting-desc">Provided key is securely stored in your local browser storage and only used to contact the AI platform when you use "@dm".</p>
            <input 
              type="password" 
              className="input-field" 
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIza..."
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}
