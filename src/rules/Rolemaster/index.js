import { GameSystemInterface } from '../RulesInterface';
import attacksData from './data/attacks.json';
import templateData from './data/character_template.json';
import npcData from './data/npc_data.json';
import ruleData from './data/character_data.json';
import equipmentData from './data/equipment_data.json';
import slashingData from './data/OneHandedSlashing.json';
import RolemasterSheet from './components/RolemasterSheet';

/**
 * Simplified Rolemaster Test Implementation.
 */
export class RolemasterRules extends GameSystemInterface {

  // Simplified getCharacterStats
  getCharacterStats(rawData) {
    return {
      name: rawData.name || "Unknown",
      level: rawData.level || 1,
      quickness: rawData.quickness || 50,
      weaponSkill: rawData.weaponSkill || 30,
      armorType: rawData.armorType || "Leather",
      hp: rawData.hp || 50
    };
  }

  // Returns a random initiative value (0 to 1)
  rollInitiative(character) {
    return Math.random();
  }

  // Returns supported weapon lookup tables for the Orchestrator
  getAvailableWeapons() {
    return Object.keys(attacksData || {});
  }

  // Returns a default blank character sheet for Rolemaster
  getCharacterTemplate(name) {
    // Deep clone the JSON template so we don't accidentally mutate the import
    const freshTemplate = JSON.parse(JSON.stringify(templateData));
    freshTemplate.name = name || 'Unknown Adventurer';
    return freshTemplate;
  }

  // Stat bonus lookup with racial mods
  getStatBonus(statName, baseValue, character) {
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

    // Map long name to abbr if needed
    const reverseStatMap = {
      'Agility': 'Ag', 'Constitution': 'Co', 'Strength': 'St', 'Intuition': 'In',
      'Empathy': 'Em', 'Self Discipline': 'SD', 'Memory': 'Me', 'Reasoning': 'Re',
      'Presence': 'Pr', 'Quickness': 'Qu'
    };
    const abbr = reverseStatMap[statName] || statName.substring(0, 2);

    const racialKey = Object.keys(ruleData.races || {}).find(r => r.toLowerCase() === (character.race || '').toLowerCase());
    const racialMods = ruleData.races?.[racialKey]?.stat_modifiers || {};
    const racialBonus = racialMods[abbr] || 0;

    const total = baseBonus + racialBonus;
    return {
      total,
      base: baseBonus,
      racial: racialBonus,
      tooltip: `Base Stat Bonus: ${baseBonus > 0 ? '+' : ''}${baseBonus}\nRacial Modifier: ${racialBonus > 0 ? '+' : ''}${racialBonus}\nTotal: ${total > 0 ? '+' : ''}${total}`
    };
  }

  calculateMaxHP(character) {
    const race = character.race || 'Common Man';
    const stats = character.stats || {};
    const skills = character.skills || {};
    const tempCo = (stats['Constitution'] || stats['Co'])?.base || 0;
    const startBHPT = Math.ceil(tempCo / 10);

    // Body Development skill
    const bodyDevKey = Object.keys(skills).find(k => k.toLowerCase().includes('body development')) || 'Body Development';
    const bodyDevRanks = skills[bodyDevKey]?.ranks || 0;

    const racialKey = Object.keys(ruleData.races || {}).find(r => r.toLowerCase() === race.toLowerCase());
    const hitDie = ruleData.races?.[racialKey]?.base_hit_die || 10;
    const devHits = bodyDevRanks * hitDie; // Simple max roll assumption

    const totalBHPT = startBHPT + devHits;

    const raceMax = ruleData.races?.[racialKey]?.max_hits || (hitDie === 10 ? 120 : hitDie === 6 ? 60 : 100);
    const coBonus = this.getStatBonus('Constitution', tempCo, character).total;
    const actualCap = raceMax + coBonus;

    const finalBHPT = Math.min(totalBHPT, actualCap);
    const totalHP = Math.floor(finalBHPT + (finalBHPT * (coBonus / 100)));

    const tooltip = `Starting Base (Co/10): ${startBHPT}\nBody Dev (${bodyDevRanks} ranks @ max ${hitDie}/rank): +${devHits}\nUncapped BHPT: ${totalBHPT}\nRacial Max + Co Bonus Cap: ${actualCap}\nFinal BHPT: ${finalBHPT}\nConstitution Bonus Multiplier: +${coBonus}%\nTotal HP Equation: ${finalBHPT} + (${finalBHPT} x ${coBonus / 100})`;

    return {
      total: totalHP,
      breakdown: {
        base: startBHPT,
        dev: devHits,
        coBonus,
        cap: actualCap,
        finalBHPT
      },
      tooltip
    };
  }

  calculateAT(character) {
    let highestAT = 1;
    let activeArmor = null;

    if (character.armour && character.armour.length > 0) {
      for (const item of character.armour) {
        if (item.in_use && item.AT && Number(item.AT) > highestAT) {
          highestAT = Number(item.AT);
          activeArmor = item;
        }
      }
    }

    // Fallback if the item doesn't have penalty data (old characters)
    let penaltyData = activeArmor;
    if (activeArmor && typeof activeArmor.min_maneuver === 'undefined') {
      for (const cat of Object.values(equipmentData.equipment_list.armor || {})) {
        const found = cat.find(i => i.name === activeArmor.name);
        if (found) { penaltyData = found; break; }
      }
    }

    const chart = penaltyData || {
      min_maneuver: 0, max_maneuver: 0, missile_penalty: 0, quickness_penalty: 0, essence_esf: 0, channeling_esf: 0
    };

    let skillCategory = 'None';
    if (highestAT >= 5 && highestAT <= 8) skillCategory = 'Soft Leather';
    else if (highestAT >= 9 && highestAT <= 12) skillCategory = 'Rigid Leather';
    else if (highestAT >= 13 && highestAT <= 16) skillCategory = 'Chain';
    else if (highestAT >= 17 && highestAT <= 20) skillCategory = 'Plate';

    const skillName = skillCategory !== 'None' ? `Maneuvering in Armor (${skillCategory})` : null;
    let skillBonus = 0;
    if (skillName) {
      const skills = character.skills || {};
      const actualKey = Object.keys(skills).find(k => k.toLowerCase().trim() === skillName.toLowerCase().trim());
      const sData = actualKey ? skills[actualKey] : null;
      skillBonus = this.calculateSkillBonus(skillName, sData, character).total;
    }

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
  }

  calculateDB(character, armorData) {
    const stats = character.stats || {};
    const quBase = (stats['Quickness'] || stats['Qu'])?.base || 0;
    const quDetails = this.getStatBonus('Quickness', quBase, character);
    const rawQuBonus = quDetails.total;
    const effectiveQuBonus = Math.max(0, rawQuBonus - (armorData.quicknessPenalty || 0));

    let shieldBonus = 0;
    if (character.armour) {
      for (const item of character.armour) {
        if (item.in_use && item.bonus_versus_melee) {
          shieldBonus += Number(item.bonus_versus_melee);
        }
      }
    }

    const otherBonus = 0;
    const totalDB = effectiveQuBonus + shieldBonus + otherBonus;
    const tooltip = `Raw Quickness Bonus: ${rawQuBonus > 0 ? '+' : ''}${rawQuBonus}\nArmor Qu Penalty: -${armorData.quicknessPenalty || 0}\nEffective Qu Bonus: ${effectiveQuBonus}\nShield Bonus: ${shieldBonus > 0 ? '+' : ''}${shieldBonus}\nOther: ${otherBonus > 0 ? '+' : ''}${otherBonus}\nTotal DB: ${totalDB > 0 ? '+' : ''}${totalDB}`;

    return {
      total: totalDB,
      effectiveQu: effectiveQuBonus,
      shield: shieldBonus,
      other: otherBonus,
      tooltip
    };
  }

  // Master method to get a full character state report for UI or AI
  getCharacterReport(character) {
    if (!character) return null;

    const armor = this.calculateAT(character);
    const hp = this.calculateMaxHP(character);
    const db = this.calculateDB(character, armor);

    // Calculate all stats
    const stats = {};
    const statNames = ['Agility', 'Constitution', 'Strength', 'Intuition', 'Empathy', 'Self Discipline', 'Memory', 'Reasoning', 'Presence', 'Quickness'];
    statNames.forEach(s => {
      const base = (character.stats?.[s] || character.stats?.[s.substring(0, 2)])?.base || 0;
      stats[s] = this.getStatBonus(s, base, character);
    });

    // Calculate all skills
    const skills = {};
    Object.entries(character.skills || {}).forEach(([name, data]) => {
      const calc = this.calculateSkillBonus(name, data, character);
      // Construct tooltip for skill
      calc.tooltip = `Rank Bonus: ${calc.rankBonus}\nStat Bonus (${calc.statUsed}): ${calc.statBonus > 0 ? '+' : ''}${calc.statBonus}\nTotal: ${calc.total > 0 ? '+' : ''}${calc.total}`;
      skills[name] = calc;
    });

    // Calculate all weapons
    const weapons = (character.weapons || []).map(w => {
      const obDetails = this.calculateWeaponOB(w.name, character);
      const bd = obDetails.breakdown;
      const tooltip = `Skill Ranks Bonus: ${bd.skill > 0 ? '+' : ''}${bd.skill}\nStat Bonus: ${bd.stat > 0 ? '+' : ''}${bd.stat}\nProfession Level Bonus: +${bd.level}\nWeapon Quality (Special): +${bd.quality}\nTotal OB: ${obDetails.total > 0 ? '+' : ''}${obDetails.total}`;

      return {
        ...w,
        calculated: {
          ob: obDetails.total,
          tooltip
        }
      };
    });

    return {
      hp,
      armor,
      db,
      stats,
      skills,
      weapons
    };
  }

  // Helper to calculate skill bonus (logic from RolemasterSheet.jsx)
  calculateSkillBonus(name, data, character) {
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

    // Find skill info in static data (case-insensitive)
    const skillInfo = ruleData.primary_skills?.find(s => s.skill.toLowerCase() === name.toLowerCase()) ||
      ruleData.secondary_skills?.find(s => s.skill.toLowerCase() === name.toLowerCase());

    let statBonus = 0;
    let statUsed = 'None';
    if (skillInfo?.stat && skillInfo.stat !== 'None' && character.stats) {
      const statsUsed = skillInfo.stat.split('/');
      statUsed = skillInfo.stat;
      let sum = 0;
      statsUsed.forEach(abbr => {
        const statMap = {
          'Ag': 'Agility', 'Co': 'Constitution', 'St': 'Strength', 'In': 'Intuition',
          'Em': 'Empathy', 'SD': 'Self Discipline', 'Me': 'Memory', 'Re': 'Reasoning',
          'Pr': 'Presence', 'Qu': 'Quickness'
        };
        const stateKey = statMap[abbr.trim()];
        // Try exact match then case-insensitive match for stat keys
        let statData = character.stats[stateKey];
        if (!statData) {
          const actualKey = Object.keys(character.stats).find(k => k.toLowerCase() === stateKey.toLowerCase());
          if (actualKey) statData = character.stats[actualKey];
        }

        if (statData) {
          const val = typeof statData === 'object' ? (statData.base || 0) : statData;
          // Simple bonus lookup
          const bonusChart = ruleData.stat_bonuses || [];
          let baseBonus = 0;
          for (const b of bonusChart) {
            if (val >= b.range[0] && val <= b.range[1]) {
              baseBonus = b.bonus;
              break;
            }
          }
          // Racial mod
          const racialKey = Object.keys(ruleData.races || {}).find(r => r.toLowerCase() === (character.race || '').toLowerCase());
          const racialMods = ruleData.races?.[racialKey]?.stat_modifiers || {};
          const racialBonus = racialMods[abbr.trim()] || 0;
          sum += (baseBonus + racialBonus);
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
  }

  // Robust OB Calculation (logic from RolemasterSheet.jsx)
  calculateWeaponOB(weaponName, character) {
    console.log(`[RolemasterRules] Calculating OB for: "${weaponName}"`);

    const charWeapons = character.weapons || [];
    let weapon = null;

    // 1. Try exact match
    weapon = charWeapons.find(w => w.name.toLowerCase().trim() === (weaponName || '').toLowerCase().trim());

    // 2. Try fuzzy match (contains)
    if (!weapon && weaponName) {
      weapon = charWeapons.find(w => w.name.toLowerCase().includes(weaponName.toLowerCase()) || weaponName.toLowerCase().includes(w.name.toLowerCase()));
    }

    // 3. Fallback to currently equipped (in_use) weapon if name is generic or missing
    if (!weapon || weaponName === 'Bare Hands') {
      const equipped = charWeapons.find(w => w.in_use);
      if (equipped) {
        weapon = equipped;
        console.log(`[RolemasterRules]   Falling back to equipped weapon: "${weapon.name}"`);
      }
    }

    // 4. Final fallback to "Bare Hands" mock entry
    if (!weapon) {
      weapon = { name: weaponName || 'Bare Hands' };
      console.log(`[RolemasterRules]   No weapon found, using: "${weapon.name}"`);
    }

    let category = null;
    if (equipmentData.equipment_list?.weapons) {
      for (const [catName, items] of Object.entries(equipmentData.equipment_list.weapons)) {
        if (items.some(i => i.name.toLowerCase().trim() === weapon.name.toLowerCase().trim())) {
          category = catName;
          break;
        }
      }
    }

    // 1. Skill Bonus
    const skillName = category || weapon.name;
    const skills = character.skills || {};
    // Try different ways to find skill data (object key match, or array find)
    let skillData = skills[skillName];
    if (!skillData) {
      const actualKey = Object.keys(skills).find(k => k.toLowerCase().trim() === skillName.toLowerCase().trim());
      if (actualKey) {
        skillData = skills[actualKey];
      } else if (Array.isArray(skills)) {
        skillData = skills.find(s => (s.name || s.skill || '').toLowerCase().trim() === skillName.toLowerCase().trim());
      }
    }

    const skillCalc = this.calculateSkillBonus(skillName, skillData, character);

    // 2. Level Bonus
    const cappedLevel = Math.min(character.level || 1, 20);
    const profString = (character.profession || 'Fighter').toString().toLowerCase();
    let levelBonus = cappedLevel * 1;
    if (profString.includes('fighter')) levelBonus = cappedLevel * 3;
    else if (['thief', 'rogue', 'warrior monk', 'monk', 'ranger', 'paladin', 'bard'].some(p => profString.includes(p))) {
      levelBonus = cappedLevel * 2;
    }

    // 3. Weapon Quality
    const weaponSpecial = Number(weapon.special_bonus || 0);

    // 4. Missile Penalty
    let missilePenalty = 0;
    if (category === 'Missile Weapons') {
      const armor = this.calculateAT(character);
      missilePenalty = armor.missilePenalty || 0;
    }

    const total = skillCalc.total + levelBonus + weaponSpecial - missilePenalty;
    console.log(`[RolemasterRules]   Result: ${total} (Skill: ${skillCalc.total}, Lvl: ${levelBonus}, Quality: ${weaponSpecial}, Missile: -${missilePenalty})`);

    return {
      total,
      breakdown: {
        skill: skillCalc.rankBonus,
        stat: skillCalc.statBonus,
        level: levelBonus,
        quality: weaponSpecial
      }
    };
  }

  // Open-ended roll helper (Rolemaster 1-5, 96-100)
  async rollOpenEnded(diceRoller, label = "Open-Ended Roll") {
    let total = 0;
    let roll = diceRoller ? await diceRoller('1d100', label) : (Math.floor(Math.random() * 100) + 1);
    
    if (roll >= 96) {
      total = roll;
      while (roll >= 96) {
        roll = diceRoller ? await diceRoller('1d100', `${label} (Exploding)`) : (Math.floor(Math.random() * 100) + 1);
        total += roll;
      }
    } else if (roll <= 5) {
      total = roll;
      roll = diceRoller ? await diceRoller('1d100', `${label} (Exploding Low)`) : (Math.floor(Math.random() * 100) + 1);
      total -= roll;
    } else {
      total = roll;
    }
    return total;
  }

  // Lookup result in attack tables
  lookupAttackResult(tableName, roll, at) {
    const table = slashingData[tableName];
    if (!table) return "0";

    const cappedRoll = Math.min(150, Math.max(0, roll));
    
    // Find the row. Tables often have ranges or specific numbers.
    // We'll look for the closest roll that is <= cappedRoll
    const row = table.rows.find(r => {
       if (r.roll.includes('-')) {
         const [min, max] = r.roll.split('-').map(Number);
         return cappedRoll >= min && cappedRoll <= max;
       }
       return Number(r.roll) === cappedRoll;
    }) || table.rows.reverse().find(r => Number(r.roll.split('-')[0]) <= cappedRoll);

    if (!row) return "0";

    // Columns are AT20 to AT1 (Index 0 to 19)
    const colIndex = 20 - at;
    return row.results[colIndex] || "0";
  }

  // Parse Rolemaster result string (e.g. "8EK" -> { damage: 8, severity: 'E', type: 'K' })
  parseResultString(res) {
    if (!res || res === "0") return { damage: 0 };
    
    const match = res.match(/^(\d+)([A-E])([KSP])$/);
    if (match) {
      return {
        damage: parseInt(match[1]),
        severity: match[2],
        type: match[3]
      };
    }
    
    // Sometimes it's just damage
    const damageOnly = res.match(/^(\d+)$/);
    if (damageOnly) {
      return { damage: parseInt(damageOnly[1]) };
    }

    return { damage: 0 };
  }

  // Simplified resolveAction with Critical Strike support
  async resolveAction(intent, character, targetEntity, gameState, diceRoller) {
    const actionType = (intent.action || '').toLowerCase().trim();

    if (actionType === 'attack') {
      const weaponName = intent.weapon || 'Bare Hands';
      const obDetails = this.calculateWeaponOB(weaponName, character);
      const bonus = obDetails.total;

      const roll = await this.rollOpenEnded(diceRoller, "Attack Roll");
      const total = roll + bonus;

      // Determine target AT
      const targetArmor = this.calculateAT(targetEntity || {});
      const targetAT = targetArmor.at || 1;

      // Table Lookup (Hardcoded to Broadsword for now as example)
      const rawResult = this.lookupAttackResult("table_8_3_7_broadsword_attack", total, targetAT);
      const parsed = this.parseResultString(rawResult);

      let resultText = parsed.damage > 0 ? "Hit" : "Miss";
      let damage = parsed.damage;
      let criticalInfo = null;

      if (parsed.severity) {
        resultText = `${parsed.severity} ${parsed.type} Critical!`;
        
        // Roll for Critical Effect
        const critRoll = diceRoller ? await diceRoller('1d100', `${parsed.severity} Critical Strike`) : (Math.floor(Math.random() * 100) + 1);
        criticalInfo = this.determineCriticalEffect(critRoll, parsed.severity);
        damage += (criticalInfo.extraDamage || 0);
      }

      return {
        success: damage > 0,
        roll: roll,
        bonus: bonus,
        totalScore: total,
        outcome: resultText,
        damageApplied: damage,
        critical: criticalInfo
      };
    } else {
      // Handle Maneuvers (Skill Checks)
      const roll = await this.rollOpenEnded(diceRoller, "Skill Check");

      const skillName = actionType;
      const skills = character.skills || {};

      // Try resilient lookup for skill data
      const skillNameLower = skillName.toLowerCase().trim();
      let skillData = skills[skillName];
      let actualSkillName = skillName;

      if (!skillData) {
        const keys = Object.keys(skills);
        // 1. Try exact match (case-insensitive)
        const exactKey = keys.find(k => k.toLowerCase().trim() === skillNameLower);
        if (exactKey) {
          skillData = skills[exactKey];
          actualSkillName = exactKey;
        } else {
          // 2. Try fuzzy match (contains)
          const fuzzyKey = keys.find(k => k.toLowerCase().includes(skillNameLower) || skillNameLower.includes(k.toLowerCase()));
          if (fuzzyKey) {
            skillData = skills[fuzzyKey];
            actualSkillName = fuzzyKey;
          } else if (Array.isArray(skills)) {
            // 3. Try array search if skills is an array
            const found = skills.find(s => {
              const sName = (s.name || s.skill || '').toLowerCase().trim();
              return sName === skillNameLower || sName.includes(skillNameLower) || skillNameLower.includes(sName);
            });
            if (found) {
              skillData = found;
              actualSkillName = found.name || found.skill;
            }
          }
        }
      }

      console.log(`[RolemasterRules] Skill Lookup for "${skillName}": Found "${actualSkillName}"`);
      const skillCalc = this.calculateSkillBonus(actualSkillName, skillData, character);
      const bonus = skillCalc.total;

      const total = roll + bonus;
      let success = total >= 100;
      let outcome = success ? "Success" : "Failure";

      return {
        success: success,
        roll: roll,
        bonus: bonus,
        totalScore: total,
        outcome: outcome,
        action: actionType
      };
    }
  }

  // Mock Critical Table lookup based on severity
  determineCriticalEffect(roll, severity = 'A') {
    // Severity modifiers (A=0, B=+10, C=+20, D=+30, E=+40)
    const severityBonus = { 'A': 0, 'B': 10, 'C': 20, 'D': 30, 'E': 40 }[severity] || 0;
    const modifiedRoll = roll + severityBonus;

    if (modifiedRoll >= 90) return { result: "Fell foe instantly!", extraDamage: 20, stunned: 3 };
    if (modifiedRoll >= 60) return { result: "Severe wound.", extraDamage: 10, stunned: 1 };
    if (modifiedRoll >= 30) return { result: "Light wound.", extraDamage: 5, stunned: 0 };
    return { result: "Minor grazing.", extraDamage: 0, stunned: 0 };
  }

  // Simplified applyEffect
  applyEffect(effect, target) {
    if (effect.type === 'damage' && target.hp !== undefined) {
      target.hp = Math.max(0, target.hp - effect.value);
    }
    return target;
  }

  // Returns list of NPC types from npc_data.json
  getAvailableNPCs() {
    return Object.keys(npcData);
  }

  // Returns stat block for a specific NPC type
  getNPCStats(type) {
    return npcData[type] || null;
  }
}

export const rolemasterSystem = new RolemasterRules();
rolemasterSystem.CharacterSheet = RolemasterSheet;
