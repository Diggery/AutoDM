import { rolemasterSystem } from './Rolemaster';

export const AVAILABLE_RULESETS = [
  {
    id: 'rolemaster',
    name: 'Rolemaster (Simplified)',
    description: 'A classic high-fantasy system known for its detailed critical tables.',
    system: rolemasterSystem
  }
];

export function getRulesetById(id) {
  return AVAILABLE_RULESETS.find(r => r.id === id);
}
