import { useState, useEffect, useRef } from 'react';
import { LogOut, Settings, Send } from 'lucide-react';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import Message from './Message';
import SettingsModal from './SettingsModal';
import DiceRoller from './DiceRoller';
import { getAiResponse, AVAILABLE_MODELS } from '../services/ai';
import './Chat.css';

export default function Chat({ user, onSignOut }) {
  const [newMessage, setNewMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0].id);
  const messagesEndRef = useRef(null);
  const diceRollerRef = useRef(null);

  useEffect(() => {
    const q = query(
      collection(db, 'messages'),
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
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    
    const textToSend = newMessage;
    setNewMessage('');
    
    try {
      await addDoc(collection(db, 'messages'), {
        text: textToSend,
        uid: user.uid,
        displayName: user.displayName || user.email?.split('@')[0] || 'Unknown User',
        photoURL: user.photoURL,
        createdAt: serverTimestamp(),
        isAi: false
      });
      
      if (textToSend.toLowerCase().includes('@dm')) {
        const prompt = textToSend.replace(/@dm/gi, '').trim() || 'Hello';
        const apiKey = localStorage.getItem('auto_dm_gemini_key');
        
        if (!apiKey) {
          await addDoc(collection(db, 'messages'), {
            text: "⚠️ Please configure your Gemini API Key in Settings to use the AI Agent.",
            uid: 'system_ai',
            displayName: 'System',
            photoURL: '',
            createdAt: serverTimestamp(),
            isAi: true
          });
          return;
        }

        try {
          const aiData = await getAiResponse(apiKey, prompt, selectedModel);
          
          if (aiData.type === 'tool_call' && aiData.name === 'roll_dice') {
            const notation = aiData.args.notation;
            
            // Trigger 3D dice roll
            if (diceRollerRef.current) {
              const results = await diceRollerRef.current.roll(notation);
              const totalResult = results.reduce((acc, curr) => acc + curr.value, 0);
              
              // Add a message about the roll result
              await addDoc(collection(db, 'messages'), {
                text: `🎲 Rolling ${notation}... Result: **${totalResult}**`,
                uid: 'system_ai',
                displayName: 'AutoDM Agent',
                photoURL: '',
                createdAt: serverTimestamp(),
                isAi: true,
                model: selectedModel
              });

              // Optional: Get a follow-up response from the AI about the result
              // For now, we'll just stop here to avoid complexity with chat history.
            }
          } else if (aiData.type === 'text') {
            await addDoc(collection(db, 'messages'), {
              text: aiData.text,
              uid: 'system_ai',
              displayName: 'AutoDM Agent',
              photoURL: '',
              createdAt: serverTimestamp(),
              isAi: true,
              model: selectedModel
            });
          }
        } catch (error) {
          await addDoc(collection(db, 'messages'), {
            text: `⚠️ AI Error: ${error.message}`,
            uid: 'system_ai',
            displayName: 'System',
            photoURL: '',
            createdAt: serverTimestamp(),
            isAi: true
          });
        }
      }
    } catch (err) {
      console.error('Error sending message:', err);
    }
  };

  return (
    <div className="chat-layout animate-fade-in">
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
            <span className="status">Online</span>
          </div>
        </div>
        
        <div className="header-actions">
          <select 
            className="model-select"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
          >
            {AVAILABLE_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
          <button className="btn-icon" title="Settings" onClick={() => setIsSettingsOpen(true)}>
            <Settings size={20} />
          </button>
          <button className="btn-icon" onClick={onSignOut} title="Sign Out">
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
              <p>Start a conversation. Mention <b style={{color: 'var(--primary)'}}>@dm</b> to talk to the AI agent.</p>
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
          <button type="submit" className="btn send-btn" disabled={!newMessage.trim()}>
            <Send size={18} />
          </button>
        </form>
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <DiceRoller ref={diceRollerRef} onRollComplete={(results) => console.log("Roll results:", results)} />
    </div>
  );
}
