/**
 * Standard Interface for AutoDM Rule Modules.
 * All game systems (Rolemaster, D&D 5E, etc.) must implement these methods.
 * This file serves as scaffolding/documentation for the required API.
 */
export class GameSystemInterface {
  /**
   * Calculates the success or failure of an intent based on character stats and rules.
   * @param {Object} intent - The action the player is trying to take (e.g., { type: 'attack', target: 'goblin', weapon: 'sword' })
   * @param {Object} character - The character's current state/stats.
   * @param {Object} gameState - The current state of the game/world.
   * @param {Function} diceRoller - An async function(notation) to roll dice.
   * @returns {Promise<Object>} - Result of the action (JSON).
   */
  async resolveAction(intent, character, gameState, diceRoller) {
    throw new Error('resolveAction not implemented');
  }

  /**
   * Returns a JSON schema of the character's attributes for this specific system.
   * @param {Object} rawData - The raw data from the database.
   * @returns {Object} - The formatted character stats.
   */
  getCharacterStats(rawData) {
    throw new Error('getCharacterStats not implemented');
  }

  /**
   * Returns a list of supported weapon names for this specific game system.
   * @returns {string[]} - Array of weapon names.
   */
  getAvailableWeapons() {
    throw new Error('getAvailableWeapons not implemented');
  }

  /**
   * Generates a blank, default character sheet structure specific to this rule system.
   * @param {string} name - The intended name of the character.
   * @returns {Object} - The default stats, skills, equipment, and hp layout.
   */
  getCharacterTemplate(name) {
    throw new Error('getCharacterTemplate not implemented');
  }

  /**
   * Updates game state or character state (e.g., applying damage, buffs, debuffs).
   * @param {Object} effect - The effect to apply (e.g., { type: 'damage', value: 5 })
   * @param {Object} target - The target of the effect.
   * @returns {Object} - The modified target state.
   */
  applyEffect(effect, target) {
    throw new Error('applyEffect not implemented');
  }

  /**
   * Checks if an action is legally allowed in the rules (e.g., "Can I cast 2 spells?").
   * @param {Object} intent - The proposed action.
   * @param {Object} character - The character attempting the action.
   * @returns {boolean} - True if legal, false otherwise.
   */
  validateMove(intent, character) {
    throw new Error('validateMove not implemented');
  }

  /**
   * Returns a list of available NPC types for this system.
   * @returns {string[]} - Array of NPC type names.
   */
  getAvailableNPCs() {
    throw new Error('getAvailableNPCs not implemented');
  }

  /**
   * Returns the base stats for a specific NPC type.
   * @param {string} type - The type of NPC (e.g., 'Orc').
   * @returns {Object} - The base stats for the NPC.
   */
  getNPCStats(type) {
    throw new Error('getNPCStats not implemented');
  }
}
