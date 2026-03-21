import { GameSystemInterface } from '../RulesInterface';
import attacksData from './data/attacks.json';
import templateData from './data/character_template.json';
import npcData from './data/npc_data.json';
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

  // Simplified validateMove
  validateMove(intent, character) {
    if (!intent || !intent.action) return false;
    // In a test system, assume all basic moves are valid if they have an action
    return true;
  }

  // Simplified resolveAction using external async dice roller
  async resolveAction(intent, character, gameState, diceRoller) {
    const actionType = intent.action;
    
    if (actionType === 'attack') {
      // Very basic 1d100 roll + skill
      const roll = diceRoller ? await diceRoller('1d100') : (Math.floor(Math.random() * 100) + 1);
      const total = roll + (character.weaponSkill || 0);

      let resultText = "Miss";
      let damage = 0;

      // Arbitrary simplified Rolemaster combat table logic
      if (total >= 100) {
        resultText = "Critical Hit!";
        damage = 15;
      } else if (total >= 70) {
        resultText = "Hit";
        damage = 5;
      }

      return {
        success: damage > 0,
        roll: roll,
        totalScore: total,
        outcome: resultText,
        damageApplied: damage
      };
    } else {
      // Handle Maneuvers (Skill Checks)
      // Standard simplified Rolemaster: 1d100 + bonus. 100+ is success.
      const roll = diceRoller ? await diceRoller('1d100') : (Math.floor(Math.random() * 100) + 1);
      
      // Look up skill bonus in character data
      const skillName = actionType.toLowerCase();
      let bonus = 0;
      if (character.skills) {
        // Match skill name case-insensitively or via common mapping
        const matchedSkill = Object.keys(character.skills).find(s => s.toLowerCase() === skillName);
        if (matchedSkill) bonus = character.skills[matchedSkill].bonus || 0;
      }
      
      const total = roll + bonus;
      let success = total >= 100;
      let outcome = success ? "Success" : "Failure";
      
      // Flavor for specific common maneuvers
      if (skillName === 'lockpicking' && !success && total > 80) outcome = "Partial Success (Almost there)";
      if (skillName === 'stealth' && !success && total < 50) outcome = "Blunder (Made noise!)";

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
