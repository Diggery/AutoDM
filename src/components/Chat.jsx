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
  const [activeRollIds, setActiveRollIds] = useState(new Set());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0].id);
  const [isClearing, setIsClearing] = useState(false);
  const [campaignData, setCampaignData] = useState(null);
  const [lastMessage, setLastMessage] = useState('');
  const messagesEndRef = useRef(null);
  const lastProcessedRollIdRef = useRef(null); 
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
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.diceRolls && lastMsg.diceRolls.length > 0) {
        const rollId = lastMsg.rollId || lastMsg.id; // Fallback to msg.id for older messages
        const msgTime = lastMsg.createdAt?.toMillis ? lastMsg.createdAt.toMillis() : Date.now();
        const now = Date.now();
        
        // Only trigger for recently created messages that haven't been rolled yet
        if (now - msgTime < 10000 && !activeRollIds.has(rollId) && lastProcessedRollIdRef.current !== rollId) {
          console.log("[Chat] 🎲 Triggering 3D roll for ID:", rollId);
          lastProcessedRollIdRef.current = rollId;
          
          setActiveRollIds(prev => new Set(prev).add(rollId));
          
          const animations = lastMsg.diceRolls.map(roll => {
            if (diceRollerRef.current) {
              return diceRollerRef.current.roll(roll.notation, roll.results);
            }
            return Promise.resolve();
          });
          
          Promise.all(animations).then(() => {
            console.log("[Chat] ✅ Roll complete for ID:", rollId);
            setActiveRollIds(prev => {
              const next = new Set(prev);
              next.delete(rollId);
              return next;
            });
          });
        }
      }
    }
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

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

  const handleDiceRoll = async (notation) => {
    console.log("[Chat] 🎲 Generating results for sync:", notation);
    if (notation === "1d100" || notation === "d%") {
      const d1 = Math.floor(Math.random() * 10);
      const d2 = Math.floor(Math.random() * 10);
      let val = (d1 * 10) + d2;
      if (val === 0) val = 100;
      const d100_val = d1 === 0 ? 100 : d1 * 10;
      const d10_val = d2 === 0 ? 10 : d2;
      return { total: val, results: [d100_val, d10_val] };
    }
    const sd = parseInt(notation.match(/d(\d+)/i)?.[1]) || 20;
    const val = Math.floor(Math.random() * sd) + 1;
    return { total: val, results: [val] };
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const prompt = newMessage.trim();
    if (!prompt) return;

    // Command handling - execute immediately without async wait
    if (prompt.startsWith('/roll')) {
      e.preventDefault();
      const notation = prompt.substring(6).trim() || '1d20';
      const rollData = await handleDiceRoll(notation);
      
      const displayNotation = (notation === '1d100' || notation === 'd%') ? '1d100+1d10' : notation;

      await addDoc(messagesRef, {
        text: `rolls ${notation} and gets a ${rollData.total}`,
        uid: user.uid,
        displayName: user.displayName,
        photoURL: user.photoURL,
        createdAt: serverTimestamp(),
        diceRolls: [{
          notation: displayNotation,
          total: rollData.total,
          results: rollData.results
        }],
        rollId: `roll_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        type: 'InGame'
      });
      setNewMessage('');
      return;
    }

    setNewMessage('');
    setLastMessage(prompt);

    try {
      await addDoc(messagesRef, {
        text: prompt,
        uid: user.uid,
        displayName: user.displayName || 'Player',
        photoURL: user.photoURL || '',
        createdAt: serverTimestamp(),
        type: 'InGame'
      });

      if (prompt.toLowerCase().includes('@dm')) {
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
            console.log("[Chat] 🎲 Generating results for sync:", notation);
            if (notation === "1d100" || notation === "d%") {
              const d1 = Math.floor(Math.random() * 10);
              const d2 = Math.floor(Math.random() * 10);
              let val = (d1 * 10) + d2;
              if (val === 0) val = 100;
              const d100_val = d1 === 0 ? 100 : d1 * 10;
              const d10_val = d2 === 0 ? 10 : d2;
              return { total: val, results: [d100_val, d10_val] };
            }
            const sd = parseInt(notation.match(/d(\d+)/i)?.[1]) || 20;
            const val = Math.floor(Math.random() * sd) + 1;
            return { total: val, results: [val] };
          };

          const filteredHistory = messages
            .filter(msg => msg.type === "InGame" || msg.type === "DungeonMaster")
            .map(msg => ({
              role: msg.type === "DungeonMaster" ? "model" : "user",
              parts: [{ text: msg.text.replace(/@dm/gi, "").trim() }]
            }));

          const finalHistory = [];
          filteredHistory.forEach((msg) => {
            if (finalHistory.length === 0) {
              if (msg.role === "user") finalHistory.push(msg);
            } else {
              const lastRole = finalHistory[finalHistory.length - 1].role;
              if (msg.role !== lastRole) {
                finalHistory.push(msg);
              } else {
                finalHistory[finalHistory.length - 1].parts[0].text += "\n" + msg.parts[0].text;
              }
            }
          });

          const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
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

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowUp' && !newMessage) {
      setNewMessage(lastMessage);
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
          <button className="btn-icon" title="Back to Campaigns" onClick={onBackToLanding}>
            <ArrowLeft size={20} />
          </button>
          <button className="btn-icon danger" title="Sign Out" onClick={onSignOut}>
            <LogOut size={20} />
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
                isDiceRolling={msg.rollId ? activeRollIds.has(msg.rollId) : activeRollIds.has(msg.id)}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className="message-form" onSubmit={handleSend}>
          <input
            className="input-field"
            value={newMessage}
            onKeyDown={handleKeyDown}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type your message... (use @dm to summon AI)"
          />
          <button type="submit" className="btn send-btn" disabled={!newMessage.trim() || isClearing} style={{ width: '200px' }}>
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
