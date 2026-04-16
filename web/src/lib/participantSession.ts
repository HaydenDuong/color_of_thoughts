/**
 * Persists participant id + display name in localStorage per room so refresh keeps
 * the same anonymous identity without another DB round-trip (until you add auth).
 */

export type StoredParticipant = {
  id: string
  displayName: string
}

const PREFIX = 'color_of_thoughts.participant.v1:'

function key(roomId: string): string {
  return `${PREFIX}${roomId}`
}

export function loadStoredParticipant(roomId: string): StoredParticipant | null {
  try {
    const raw = localStorage.getItem(key(roomId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      'displayName' in parsed &&
      typeof (parsed as StoredParticipant).id === 'string' &&
      typeof (parsed as StoredParticipant).displayName === 'string'
    ) {
      return parsed as StoredParticipant
    }
    return null
  } catch {
    return null
  }
}

export function saveStoredParticipant(
  roomId: string,
  participant: StoredParticipant,
): void {
  localStorage.setItem(key(roomId), JSON.stringify(participant))
}

/** Removes the stored participant for this room (used when the DB row is stale). */
export function clearStoredParticipant(roomId: string): void {
  localStorage.removeItem(key(roomId))
}
