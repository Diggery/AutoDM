import { useState, useEffect, useRef } from 'react';
import { getCampaignsByUser, createCampaign, joinCampaignByCode, deleteCampaign } from '../services/db';
import { AVAILABLE_RULESETS } from '../rules';
import { ADVENTURES } from '../adventures';
import { Plus, Users, LogIn, Trash2, Copy, Check, X, Settings, LogOut, User as UserIcon } from 'lucide-react';
import './LandingPage.css';

export default function LandingPage({ user, onEnterCampaign, onSignOut }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  // UI State
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const [activeModal, setActiveModal] = useState(null); // 'create' or 'join'

  // Form State
  const [newCampaignName, setNewCampaignName] = useState('');
  const [newCampaignApiKey, setNewCampaignApiKey] = useState('');
  const [selectedRuleset, setSelectedRuleset] = useState(AVAILABLE_RULESETS[0].id);
  const [selectedAdventure, setSelectedAdventure] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const dropdownRef = useRef(null);
  const userDropdownRef = useRef(null);

  useEffect(() => {
    if (user) loadCampaigns();

    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target)) {
        setIsUserDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [user]);

  const loadCampaigns = async () => {
    setLoading(true);
    const data = await getCampaignsByUser(user.uid);
    setCampaigns(data);
    setLoading(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newCampaignName.trim()) return;
    try {
      const adventure = ADVENTURES.find(a => a.id === selectedAdventure);
      const scenarioText = adventure ? adventure.scenarioText : '';
      
      await createCampaign(user, newCampaignName, selectedRuleset, newCampaignApiKey, selectedAdventure, scenarioText);
      setNewCampaignName('');
      setNewCampaignApiKey('');
      setSelectedAdventure('');
      setActiveModal(null);
      loadCampaigns();
    } catch (err) {
      setError('Failed to create campaign');
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    try {
      await joinCampaignByCode(user, joinCode);
      setJoinCode('');
      setActiveModal(null);
      loadCampaigns();
    } catch (err) {
      setError(err.message || 'Failed to join campaign');
    }
  };

  const handleDelete = async (e, campaignId) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this campaign?')) return;
    try {
      await deleteCampaign(campaignId);
      loadCampaigns();
    } catch (err) {
      setError('Failed to delete campaign');
    }
  };

  const copyToClipboard = (e, code, id) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="landing-page">
      <div className="app-bar">
        <div className="app-bar-logo">AutoDM</div>
        <div className="user-profile-section" ref={userDropdownRef}>
          <button className="user-profile-btn" onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}>
            {user.photoURL ? (
              <img src={user.photoURL} alt={user.displayName} className="profile-img" />
            ) : (
              <div className="profile-placeholder">
                <UserIcon size={20} />
              </div>
            )}
          </button>
          {isUserDropdownOpen && (
            <div className="user-dropdown-menu glass-panel">
              <div className="user-info-header">
                <span className="user-name">{user.displayName || 'Adventurer'}</span>
                <span className="user-email">{user.email}</span>
              </div>
              <div className="dropdown-divider"></div>
              <button onClick={() => { setIsUserDropdownOpen(false); }}>
                <Settings size={18} /> Settings
              </button>
              <button onClick={() => { onSignOut(); setIsUserDropdownOpen(false); }} className="logout-btn">
                <LogOut size={18} /> Log Out
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="landing-container">
        <div className="landing-header">
          <div className="header-left">
            <h1>My Campaigns</h1>
            <p>Adventurer's Dashboard</p>
          </div>
          <div className="header-right">
            <div className="action-buttons" ref={dropdownRef}>
              <button className="btn-icon add-btn" onClick={() => setIsDropdownOpen(!isDropdownOpen)}>
                <Plus size={24} />
              </button>
              {isDropdownOpen && (
                <div className="dropdown-menu glass-panel">
                  <button onClick={() => { setActiveModal('create'); setIsDropdownOpen(false); }}>
                    <Plus size={18} /> Create New
                  </button>
                  <button onClick={() => { setActiveModal('join'); setIsDropdownOpen(false); }}>
                    <Users size={18} /> Join with Code
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="landing-content">
          {error && <div className="error-msg">{error}</div>}

          <div className="campaign-list">
            {loading ? (
              <div className="loading-msg">Loading campaigns...</div>
            ) : campaigns.length === 0 ? (
              <div className="empty-state glass-panel">
                <p>No campaigns found. Click the + button to get started!</p>
              </div>
            ) : (
              <div className="list-container">
                {campaigns.map(campaign => (
                  <div key={campaign.id} className="campaign-list-item glass-panel">
                    <div className="item-main">
                      <div className="item-info">
                        <h3>{campaign.name}</h3>
                        <span className="ruleset-tag">{AVAILABLE_RULESETS.find(r => r.id === campaign.rulesetId)?.name || 'Unknown Ruleset'}</span>
                      </div>
                      <div className="item-actions">
                        {campaign.ownerId === user.uid && (
                          <div className="code-display" onClick={(e) => copyToClipboard(e, campaign.joinCode, campaign.id)}>
                            <span>Code: <strong>{campaign.joinCode}</strong></span>
                            {copiedId === campaign.id ? <Check size={14} color="#4ade80" /> : <Copy size={14} />}
                          </div>
                        )}
                        {campaign.ownerId !== user.uid && (
                          <span className="member-tag">Member</span>
                        )}
                      </div>
                    </div>
                    {campaign.ownerId === user.uid && (
                      <div className="item-delete-action" onClick={(e) => handleDelete(e, campaign.id)}>
                        <span>REMOVE</span>
                      </div>
                    )}
                    <div className="item-enter-action" onClick={() => onEnterCampaign(campaign)}>
                      ENTER
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Modals */}
      {activeModal === 'create' && (
        <div className="modal-backdrop">
          <div className="modal-content glass-panel">
            <div className="modal-header">
              <h2>Create New Campaign</h2>
              <button className="btn-icon" onClick={() => setActiveModal(null)}><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Campaign Name</label>
                <input
                  autoFocus
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  placeholder="Enter campaign name..."
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label>Gemini API Key</label>
                <div className="field-desc-container">
                  <p className="field-desc">Required to power the AI Agent for this campaign.</p>
                  {/* TODO: Secure this key by moving it to a proxy backend (Firebase Cloud Function) to avoid client-side exposure. */}
                </div>
                <input
                  type="password"
                  value={newCampaignApiKey}
                  onChange={(e) => setNewCampaignApiKey(e.target.value)}
                  placeholder="AIza..."
                  className="input-field"
                  required
                />
              </div>
              <div className="form-group">
                <label>Adventure (Optional)</label>
                <select 
                  className="input-field" 
                  value={selectedAdventure} 
                  onChange={(e) => setSelectedAdventure(e.target.value)}
                >
                  <option value="">None (Custom Scenario)</option>
                  {ADVENTURES.map(adv => (
                    <option key={adv.id} value={adv.id}>{adv.name}</option>
                  ))}
                </select>
                {selectedAdventure && (
                  <p className="field-desc" style={{ marginTop: '8px', fontSize: '12px' }}>
                    {ADVENTURES.find(a => a.id === selectedAdventure)?.description}
                  </p>
                )}
              </div>
              <button type="submit" className="btn primary-btn" disabled={!newCampaignName.trim() || !newCampaignApiKey.trim()}>
                Create Campaign
              </button>
            </form>
          </div>
        </div>
      )}

      {activeModal === 'join' && (
        <div className="modal-backdrop">
          <div className="modal-content glass-panel">
            <div className="modal-header">
              <h2>Join Campaign</h2>
              <button className="btn-icon" onClick={() => setActiveModal(null)}><X size={20} /></button>
            </div>
            <form onSubmit={handleJoin}>
              <div className="form-group">
                <label>Join Code</label>
                <input
                  autoFocus
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="Enter 6-character code..."
                  className="input-field"
                />
              </div>
              <button type="submit" className="btn secondary-btn" disabled={!joinCode.trim()}>
                Join Campaign
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
