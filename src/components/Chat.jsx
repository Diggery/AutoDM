import { useState, useEffect, useRef } from 'react';
import { LogOut, Settings, Send, Trash2, ArrowLeft } from 'lucide-react';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp, query, orderBy, limit, onSnapshot, getDocs, writeBatch, doc } from 'firebase/firestore';
import { getCharactersByCampaign, resetCampaign } from '../services/db';
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
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef(null);
  const lastProcessedRollIdRef = useRef(null); 
  const lastTriggeredTurnIdRef = useRef(null);
  const pendingRollsRef = useRef(new Map());
  const mountTimeRef = useRef(Date.now());
  const imperativelyRolledIdsRef = useRef(new Set());


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
        // AND skip if they were rolled imperatively by the orchestrator
        if (now - msgTime < 10000 && !activeRollIds.has(rollId) && lastProcessedRollIdRef.current !== rollId && !imperativelyRolledIdsRef.current.has(rollId)) {
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
            
            // Resolve any orchestration logic waiting for this specific roll (legacy sync)
            if (pendingRollsRef.current.has(rollId)) {
              const resolve = pendingRollsRef.current.get(rollId);
              pendingRollsRef.current.delete(rollId);
              resolve();
            }

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

  // Automated NPC turn signal
  useEffect(() => {
    const encounter = campaignData?.encounterState;
    if (encounter?.isActive && encounter.currentTurnId) {
      const activeCombatant = encounter.combatants.find(c => c.id === encounter.currentTurnId);
      const currentRound = encounter.round || 1;
      const turnSignature = `${encounter.currentTurnId}_round_${currentRound}`;
      
      // If it's an NPC turn and we haven't poked the AI for this specific turn/round yet
      // AND we aren't already processing another action
      if (activeCombatant?.type === 'npc' && lastTriggeredTurnIdRef.current !== turnSignature && !isProcessing) {
        console.log(`[Chat] 🤖 Detecting NPC turn: ${activeCombatant.name} (Round ${currentRound}). Sending signal to DM.`);
        lastTriggeredTurnIdRef.current = turnSignature;
        
        // Trigger the DM without a visible user message if possible, or a "System" nudge
        const signalPrompt = `@dm It is now ${activeCombatant.name}'s turn. Please narrate and resolve their action using the tools.`;
        triggerDMAction(signalPrompt, true); // true = isSystemEntry
      }
    }
  }, [campaignData?.encounterState?.currentTurnId, campaignData?.encounterState?.round, isProcessing]);

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
      await resetCampaign(campaignId);
    } catch (err) {
      console.error('Error resetting session:', err);
      alert("Failed to reset session.");
    } finally {
      setIsClearing(false);
    }
  };

  const handleDiceRoll = async (notation, results = null, rollId = null) => {
    console.log("[Chat] 🎲 Generating results and triggering IMPERATIVE roll:", notation, rollId);
    
    let rollData = { total: 0, results: [] };

    if (notation === "1d100" || notation === "d%") {
      const d1 = Math.floor(Math.random() * 10);
      const d2 = Math.floor(Math.random() * 10);
      let val = (d1 * 10) + d2;
      if (val === 0) val = 100;
      const d100_val = d1 === 0 ? 100 : d1 * 10;
      const d10_val = d2 === 0 ? 10 : d2;
      rollData = { total: val, results: [d100_val, d10_val] };
    } else {
      const sd = parseInt(notation.match(/d(\d+)/i)?.[1]) || 20;
      const val = Math.floor(Math.random() * sd) + 1;
      rollData = { total: val, results: [val] };
    }

    // IMPERATIVE TRIGGER: This prevents the 'too early' button bug by awaiting the visual animation here
    if (diceRollerRef.current) {
      if (rollId) imperativelyRolledIdsRef.current.add(rollId);
      console.log("[Chat] 🪄 Awaiting 3D animation for ID:", rollId);
      
      // The 3D engine NEEDS '1d100+1d10' to render two percentile dice, 
      // otherwise it tries to apply 2 results [50, 4] to a single '1d100' die and times out.
      const visualNotation = (notation === '1d100' || notation === 'd%') ? '1d100+1d10' : notation;

      // We pass the visual notation and calculated results to the 3D engine immediately
      await diceRollerRef.current.roll(visualNotation, rollData.results);
      console.log("[Chat] 🪄 3D animation complete.");
    }

    return rollData;
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
        characterName: activeCharacter?.name || null,
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
        characterName: activeCharacter?.name || null,
        type: prompt.toLowerCase().includes('@dm') ? 'InGame' : 'OutOfCharacter'
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

        await triggerDMAction(prompt);
      }
    } catch (err) {
      console.error('Error sending message:', err);
    }
  };

  const waitForRoll = (rollId) => {
    if (!rollId) return Promise.resolve();
    // If it's already finished, resolve immediately
    if (lastProcessedRollIdRef.current === rollId && !activeRollIds.has(rollId)) return Promise.resolve();
    
    return new Promise((resolve) => {
      pendingRollsRef.current.set(rollId, resolve);
      // Safety timeout after 10 seconds
      setTimeout(() => {
        if (pendingRollsRef.current.has(rollId)) {
          pendingRollsRef.current.delete(rollId);
          resolve();
        }
      }, 10000);
    });
  };

  /**
   * Triggers the DM (Gemini) to process an intent.
   * @param {string} prompt - The text to send to the DM
   * @param {boolean} isSystemSignal - If true, this won't be saved as a user message first
   */
  const triggerDMAction = async (prompt, isSystemSignal = false) => {
    if (!activeCharacter && !isSystemSignal) {
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

    setIsProcessing(true);
    try {
      // 1. Build history
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

      // 2. Call processPlayerIntent
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      await processPlayerIntent(
        campaignId,
        user,
        prompt,
        apiKey,
        selectedModel,
        handleDiceRoll,
        activeCharacter,
        rulesetId,
        campaignData,
        finalHistory,
        isSystemSignal
      );


    } catch (error) {
      console.error("[Chat] triggerDMAction Error:", error);
      await addDoc(messagesRef, {
        text: `⚠️ AI Error: ${error.message}`,
        uid: 'system_ai',
        displayName: 'System',
        photoURL: '',
        createdAt: serverTimestamp(),
        isAi: true,
        type: 'Details'
      });
    } finally {
      setIsProcessing(false);
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
          <div className={`speaking-indicator ${newMessage.toLowerCase().includes('@dm') ? 'target-dm' : 'target-ooc'}`}>
            {newMessage.toLowerCase().includes('@dm') ? `${activeCharacter?.name || 'Player'} to DM` : 'OOC'}
          </div>
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
