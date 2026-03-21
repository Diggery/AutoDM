import { GameSystemInterface } from '../RulesInterface';
import attacksData from './data/attacks.json';
import templateData from './data/character_template.json';
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
    if (intent.action === 'attack') {
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
    }

    return { success: false, note: "Action type not supported in this test implementation." };
  }

  // Simplified applyEffect
  applyEffect(effect, target) {
    if (effect.type === 'damage' && target.hp !== undefined) {
      target.hp = Math.max(0, target.hp - effect.value);
    }
    return target;
  }
}

export const rolemasterSystem = new RolemasterRules();
rolemasterSystem.CharacterSheet = RolemasterSheet;
