import goblinQuest from './goblin_quest.json';

export const ADVENTURES = [
  goblinQuest
];

export function getAdventureById(id) {
  return ADVENTURES.find(a => a.id === id);
}
