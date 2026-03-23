import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import GameStatusPane from './GameStatusPane';
import EncounterPane from './EncounterPane';

export default function RightPanelSwitcher({ campaignId }) {
  const [encounterState, setEncounterState] = useState(null);

  useEffect(() => {
    if (!campaignId) return;
    
    const unsub = onSnapshot(doc(db, 'campaigns', campaignId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setEncounterState(data.encounterState || null);
      }
    });

    return () => unsub();
  }, [campaignId]);

  if (encounterState && encounterState.isActive) {
    return <EncounterPane encounterState={encounterState} campaignId={campaignId} />;
  }

  return <GameStatusPane />;
}
