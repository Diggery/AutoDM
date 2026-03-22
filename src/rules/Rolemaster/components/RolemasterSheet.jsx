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

import { rolemasterSystem } from '../index';

const getLongStatName = (abbr) => {
  if (!abbr || abbr === 'None') return abbr?.toUpperCase() || '';
  return abbr.split('/').map(s => statLongNames[s.trim()] || s.trim().toUpperCase()).join('/').toUpperCase();
};

export default function RolemasterSheet({ characterData, onUpdateCharacter }) {
  const [newSkillName, setNewSkillName] = useState('');
  const [isEquipmentModalOpen, setIsEquipmentModalOpen] = useState(null); // 'weapons' | 'armour' | null

  // Use the centralized rules engine as the source of truth for all calculations
  const report = rolemasterSystem.getCharacterReport(characterData);

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

  if (!characterData || !report) return null;

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

  const hpDetails = report.hp;
  const hpTooltip = report.hp.tooltip;

  const armorData = report.armor;

  const dbDetails = report.db;
  const effectiveQuBonus = report.db.effectiveQu;
  const shieldBonus = report.db.shield;
  const otherBonus = report.db.other;
  const totalDB = report.db.total;
  const dbTooltip = report.db.tooltip;

  const isPrimarySkill = (name) => ruleData.primary_skills?.some(s => s.skill === name) ?? false;

  const equippedSkills = Object.entries(characterData.skills || {}).map(([name, data]) => ({ name, ...data }));
  equippedSkills.sort((a, b) => a.name.localeCompare(b.name));

  const primarySkillsList = equippedSkills.filter(s => isPrimarySkill(s.name));
  const secondarySkillsList = equippedSkills.filter(s => !isPrimarySkill(s.name));

  const renderSkillRow = (s) => {
    const calc = report.skills[s.name] || { total: 0, rankBonus: 0, statBonus: 0, specialBonus: 0, tooltip: '' };
    const tooltip = calc.tooltip;

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
                  <span className="hp-max" title={hpTooltip} style={{ cursor: 'help' }}>/ {hpDetails.totalHP || 0}</span>
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
              <div className="vital-total" title={dbTooltip} style={{ cursor: 'help' }}>
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

              const bonusDetails = report.stats[statName];
              const totalBonus = bonusDetails.total;
              const displayBonus = totalBonus > 0 ? `+${totalBonus}` : `${totalBonus}`;
              const bonusTooltip = bonusDetails.tooltip;

              return (
                <div key={statName} className="stat-box" title={tooltipStr}>
                  <span className="stat-name">{abbr}</span>
                  <div className="stat-values-row">
                    <input
                      key={`${statName}-base-${statData.base}`}
                      type="number"
                      defaultValue={statData.base || 0}
                      onBlur={(e) => {
                        if (Number(e.target.value) !== (statData.base || 0)) {
                          handleUpdateStat(statName, 'base', Number(e.target.value))
                        }
                      }}
                      className="stat-input"
                    />
                    <input
                      key={`${statName}-pot-${statData.potential}`}
                      type="number"
                      defaultValue={statData.potential || 0}
                      onBlur={(e) => {
                        if (Number(e.target.value) !== (statData.potential || 0)) {
                          handleUpdateStat(statName, 'potential', Number(e.target.value))
                        }
                      }}
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
            {(!report.weapons || report.weapons.length === 0) ? (
              <div className="empty-msg" style={{ fontSize: '0.85rem' }}>No weapons equipped.</div>
            ) : (
              report.weapons.map((w, idx) => {
                const obDetails = w.calculated;
                const obTooltip = obDetails.tooltip;

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
                          {obDetails.ob > 0 ? `+${obDetails.ob}` : obDetails.ob}
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

        <div className="sheet-section">
          <div className="section-header-row">
            <h3>Wealth</h3>
          </div>
          <div className="stats-grid wealth-grid" style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <div className="stat-box" style={{ width: '120px' }}>
              <span className="stat-name">GOLD</span>
              <input
                key={`gold-${characterData.gold}`}
                type="number"
                defaultValue={characterData.gold || 0}
                onBlur={(e) => {
                  if (Number(e.target.value) !== (characterData.gold || 0)) {
                    onUpdateCharacter({ gold: Number(e.target.value) })
                  }
                }}
                className="stat-input"
                style={{ width: '100%', textAlign: 'center' }}
              />
            </div>
            <div className="stat-box" style={{ width: '120px' }}>
              <span className="stat-name">GEMS</span>
              <input
                key={`gems-${characterData.gems}`}
                type="number"
                defaultValue={characterData.gems || 0}
                onBlur={(e) => {
                  if (Number(e.target.value) !== (characterData.gems || 0)) {
                    onUpdateCharacter({ gems: Number(e.target.value) })
                  }
                }}
                className="stat-input"
                style={{ width: '100%', textAlign: 'center' }}
              />
            </div>
            <div className="stat-box" style={{ width: '120px' }}>
              <span className="stat-name">JEWELRY</span>
              <input
                key={`jewelry-${characterData.jewelry}`}
                type="number"
                defaultValue={characterData.jewelry || 0}
                onBlur={(e) => {
                  if (Number(e.target.value) !== (characterData.jewelry || 0)) {
                    onUpdateCharacter({ jewelry: Number(e.target.value) })
                  }
                }}
                className="stat-input"
                style={{ width: '100%', textAlign: 'center' }}
              />
            </div>
          </div>

          <div className="section-header-row">
            <h3>Items</h3>
            <button className="btn-icon-small" title="Add Item" onClick={() => {
              const newItems = [...(characterData.items || []), { name: 'New Item', description: '', value: 0 }];
              onUpdateCharacter({ items: newItems });
            }}>
              <Plus size={18} />
            </button>
          </div>

          <div className="items-list">
            {(!characterData.items || characterData.items.length === 0) ? (
              <div className="empty-msg" style={{ fontSize: '0.85rem' }}>No items in inventory.</div>
            ) : (
              characterData.items.map((item, idx) => (
                <div key={idx} className="equipped-item-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
                  <div className="equipped-item-info" style={{ flex: 1, minWidth: '150px' }}>
                    <input
                      key={`item-name-${idx}-${item.name}`}
                      className="char-name-input"
                      style={{ fontSize: '1rem', padding: '4px 8px', width: '100%', marginBottom: '4px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'white' }}
                      defaultValue={item.name}
                      onBlur={(e) => {
                        if (e.target.value !== item.name) {
                          const newItems = [...characterData.items];
                          newItems[idx].name = e.target.value;
                          onUpdateCharacter({ items: newItems });
                        }
                      }}
                      placeholder="Item Name"
                    />
                    <input
                      key={`item-desc-${idx}-${item.description}`}
                      className="equip-detail"
                      style={{ background: 'transparent', border: 'none', color: '#9ca3af', width: '100%', outline: 'none', padding: '0 8px', fontSize: '0.85rem' }}
                      defaultValue={item.description}
                      onBlur={(e) => {
                        if (e.target.value !== item.description) {
                          const newItems = [...characterData.items];
                          newItems[idx].description = e.target.value;
                          onUpdateCharacter({ items: newItems });
                        }
                      }}
                      placeholder="Description..."
                    />
                  </div>

                  <div className="equip-bonuses">
                    <div className="equip-bonus-group">
                      <span className="equip-bonus-label">Value</span>
                      <input
                        key={`item-val-${idx}-${item.value}`}
                        type="number"
                        className="equip-bonus-input special-bonus-input"
                        style={{ minWidth: '40px' }}
                        defaultValue={item.value || 0}
                        onBlur={(e) => {
                          const val = Number(e.target.value);
                          if (val !== item.value) {
                            const newItems = [...characterData.items];
                            newItems[idx].value = val;
                            onUpdateCharacter({ items: newItems });
                          }
                        }}
                        title="Value"
                      />
                    </div>
                  </div>

                  <button className="btn-icon-remove" onClick={() => {
                    const newItems = characterData.items.filter((_, i) => i !== idx);
                    onUpdateCharacter({ items: newItems });
                  }} title="Discard Item">
                    <X size={14} />
                  </button>
                </div>
              ))
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
