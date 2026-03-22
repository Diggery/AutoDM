import { useState, useEffect } from 'react';
import { X, Key, Trash2, Bot, Globe, ShieldAlert } from 'lucide-react';
import { AVAILABLE_MODELS } from '../services/ai';
import { updateCampaignApiKey } from '../services/db';
import './SettingsModal.css';

export default function SettingsModal({ isOpen, onClose, onClearChat, isClearing, selectedModel, onModelChange, isOwner, campaignId }) {
  const [apiKey, setApiKey] = useState('');
  const [isUpdatingCampaign, setIsUpdatingCampaign] = useState(false);

  useEffect(() => {
    const savedKey = localStorage.getItem('auto_dm_gemini_key');
    if (savedKey) setApiKey(savedKey);
  }, [isOpen]); // Only reload if opened

  if (!isOpen) return null;

  const handleSave = () => {
    onClose();
  };

  const handleSaveToCampaign = async () => {
    if (!apiKey.trim()) return;
    setIsUpdatingCampaign(true);
    try {
      await updateCampaignApiKey(campaignId, apiKey);
      alert('Campaign API key updated successfully.');
    } catch (err) {
      console.error('Error updating campaign API key:', err);
      alert('Failed to update campaign API key.');
    } finally {
      setIsUpdatingCampaign(false);
    }
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
          {isOwner && (
            <div className="setting-group owner-settings glass-panel secondary" style={{ padding: '1rem', border: '1px solid rgba(var(--primary-rgb), 0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <Globe size={16} color="var(--primary)" />
                <strong style={{ fontSize: '0.9rem' }}>Campaign Owner Settings</strong>
              </div>
              <p className="setting-desc" style={{ marginBottom: '1rem' }}>
                Update the shared Gemini API key for all members of this campaign.
              </p>
              
              <div className="input-with-button" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <input 
                  type="password" 
                  className="input-field" 
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter AIza... Gemini Key"
                  style={{ marginBottom: 0 }}
                />
                
                <p className="setting-desc" style={{ fontSize: '0.8rem', marginTop: 0 }}>
                  <ShieldAlert size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} /> <b>Security Note:</b> This key will be shared with anyone in this campaign.
                </p>

                <button 
                  className="btn btn-secondary" 
                  onClick={handleSaveToCampaign}
                  disabled={isUpdatingCampaign || !apiKey.trim()}
                  style={{ width: '100%', fontSize: '0.85rem' }}
                >
                  {isUpdatingCampaign ? 'Updating...' : 'Update Shared Campaign Key'}
                </button>
              </div>
            </div>
          )}

          <div className="setting-group">
            <label>
              <Bot size={16} /> AI Model
            </label>
            <p className="setting-desc">Select the generative model to be used by the AI Agent.</p>
            <select
              className="input-field model-select"
              value={selectedModel}
              onChange={(e) => onModelChange(e.target.value)}
              style={{ padding: '0.75rem', cursor: 'pointer' }}
            >
              {AVAILABLE_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </div>

          <div className="setting-group">
            <label className="danger-text">
              <Trash2 size={16} /> Data Management
            </label>
            <p className="setting-desc">Clear the entire chat history for this campaign.</p>
            <button 
              className="btn btn-danger" 
              onClick={onClearChat} 
              disabled={isClearing}
            >
              <Trash2 size={16} /> Clear Chat History
            </button>
          </div>
        </div>
        
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
