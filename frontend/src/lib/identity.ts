const ADJECTIVES = ['Amber', 'Brisk', 'Calm', 'Daring', 'Eager', 'Gentle', 'Jolly', 'Keen', 'Lucky', 'Mellow', 'Nimble', 'Quiet', 'Rapid', 'Sunny', 'Witty']
const ANIMALS = ['Otter', 'Heron', 'Lynx', 'Badger', 'Falcon', 'Marmot', 'Puffin', 'Fox', 'Gecko', 'Moose', 'Owl', 'Panda', 'Seal', 'Tapir', 'Walrus']

const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]

// Per tab, so two tabs side by side act as two different people.
const NAME_KEY = 'shared-sketch:name'

export function loadName(): string {
  try {
    const saved = sessionStorage.getItem(NAME_KEY)
    if (saved) return saved
  } catch {
    // storage unavailable: fall through to a fresh name
  }
  const name = `${pick(ADJECTIVES)} ${pick(ANIMALS)}`
  saveName(name)
  return name
}

export function saveName(name: string): void {
  try {
    sessionStorage.setItem(NAME_KEY, name)
  } catch {
    // not remembered; fine
  }
}

const USER_COLORS = ['#e8590c', '#2b8a3e', '#9c36b5', '#0c8599', '#c2255c', '#5f3dc4', '#1971c2', '#a61e4d']

/** A stable color per person, used for their presence dot and lock outlines. */
export function userColor(clientId: string): string {
  let h = 0
  for (const ch of clientId) h = (h * 31 + ch.charCodeAt(0)) | 0
  return USER_COLORS[Math.abs(h) % USER_COLORS.length]
}
