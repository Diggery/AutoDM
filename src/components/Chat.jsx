import { useState, useEffect, useRef } from 'react';
import { LogOut, Settings, Send, Trash2, ArrowLeft } from 'lucide-react';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp, query, orderBy, limit, onSnapshot, getDocs, writeBatch, doc } from 'firebase/firestore';
import Message from './Message';
import SettingsModal from './SettingsModal';
import { AVAILABLE_MODELS } from '../services/ai';
import { processPlayerIntent } from '../services/orchestrator';
import './Chat.css';

export default function Chat({ user, campaignId, rulesetId, activeCharacter, onSignOut, onBackToLanding, diceRollerRef }) {
  const [newMessage, setNewMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0].id);
  const [isClearing, setIsClearing] = useState(false);
  const [campaignData, setCampaignData] = useState(null);
  const messagesEndRef = useRef(null);
  const lastProcessedRollRef = useRef(null); // Track already-played 3D animations
  const mountTimeRef = useRef(Date.now());

  const messagesRef = collection(db, 'campaigns', campaignId, 'messages');

  useEffect(() => {
    const q = query(
      messagesRef,
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })).reverse();
      setMessages(msgs);
    });

    return () => unsubscribe();
  }, [campaignId]);

  useEffect(() => {
    const unsubCampaign = onSnapshot(doc(db, 'campaigns', campaignId), (docSnap) => {
      if (docSnap.exists()) {
        setCampaignData({ id: docSnap.id, ...docSnap.data() });
      }
    });

    return () => unsubCampaign();
  }, [campaignId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

    // Handle Synchronized 3D Dice Rolls
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.diceRolls && lastMsg.diceRolls.length > 0) {
      if (lastProcessedRollRef.current !== lastMsg.id) {
        lastProcessedRollRef.current = lastMsg.id;
        
        // Only trigger for NEW messages created after we entered the campaign
        const msgTime = lastMsg.createdAt?.toMillis ? lastMsg.createdAt.toMillis() : Date.now();
        if (msgTime > mountTimeRef.current) {
          // Skip if we were the ones who triggered this (we already rolled it manually)
          if (lastMsg.uid !== user.uid && lastMsg.triggeredBy !== user.uid) {
            lastMsg.diceRolls.forEach(roll => {
              if (diceRollerRef.current) {
                let notation = roll.notation;
                // Consistent visual enhancement: 1d100 -> 1d100 + 1d10
                if (notation.includes('1d100')) {
                  notation = notation.replace(/1d100/g, '1d100+1d10');
                }
                diceRollerRef.current.roll(notation);
              }
            });
          }
        }
      }
    }
  }, [messages, user.uid]);

  const handleClearChat = async () => {
    if (!window.confirm("Are you sure you want to clear the entire chat history for this campaign? This action cannot be undone.")) return;

    setIsClearing(true);
    try {
      const snapshot = await getDocs(messagesRef);
      const batch = writeBatch(db);

      snapshot.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      await batch.commit();
    } catch (err) {
      console.error('Error clearing chat:', err);
      alert("Failed to clear chat history.");
    } finally {
      setIsClearing(false);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || isClearing) return;

    const textToSend = newMessage;
    setNewMessage('');

    try {
      await addDoc(messagesRef, {
        text: textToSend,
        uid: user.uid,
        characterId: activeCharacter ? activeCharacter.id : null,
        displayName: activeCharacter ? activeCharacter.name : (user.displayName || user.email?.split('@')[0] || 'Unknown User'),
        photoURL: user.photoURL,
        createdAt: serverTimestamp(),
        isAi: false,
        type: textToSend.toLowerCase().includes('@dm') ? 'InGame' : 'OutOfCharacter'
      });

      if (textToSend.toLowerCase().includes('@dm')) {
        const prompt = textToSend.replace(/@dm/gi, '').trim() || 'Hello';
        const personalKey = localStorage.getItem('auto_dm_gemini_key');
        const campaignKey = campaignData?.apiKey;
        const apiKey = personalKey || campaignKey || import.meta.env.VITE_GEMINI_API_KEY;

        if (!apiKey) {
          await addDoc(messagesRef, {
            text: "⚠️ Please configure your Gemini API Key in Settings to use the AI Agent.",
            uid: 'system_ai',
            displayName: 'System',
            photoURL: '',
            createdAt: serverTimestamp(),
            isAi: true,
            type: 'Details'
          });
          return;
        }

        if (!activeCharacter) {
          await addDoc(messagesRef, {
            text: "Hi, you need to select a character to play!",
            uid: 'system_ai',
            displayName: 'System',
            photoURL: '',
            createdAt: serverTimestamp(),
            isAi: true,
            type: 'Details'
          });
          return;
        }

        try {
          const handleDiceRoll = async (notation) => {
            if (diceRollerRef.current) {
              try {
                let safeNotation = notation;
                if (safeNotation.includes('1d100')) {
                  safeNotation = safeNotation.replace(/1d100/g, '1d100+1d10');
                }
                const results = await diceRollerRef.current.roll(safeNotation);
                let total = 0;

                if (results) {
                  if (Array.isArray(results)) {
                    total = results.reduce((acc, group) => acc + (group.value || group.total || 0), 0);
                  } else if (results.total !== undefined) {
                    total = results.total;
                  }

                  if (notation.includes('d100') && total === 0) {
                    total = 100;
                  }

                  return total > 0 ? total : 1;
                }
              } catch (err) {
                console.error("Dice 3D Error:", err);
              }
            }
            const match = notation.match(/(\d*)d(\d+)/i) || [];
            const qt = parseInt(match[1]) || 1;
            const sd = parseInt(match[2]) || 20;
            let sum = 0;
            for (let i = 0; i < qt; i++) sum += Math.floor(Math.random() * sd) + 1;
            return sum;
          };

          // Filter history to ONLY involve the DM (to/from AI or Details)
          // Gemini requires alternating roles starting with 'user'.
          const filteredHistory = messages
            .filter(msg => msg.type === 'InGame' || msg.type === 'DungeonMaster' || msg.type === 'Details')
            .map(msg => ({
              role: (msg.type === 'DungeonMaster' || msg.type === 'Details') ? 'model' : 'user',
              parts: [{ text: msg.text.replace(/@dm/gi, '').trim() }]
            }));

          // Ensure it starts with 'user' and alternates roles
          const finalHistory = [];
          filteredHistory.forEach((msg, idx) => {
            if (finalHistory.length === 0) {
              if (msg.role === 'user') finalHistory.push(msg);
              // Skip if first is model
            } else {
              const lastRole = finalHistory[finalHistory.length - 1].role;
              if (msg.role !== lastRole) {
                finalHistory.push(msg);
              } else {
                // Merge consecutive messages of same role
                finalHistory[finalHistory.length - 1].parts[0].text += '\n' + msg.parts[0].text;
              }
            }
          });

          await processPlayerIntent(campaignId, user, prompt, apiKey, selectedModel, handleDiceRoll, activeCharacter, rulesetId, campaignData?.scenarioText, finalHistory);

        } catch (error) {
          await addDoc(messagesRef, {
            text: `⚠️ AI Error: ${error.message}`,
            uid: 'system_ai',
            displayName: 'System',
            photoURL: '',
            createdAt: serverTimestamp(),
            isAi: true,
            type: 'Details'
          });
        }
      }
    } catch (err) {
      console.error('Error sending message:', err);
    }
  };

  return (
    <div className="chat-layout">
      <div className="chat-header glass-panel">
        <div className="user-info">
          <div className="avatar">
            {user.photoURL ? (
              <img src={user.photoURL} alt="Profile" />
            ) : (
              <span>{user.email ? user.email[0].toUpperCase() : 'U'}</span>
            )}
          </div>
          <div className="user-details">
            <h3>{user.displayName || user.email || 'Anonymous User'}</h3>
            <span className="status">
              {activeCharacter ? `Controlling ${activeCharacter.name}` : 'Spectating...'}
            </span>
          </div>
        </div>

        <div className="header-actions">
          <button className="btn-icon" title="Settings" onClick={() => setIsSettingsOpen(true)}>
            <Settings size={20} />
          </button>
          <button className="btn leave-btn" onClick={onBackToLanding} title="Leave Campaign">
            LEAVE
          </button>
        </div>
      </div>

      <div className="chat-main glass-panel">
        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">✨</div>
              <h3>Welcome to AutoDM</h3>
              <p>Start a conversation in this campaign. Mention <b style={{ color: 'var(--primary)' }}>@dm</b> to talk to the Dungeon Master.</p>
            </div>
          ) : (
            messages.map((msg) => (
              <Message
                key={msg.id}
                message={msg}
                isOwnMessage={msg.uid === user.uid}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className="message-form" onSubmit={handleSend}>
          <input
            className="input-field"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type your message... (use @dm to summon AI)"
          />
          <button type="submit" className="btn send-btn" disabled={!newMessage.trim() || isClearing}>
            <Send size={18} />
          </button>
        </form>
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onClearChat={handleClearChat}
        isClearing={isClearing}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        isOwner={campaignData?.ownerId === user.uid}
        campaignId={campaignId}
      />
    </div>
  );
}
