import React, { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import templateData from '../data/character_template.json';
import ruleData from '../data/character_data.json';
import equipmentData from '../data/equipment_data.json';
import './RolemasterSheet.css';

const statLongNames = {
  'Ag': 'AGILITY',
  'Co': 'CONSTITUTION',
  'St': 'STRENGTH',
  'In': 'INTUITION',
  'Em': 'EMPATHY',
  'SD': 'SELF DISCIPLINE',
  'Me': 'MEMORY',
  'Re': 'REASONING',
  'Pr': 'PRESENCE',
  'Qu': 'QUICKNESS'
};

const statStateKeys = {
  'Ag': 'Agility',
  'Co': 'Constitution',
  'St': 'Strength',
  'In': 'Intuition',
  'Em': 'Empathy',
  'SD': 'Self Discipline',
  'Me': 'Memory',
  'Re': 'Reasoning',
  'Pr': 'Presence',
  'Qu': 'Quickness'
};

const getLongStatName = (abbr) => {
  if (!abbr || abbr === 'None') return abbr?.toUpperCase() || '';
  return abbr.split('/').map(s => statLongNames[s.trim()] || s.trim().toUpperCase()).join('/').toUpperCase();
};

export default function RolemasterSheet({ characterData, onUpdateCharacter }) {
  const [newSkillName, setNewSkillName] = useState('');
  const [isEquipmentModalOpen, setIsEquipmentModalOpen] = useState(null); // 'weapons' | 'armour' | null
  
  // Sanitize stats: only keep what's in the template
  const validKeys = Object.keys(templateData.stats);
  const sanitizedStats = {};
  let needsCleanup = false;
  
  if (characterData?.stats) {
    validKeys.forEach(k => {
      sanitizedStats[k] = { ...templateData.stats[k], ...(characterData.stats[k] || {}) };
    });
    // Check if Firebase sent us stale keys tracking from old versions
    Object.keys(characterData.stats).forEach(k => {
      if (!validKeys.includes(k)) needsCleanup = true;
    });
  } else {
    // Fill out the template defaults if totally fresh
    validKeys.forEach(k => { sanitizedStats[k] = { ...templateData.stats[k] }; });
  }

  // Effect to automatically write out the cleaned data to Firebase in the background
  useEffect(() => {
    if (needsCleanup && characterData) {
      onUpdateCharacter({ stats: sanitizedStats });
    }
  }, [needsCleanup, characterData?.id]);

  if (!characterData) return null;

  const stats = sanitizedStats;
  const skills = characterData.skills || {};
  const hp = { ...templateData.hp, ...(characterData.hp || {}) };
  const { level = 1, profession = 'Fighter', race = 'Human' } = characterData;

  const AVAILABLE_RACES = Object.keys(ruleData.races || {});
  const AVAILABLE_PROFESSIONS = Object.keys(ruleData.professions || {});

  const handleAddSkill = (e) => {
    e.preventDefault();
    if (!newSkillName.trim()) return;
    
    const updatedSkills = {
      ...skills,
      [newSkillName]: { ranks: 0, bonus: 0 }
    };
    
    onUpdateCharacter({ skills: updatedSkills });
    setNewSkillName('');
  };

  const handleUpdateHP = (val) => {
    onUpdateCharacter({ hp: { ...hp, current: val } });
  };

  const handleUpdateStat = (statName, field, newBase) => {
    const updatedStats = {
      ...stats,
      [statName]: {
        ...stats[statName],
        [field]: newBase
      }
    };
    onUpdateCharacter({ stats: updatedStats });
  };

  const handleAddEquipment = (type, item) => {
    const existingList = characterData[type] || [];
    onUpdateCharacter({ [type]: [...existingList, { ...item, in_use: false }] });
    setIsEquipmentModalOpen(null);
  };

  const removeEquipment = (type, indexToRemove) => {
    const existingList = characterData[type] || [];
    const updatedList = existingList.filter((_, idx) => idx !== indexToRemove);
    onUpdateCharacter({ [type]: updatedList });
  };

  const handleToggleInUse = (type, idx) => {
    const newList = [...characterData[type]];
    const togglingOn = !newList[idx].in_use;
    
    // Toggle the selected item
    newList[idx] = { ...newList[idx], in_use: togglingOn };
    
    if (togglingOn) {
      if (type === 'weapons') {
        // Enforce single-weapon usage
        for (let i = 0; i < newList.length; i++) {
          if (i !== idx) {
            newList[i].in_use = false;
          }
        }
      } else if (type === 'armour') {
        // Distinguish between shield and body armor mutually exclusive slots
        const isShield = !!newList[idx].bonus_versus_melee;
        
        for (let i = 0; i < newList.length; i++) {
          if (i !== idx && newList[i].in_use) {
            const checkingShield = !!newList[i].bonus_versus_melee;
            if (isShield === checkingShield) {
              newList[i].in_use = false; // Turn off the conflicting item type
            }
          }
        }
      }
    }
    
    newList.sort((a, b) => {
      const aUse = a.in_use ? 1 : 0;
      const bUse = b.in_use ? 1 : 0;
      return bUse - aUse;
    });
    
    onUpdateCharacter({ [type]: newList });
  };

  const calculateSkillBonus = (name, data) => {
    const { ranks = 0, bonus: specialBonus = 0 } = data || {};
    let rankBonus = -25;
    if (ranks > 0) {
      rankBonus = 0;
      for (let i = 1; i <= ranks; i++) {
        if (i <= 10) rankBonus += 5;
        else if (i <= 20) rankBonus += 2;
        else if (i <= 30) rankBonus += 1;
        else rankBonus += 0.5;
      }
    }
    
    const skillInfo = ruleData.primary_skills?.find(s => s.skill === name) || 
                     ruleData.secondary_skills?.find(s => s.skill === name);
                     
    let statBonus = 0;
    let statUsed = 'None';
    if (skillInfo?.stat && skillInfo.stat !== 'None') {
      const statsUsed = skillInfo.stat.split('/');
      statUsed = skillInfo.stat;
      let sum = 0;
      statsUsed.forEach(abbr => {
        const stateKey = statStateKeys[abbr.trim()];
        if (stateKey && stats[stateKey]) {
           sum += getStatBonusDetails(stateKey, stats[stateKey].base).total;
        }
      });
      statBonus = Math.floor(sum / statsUsed.length);
    }
    
    return {
      total: rankBonus + statBonus + specialBonus,
      rankBonus,
      statBonus,
      specialBonus,
      statUsed
    };
  };

  const calculateAT = () => {
    let highestAT = 1;
    let activeArmor = null;

    if (characterData.armour && characterData.armour.length > 0) {
      for (const item of characterData.armour) {
        if (item.in_use && item.AT && Number(item.AT) > highestAT) {
          highestAT = Number(item.AT);
          activeArmor = item;
        }
      }
    }

    // Fallback if the item doesn't have penalty data (old characters)
    let penaltyData = activeArmor;
    if (activeArmor && typeof activeArmor.min_maneuver === 'undefined') {
       // Search equipment list for matching item name
       for (const cat of Object.values(equipmentData.equipment_list.armor)) {
         const found = cat.find(i => i.name === activeArmor.name);
         if (found) {
           penaltyData = found;
           break;
         }
       }
    }

    const chart = penaltyData || { 
      min_maneuver: 0, max_maneuver: 0, missile_penalty: 0, quickness_penalty: 0, essence_esf: 0, channeling_esf: 0 
    };

    // Determine Skill Category for Maneuvering
    let skillCategory = 'None';
    if (highestAT >= 5 && highestAT <= 8) skillCategory = 'Soft Leather';
    else if (highestAT >= 9 && highestAT <= 12) skillCategory = 'Rigid Leather';
    else if (highestAT >= 13 && highestAT <= 16) skillCategory = 'Chain';
    else if (highestAT >= 17 && highestAT <= 20) skillCategory = 'Plate';

    const skillName = skillCategory !== 'None' ? `Maneuvering in Armor (${skillCategory})` : null;
    let skillBonus = 0;
    if (skillName && skills[skillName]) {
      skillBonus = calculateSkillBonus(skillName, skills[skillName]).total;
    }

    // Interpolate Maneuver Penalty
    // 0 skill bonus = max penalty, 100 skill bonus = min penalty
    const skillFactor = Math.min(Math.max(skillBonus, 0), 100) / 100;
    const maneuverPenalty = Math.round((chart.max_maneuver || 0) + (skillFactor * ((chart.min_maneuver || 0) - (chart.max_maneuver || 0))));

    return { 
      at: highestAT, 
      maneuverPenalty,
      quicknessPenalty: chart.quickness_penalty || 0,
      missilePenalty: chart.missile_penalty || 0,
      essenceESF: chart.essence_esf || 0,
      channelingESF: chart.channeling_esf || 0,
      skillName: skillName || 'No Armor Training'
    };
  };

  const armorData = calculateAT();

  const calculateWeaponOB = (weapon) => {
    let category = null;
    if (equipmentData.equipment_list?.weapons) {
       for (const [catName, items] of Object.entries(equipmentData.equipment_list.weapons)) {
         if (items.some(i => i.name === weapon.name)) {
           category = catName;
           break;
         }
       }
    }
    
    // 1. Skill Bonus (Expertise)
    const skillName = category || weapon.name;
    const skillData = skills[skillName] || { ranks: 0, bonus: 0 };
    const skillCalc = calculateSkillBonus(skillName, skillData);
    
    // 2. Level Bonus
    const cappedLevel = Math.min(level || 1, 20);
    let levelBonus = cappedLevel * 1; // standard non-arms
    if (profession === 'Fighter') {
      levelBonus = cappedLevel * 3;
    } else if (['Thief', 'Rogue', 'Warrior Monk', 'Monk', 'Ranger', 'Paladin', 'Bard'].includes(profession)) {
      levelBonus = cappedLevel * 2;
    }
    
    // 3. Weapon Quality (Special Bonus on the weapon item itself)
    const weaponSpecial = Number(weapon.special_bonus || 0);
    
    // 4. Missile Attack Penalty (from armor)
    let missilePenalty = 0;
    if (category === 'Missile Weapons') {
      missilePenalty = armorData.missilePenalty;
    }
    
    // Total OB = SkillTotal (Rank+Stat+SkillSpecial) + LevelBonus + WeaponQuality - MissilePenalty
    const total = skillCalc.total + levelBonus + weaponSpecial - missilePenalty;
    
    return {
      total,
      skill: skillCalc.rankBonus, 
      stat: skillCalc.statBonus,
      statName: skillCalc.statUsed,
      skillSpecial: skillCalc.specialBonus,
      level: levelBonus,
      special: weaponSpecial,
      missilePenalty
    };
  };

  const renderEquipmentOptions = () => {
    if (isEquipmentModalOpen === 'primary_skills' || isEquipmentModalOpen === 'secondary_skills') {
      const isPrimary = isEquipmentModalOpen === 'primary_skills';
      const rawSkills = isPrimary 
        ? (ruleData.primary_skills || [])
        : (ruleData.secondary_skills || []);

      // Group skills by category
      const categories = rawSkills.reduce((acc, sk) => {
        const cat = sk.category || (isPrimary ? 'Uncategorized' : 'Secondary');
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(sk);
        return acc;
      }, {});

      // Sort categories and skills within them
      const sortedCatNames = Object.keys(categories).sort();

      const renderSkillBtn = (sk, idx) => (
        <button 
          key={`${sk.skill}-${idx}`} 
          className="equipment-item-btn"
          onClick={() => {
             const existingSkills = characterData.skills || {};
                const newSkillItem = { ranks: 0, bonus: 0, stat: sk.stat };
                if (sk.category) newSkillItem.category = sk.category;
                
                onUpdateCharacter({ 
                  skills: { 
                    ...existingSkills, 
                    [sk.skill]: newSkillItem 
                  } 
                });
             setIsEquipmentModalOpen(null);
          }}
        >
          <span className="item-name">{sk.skill}</span>
          <span className="item-stats">
            {sk.stat ? getLongStatName(sk.stat) : (isPrimary ? 'PRIMARY SKILL' : 'SECONDARY SKILL')}
          </span>
        </button>
      );

      return (
        <div className="modal-body">
          {!isPrimary && (
            <div className="modal-category">
              <h4 className="modal-category-title">Custom Skill</h4>
              <div className="custom-equip-form" style={{ marginBottom: '8px', display: 'flex', gap: '8px' }}>
                <input 
                  type="text" 
                  placeholder="Enter skill name... (Press Enter)" 
                  value={newSkillName}
                  onChange={e => setNewSkillName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newSkillName.trim()) {
                      const existingSkills = characterData.skills || {};
                      if (!existingSkills[newSkillName.trim()]) {
                        onUpdateCharacter({ 
                           skills: { 
                            ...existingSkills, 
                            [newSkillName.trim()]: { ranks: 0, bonus: 0, stat: 'Custom' } 
                          } 
                        });
                      }
                      setNewSkillName('');
                      setIsEquipmentModalOpen(null);
                    }
                  }}
                  style={{ flex: 1, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', color: 'white', letterSpacing: '0.5px', borderRadius: '8px', outline: 'none' }}
                />
              </div>
            </div>
          )}

          {sortedCatNames.map(catName => (
            <div key={catName} className="modal-category">
              <h4 className="modal-category-title">{catName}</h4>
              <div className="modal-items-grid">
                {categories[catName]
                  .sort((a, b) => a.skill.localeCompare(b.skill))
                  .map((sk, idx) => renderSkillBtn(sk, idx))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    const list = equipmentData.equipment_list || {};
    
    if (isEquipmentModalOpen === 'weapons') {
      const weaponCategories = list.weapons || {};
      return Object.entries(weaponCategories).map(([category, items]) => (
        <div key={category} className="modal-category">
          <h4 className="modal-category-title">{category}</h4>
          <div className="modal-items-grid">
            {items.map(item => (
              <button key={item.name} className="equipment-item-btn" onClick={() => handleAddEquipment('weapons', item)}>
                <span className="item-name">{item.name}</span>
                <span className="item-stats">Fumble: {item.fumble_range} | {item.weight_lbs} lbs</span>
              </button>
            ))}
          </div>
        </div>
      ));
    } else if (isEquipmentModalOpen === 'armour') {
      const armorCategories = list.armor || {};
      const shields = list.shields || [];
      return (
        <>
          {Object.entries(armorCategories).map(([category, items]) => (
            <div key={category} className="modal-category">
              <h4 className="modal-category-title">{category}</h4>
              <div className="modal-items-grid">
                {items.map(item => (
                  <button key={item.name} className="equipment-item-btn" onClick={() => handleAddEquipment('armour', item)}>
                    <span className="item-name">{item.name}</span>
                    <span className="item-stats">AT: {item.AT}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {shields.length > 0 && (
            <div className="modal-category">
              <h4 className="modal-category-title">Shields</h4>
              <div className="modal-items-grid">
                {shields.map(item => (
                  <button key={item.name} className="equipment-item-btn" onClick={() => handleAddEquipment('armour', item)}>
                    <span className="item-name">{item.name}</span>
                    <span className="item-stats">Melee: +{item.bonus_versus_melee} | Missile: +{item.bonus_versus_missile}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      );
    }
    return null;
  };

  const getStatBonusDetails = (statName, baseValue) => {
    let baseBonus = 0;
    if (baseValue) {
      const bonusChart = ruleData.stat_bonuses || [];
      for (const b of bonusChart) {
        if (baseValue >= b.range[0] && baseValue <= b.range[1]) {
          baseBonus = b.bonus;
          break;
        }
      }
    }
    
    const abbr = ruleData.stat_descriptions?.[statName]?.abbreviation || statName.substring(0, 3).toUpperCase();
    const racialMods = ruleData.races?.[race]?.stat_modifiers || {};
    const racialBonus = racialMods[abbr] || 0;
    
    return {
      total: baseBonus + racialBonus,
      base: baseBonus,
      racial: racialBonus
    };
  };

  const calculateMaxHPDetails = () => {
    const tempCo = stats['Constitution']?.base || 0;
    const startBHPT = Math.ceil(tempCo / 10);
    
    const bodyDevRanks = skills['Body Development']?.ranks || 0;
    const hitDie = ruleData.races?.[race]?.base_hit_die || 10;
    const maxRoll = hitDie;
    const devHits = bodyDevRanks * maxRoll;
    
    const totalBHPT = startBHPT + devHits;
    
    const raceMax = ruleData.races?.[race]?.max_hits || (hitDie === 10 ? 120 : hitDie === 6 ? 60 : 100);
    const coBonus = getStatBonusDetails('Constitution', tempCo).total;
    const actualCap = raceMax + coBonus;
    
    const finalBHPT = Math.min(totalBHPT, actualCap);
    
    const totalHP = Math.floor(finalBHPT + (finalBHPT * (coBonus / 100)));
    
    return {
      startBHPT,
      devHits,
      totalBHPT,
      raceMax,
      actualCap,
      coBonus,
      finalBHPT,
      totalHP
    };
  };

  const hpDetails = calculateMaxHPDetails();
  const hpTooltip = `Starting Base (Co/10): ${hpDetails.startBHPT}\nBody Dev (${skills['Body Development']?.ranks || 0} ranks @ max ${ruleData.races?.[race]?.base_hit_die || 10}/rank): +${hpDetails.devHits}\nUncapped BHPT: ${hpDetails.totalBHPT}\nRacial Max + Co Bonus Cap: ${hpDetails.actualCap}\nFinal BHPT: ${hpDetails.finalBHPT}\nConstitution Bonus Multiplier: +${hpDetails.coBonus}%\nTotal HP Equation: ${hpDetails.finalBHPT} + (${hpDetails.finalBHPT} x ${hpDetails.coBonus / 100})`;

  const quDetails = getStatBonusDetails('Quickness', stats['Quickness']?.base);
  const rawQuBonus = quDetails.total;
  const effectiveQuBonus = Math.max(0, rawQuBonus - armorData.quicknessPenalty);
  
  let shieldBonus = 0;
  if (characterData.armour) {
    for (const item of characterData.armour) {
      if (item.in_use && item.bonus_versus_melee) {
        shieldBonus += Number(item.bonus_versus_melee);
      }
    }
  }

  const armorPenalty = 0;
  const otherBonus = 0;
  const totalDB = effectiveQuBonus + armorPenalty + shieldBonus + otherBonus;
  const dbTooltip = `Raw Quickness Bonus: ${rawQuBonus > 0 ? '+' : ''}${rawQuBonus}\nArmor Qu Penalty: -${armorData.quicknessPenalty}\nEffective Qu Bonus: ${effectiveQuBonus}\nShield Bonus: ${shieldBonus > 0 ? '+' : ''}${shieldBonus}\nOther: ${otherBonus > 0 ? '+' : ''}${otherBonus}\nTotal DB: ${totalDB > 0 ? '+' : ''}${totalDB}`;

  const isPrimarySkill = (name) => ruleData.primary_skills?.some(s => s.skill === name) ?? false;
  
  const equippedSkills = Object.entries(characterData.skills || {}).map(([name, data]) => ({ name, ...data }));
  equippedSkills.sort((a, b) => a.name.localeCompare(b.name));
  
  const primarySkillsList = equippedSkills.filter(s => isPrimarySkill(s.name));
  const secondarySkillsList = equippedSkills.filter(s => !isPrimarySkill(s.name));

  const renderSkillRow = (s) => {
    const calc = calculateSkillBonus(s.name, s);
    const tooltip = `Rank Bonus: ${calc.rankBonus}\nStat Bonus (${calc.statUsed}): ${calc.statBonus > 0 ? '+' : ''}${calc.statBonus}\nTotal: ${calc.total > 0 ? '+' : ''}${calc.total}`;
    
    return (
      <div key={s.name} className="equipped-item-row">
        <div className="equipped-item-info">
          <span className="equip-name">{s.name}</span>
          <span className="equip-detail" title={s.description}>
            {s.stat ? getLongStatName(s.stat) : (s.category || 'SPECIALTY')}
          </span>
        </div>
        
        <div className="equip-bonuses">
          <div className="equip-bonus-group">
            <span className="equip-bonus-label">Ranks</span>
            <input 
              type="number" 
              className="equip-bonus-input special-bonus-input" 
              value={s.ranks || 0}
              onChange={(e) => {
                 const newSkills = { ...characterData.skills };
                 newSkills[s.name].ranks = Number(e.target.value);
                 onUpdateCharacter({ skills: newSkills });
              }}
            />
          </div>
          <div className="equip-bonus-group">
            <span className="equip-bonus-label">Total</span>
            <div className="equip-bonus-derived ob-derived" title={tooltip}>
              {calc.total > 0 ? `+${calc.total}` : calc.total}
            </div>
          </div>
        </div>

        <button className="btn-icon-remove" onClick={() => {
          const newSkills = { ...characterData.skills };
          delete newSkills[s.name];
          onUpdateCharacter({ skills: newSkills });
        }} title="Remove">
          <X size={14} />
        </button>
      </div>
    );
  };

  return (
    <div className="rolemaster-sheet">
      <div className="sheet-header">
        <div className="header-top-row">
          <div className="name-and-meta">
            <input 
              className="char-name-input"
              value={characterData.name || ''}
              onChange={(e) => onUpdateCharacter({ name: e.target.value })}
              placeholder="Character Name"
            />
            <div className="char-meta">
              <select 
                value={race} 
                onChange={(e) => onUpdateCharacter({ race: e.target.value })}
                className="meta-select"
              >
                {AVAILABLE_RACES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select 
                value={profession} 
                onChange={(e) => onUpdateCharacter({ profession: e.target.value })}
                className="meta-select"
              >
                {AVAILABLE_PROFESSIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          
          <div className="level-block">
            <input 
              type="number" 
              className="level-input-big" 
              value={level} 
              onChange={(e) => onUpdateCharacter({ level: Number(e.target.value) })}
              min="1"
            />
            <span className="level-label-small">Level</span>
          </div>
        </div>
      </div>

      <div className="sheet-body">

      <div className="sheet-vitals">
        <div className="vital-column hp-col">
          <div className="vital-column-title">Hit Points</div>
          <div className="vital-box breakdown-box">
            <div className="vital-breakdown">
              <div className="vital-row"><span>Base</span><span>{hpDetails.startBHPT}</span></div>
              <div className="vital-row"><span>Body Dev</span><span>+{hpDetails.devHits}</span></div>
              <div className="vital-row"><span>Con Bonus</span><span>{hpDetails.coBonus > 0 ? `+${hpDetails.coBonus}%` : `${hpDetails.coBonus}%`}</span></div>
              <div className="vital-row"><span>Other</span><span>+0</span></div>
            </div>
            <div className="vital-total">
              <div className="hp-controls">
                <input 
                  type="number" 
                  value={hp.current ?? 0} 
                  onChange={(e) => handleUpdateHP(Number(e.target.value))}
                  className="hp-input"
                />
                <span className="hp-max" title={hpTooltip} style={{cursor: 'help'}}>/ {hpDetails.totalHP || 0}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="vital-column at-col">
          <div className="vital-column-title">Armour Type</div>
          <div className="vital-box breakdown-box">
            <div className="vital-breakdown">
              <div className="vital-row"><span>Armour <span className="at-label">AT</span></span><span>{armorData.at}</span></div>
              <div className="vital-row" title={`Skill used: ${armorData.skillName}`}><span>Move Penalty</span><span>{armorData.maneuverPenalty > 0 ? `+${armorData.maneuverPenalty}` : armorData.maneuverPenalty}</span></div>
              <div className="vital-row"><span>Range Penalty</span><span>{armorData.missilePenalty > 0 ? `-${armorData.missilePenalty}` : 0}</span></div>
            </div>
            <div className="vital-total">
              <span className="at-label">AT</span> {armorData.at}
            </div>
          </div>
        </div>

        <div className="vital-column db-col">
          <div className="vital-column-title">Defensive Bonus</div>
          <div className="vital-box breakdown-box">
            <div className="vital-breakdown">
              <div className="vital-row"><span>Quickness</span><span>{effectiveQuBonus > 0 ? `+${effectiveQuBonus}` : effectiveQuBonus}</span></div>
              <div className="vital-row" title="Shield Bonus only"><span>Shield</span><span>{shieldBonus > 0 ? `+${shieldBonus}` : shieldBonus}</span></div>
              <div className="vital-row"><span>Other</span><span>{otherBonus > 0 ? `+${otherBonus}` : otherBonus}</span></div>
            </div>
            <div className="vital-total" title={dbTooltip} style={{cursor: 'help'}}>
              {totalDB > 0 ? `+${totalDB}` : totalDB}
            </div>
          </div>
        </div>
      </div>

      <div className="sheet-section">
        <h3>Stats</h3>
        <div className="stats-grid">
          {Object.entries(stats).map(([statName, statData]) => {
            const abbr = ruleData.stat_descriptions?.[statName]?.abbreviation || statName.substring(0, 3).toUpperCase();
            const desc = ruleData.stat_descriptions?.[statName]?.description || '';
            const tooltipStr = desc ? `${statName}: ${desc}` : statName;
            
            const bonusDetails = getStatBonusDetails(statName, statData.base);
            const totalBonus = bonusDetails.total;
            const displayBonus = totalBonus > 0 ? `+${totalBonus}` : `${totalBonus}`;
            
            const bonusTooltip = `Base Stat Bonus: ${bonusDetails.base > 0 ? '+' : ''}${bonusDetails.base}\nRacial Modifier: ${bonusDetails.racial > 0 ? '+' : ''}${bonusDetails.racial}\nTotal: ${displayBonus}`;
            
            return (
              <div key={statName} className="stat-box" title={tooltipStr}>
                <span className="stat-name">{abbr}</span>
                <div className="stat-values-row">
                  <input 
                    type="number" 
                    value={statData.base || 0}
                    onChange={(e) => handleUpdateStat(statName, 'base', Number(e.target.value))}
                    className="stat-input"
                  />
                  <input 
                    type="number" 
                    value={statData.potential || 0}
                    onChange={(e) => handleUpdateStat(statName, 'potential', Number(e.target.value))}
                    className="stat-input stat-potential"
                    title="Potential"
                  />
                </div>
                <div className="stat-bonus" title={bonusTooltip}>{displayBonus}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="sheet-section">
        <div className="section-header-row">
          <h3>Weapons</h3>
          <button className="btn-icon-small" title="Add Weapon" onClick={() => setIsEquipmentModalOpen('weapons')}>
            <Plus size={18} />
          </button>
        </div>
        <div className="weapons-list" style={{ marginBottom: '24px' }}>
          {(!characterData.weapons || characterData.weapons.length === 0) ? (
            <div className="empty-msg" style={{ fontSize: '0.85rem' }}>No weapons equipped.</div>
          ) : (
            characterData.weapons.map((w, idx) => {
              const obDetails = calculateWeaponOB(w);
              const obTooltip = `Skill Ranks Bonus: +${obDetails.skill}\nStat Bonus (${obDetails.statName}): ${obDetails.stat > 0 ? '+' : ''}${obDetails.stat}\nProfession Level Bonus (${profession} Lvl ${Math.min(level || 1, 20)}): +${obDetails.level}\nWeapon Quality (Special): +${obDetails.special}\nTotal OB: ${obDetails.total > 0 ? '+' : ''}${obDetails.total}`;
              
              return (
                <div key={idx} className="equipped-item-row">
                  <div className="equipped-item-info">
                    <div className="equip-name-row">
                      <span className="equip-name">{w.name}</span>
                      <button 
                        className={`equip-toggle-btn ${w.in_use ? 'in-use' : 'equip-only'}`}
                        onClick={() => handleToggleInUse('weapons', idx)}
                      >
                        {w.in_use ? 'IN USE' : 'EQUIP'}
                      </button>
                    </div>
                    <span className="equip-detail">Fumble: {w.fumble_range}</span>
                  </div>
                  
                  <div className="equip-bonuses">
                    <div className="equip-bonus-group">
                      <span className="equip-bonus-label">Special</span>
                      <input 
                        type="number" 
                        className="equip-bonus-input special-bonus-input" 
                        value={w.special_bonus || 0}
                        onChange={(e) => {
                           const newWeapons = [...characterData.weapons];
                           newWeapons[idx].special_bonus = Number(e.target.value);
                           onUpdateCharacter({ weapons: newWeapons });
                        }}
                        title="Special Bonus (Magic, Quality, etc)"
                      />
                    </div>
                    <div className="equip-bonus-group">
                      <span className="equip-bonus-label">OB</span>
                      <div className="equip-bonus-derived ob-derived" title={obTooltip}>
                        {obDetails.total > 0 ? `+${obDetails.total}` : obDetails.total}
                      </div>
                    </div>
                  </div>

                  <button className="btn-icon-remove" onClick={() => removeEquipment('weapons', idx)} title="Unequip">
                    <X size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="section-header-row">
          <h3>Armour</h3>
          <button className="btn-icon-small" title="Add Armour" onClick={() => setIsEquipmentModalOpen('armour')}>
            <Plus size={18} />
          </button>
        </div>
        <div className="armour-list">
          {(!characterData.armour || characterData.armour.length === 0) ? (
            <div className="empty-msg" style={{ fontSize: '0.85rem' }}>No armour equipped.</div>
          ) : (
            characterData.armour.map((a, idx) => (
              <div key={idx} className="equipped-item-row">
                <div className="equipped-item-info">
                  <div className="equip-name-row">
                    <span className="equip-name">{a.name}</span>
                    <button 
                      className={`equip-toggle-btn ${a.in_use ? 'in-use' : 'equip-only'}`}
                      onClick={() => handleToggleInUse('armour', idx)}
                    >
                      {a.in_use ? 'IN USE' : 'EQUIP'}
                    </button>
                  </div>
                  {a.AT ? (
                    <span className="equip-detail">AT: {a.AT}</span>
                  ) : (
                    <span className="equip-detail">Shield</span>
                  )}
                </div>
                  <button className="btn-icon-remove" onClick={() => removeEquipment('armour', idx)} title="Unequip">
                    <X size={14} />
                  </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="sheet-section">
        <div className="section-header-row">
          <h3>Primary Skills</h3>
          <button className="btn-icon-small" title="Add Skill" onClick={() => setIsEquipmentModalOpen('primary_skills')}>
            <Plus size={18} />
          </button>
        </div>

        <div className="skills-list">
          {primarySkillsList.length === 0 ? (
            <div className="empty-msg" style={{ fontSize: '0.85rem' }}>No primary skills tracked.</div>
          ) : (
            primarySkillsList.map(s => renderSkillRow(s))
          )}
        </div>

        <div className="section-header-row">
          <h3>Secondary Skills</h3>
          <button className="btn-icon-small" title="Add Skill" onClick={() => setIsEquipmentModalOpen('secondary_skills')}>
            <Plus size={18} />
          </button>
        </div>

        <div className="skills-list">
          {secondarySkillsList.length === 0 ? (
            <div className="empty-msg" style={{ fontSize: '0.85rem' }}>No secondary skills tracked.</div>
          ) : (
            secondarySkillsList.map(s => renderSkillRow(s))
          )}
        </div>
      </div>

      </div>

      {/* Equipment Modal */}
      {isEquipmentModalOpen && (
        <div className="equipment-modal-overlay" onClick={() => setIsEquipmentModalOpen(null)}>
          <div className="equipment-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {isEquipmentModalOpen === 'weapons' ? 'Select Weapon' : 
                 isEquipmentModalOpen === 'armour' ? 'Select Armour' : 
                 isEquipmentModalOpen === 'primary_skills' ? 'Add Primary Skill' : 
                 'Add Secondary Skill'}
              </h3>
              <button className="btn-icon-close" onClick={() => setIsEquipmentModalOpen(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {renderEquipmentOptions()}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
