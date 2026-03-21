import { useState, useEffect, useRef } from 'react';
import { auth } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import Auth from './components/Auth';
import Chat from './components/Chat';
import CharacterPane from './components/CharacterPane';
import DiceRoller from './components/DiceRoller';
import GameStatusPane from './components/GameStatusPane';
import ResizableLayout from './components/ResizableLayout';
import LandingPage from './components/LandingPage';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeCharacter, setActiveCharacter] = useState(null);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const diceRollerRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="app-container" style={{ color: 'var(--text-secondary)' }}>
        Loading...
      </div>
    );
  }

  return (
    <>
      <div className="app-container">
        {!user ? (
          <Auth />
        ) : !selectedCampaign ? (
          <LandingPage 
            user={user} 
            onEnterCampaign={setSelectedCampaign} 
            onSignOut={() => signOut(auth)}
          />
        ) : (
          <div className="main-layout" style={{ width: '100%', height: '100%' }}>
            <ResizableLayout 
              leftPanel={
                <CharacterPane 
                  user={user} 
                  campaignId={selectedCampaign.id}
                  onSelectCharacter={setActiveCharacter} 
                />
              }
              centerPanel={
                <Chat 
                  user={user} 
                  campaignId={selectedCampaign.id}
                  rulesetId={selectedCampaign.rulesetId}
                  activeCharacter={activeCharacter}
                  onSignOut={() => signOut(auth)} 
                  onBackToLanding={() => setSelectedCampaign(null)}
                  diceRollerRef={diceRollerRef}
                />
              }
              rightPanel={<GameStatusPane />}
            />
          </div>
        )}
      </div>
      <DiceRoller ref={diceRollerRef} onRollComplete={(results) => console.log("Roll results:", results)} />
    </>
  );
}

export default App;
