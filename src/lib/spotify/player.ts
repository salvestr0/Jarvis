import 'server-only'

/**
 * Spotify playback for the bot — search, play, queue, transport, volume.
 *
 * Device rule: if something is already playing somewhere, control that; if
 * not, target the first available device; if there are none, fail with an
 * instruction the model can act on (open Spotify via the PC agent, retry).
 */

import { spotifyFetch } from '@/lib/spotify/auth'

export type PlayableKind = 'track' | 'album' | 'playlist' | 'artist'

export type Found = {
  uri: string
  name: string
  /** Artist for tracks/albums, owner for playlists; '' for artists. */
  by: string
  kind: PlayableKind
}

type ApiItem = {
  uri?: string
  name?: string
  artists?: Array<{ name?: string }>
  owner?: { display_name?: string }
}

function toFound(item: ApiItem, kind: PlayableKind): Found | null {
  if (!item?.uri || !item?.name) return null
  return {
    uri: item.uri,
    name: item.name,
    by: item.artists?.map((a) => a?.name).filter(Boolean).join(', ') ??
      item.owner?.display_name ??
      '',
    kind,
  }
}

/** His own playlists, for "play my <name>" — /search only covers the catalog. */
async function findMyPlaylist(query: string): Promise<Found | null> {
  const data = (await spotifyFetch('/me/playlists?limit=50', 'spotify playlists')) as {
    items?: ApiItem[]
  }
  const q = query.toLowerCase()
  const hit = (data.items ?? []).find((p) => p.name?.toLowerCase().includes(q))
  return hit ? toFound(hit, 'playlist') : null
}

export async function search(query: string, kind: PlayableKind): Promise<Found | null> {
  if (kind === 'playlist') {
    const mine = await findMyPlaylist(query)
    if (mine) return mine
  }
  const params = new URLSearchParams({ q: query, type: kind, limit: '3' })
  const data = (await spotifyFetch(`/search?${params}`, 'spotify search')) as Record<
    string,
    { items?: ApiItem[] }
  >
  // Search results can contain null holes; take the first real item.
  for (const item of data[`${kind}s`]?.items ?? []) {
    const found = toFound(item, kind)
    if (found) return found
  }
  return null
}

type Device = { id?: string; name?: string; is_active?: boolean }

/**
 * The device_id query param to target, or '' when a device is already
 * active. Throws when Spotify is not open anywhere.
 */
async function deviceParam(): Promise<string> {
  const data = (await spotifyFetch('/me/player/devices', 'spotify devices')) as {
    devices?: Device[]
  }
  const devices = data.devices ?? []
  if (devices.some((d) => d.is_active)) return ''
  const first = devices.find((d) => d.id)
  if (!first) {
    throw new Error(
      'No Spotify device is available. Open Spotify somewhere first (e.g. pc_run_action open_app spotify), wait a few seconds, then retry.'
    )
  }
  return `?device_id=${encodeURIComponent(first.id as string)}`
}

/** Play a found thing (tracks by uri, everything else as context). */
export async function play(found: Found): Promise<void> {
  const body =
    found.kind === 'track' ? { uris: [found.uri] } : { context_uri: found.uri }
  await spotifyFetch(`/me/player/play${await deviceParam()}`, 'spotify play', {
    method: 'PUT',
    body,
  })
}

export async function queue(found: Found): Promise<void> {
  await spotifyFetch(
    `/me/player/queue?uri=${encodeURIComponent(found.uri)}`,
    'spotify queue',
    { method: 'POST' }
  )
}

export async function control(
  command: 'pause' | 'resume' | 'next' | 'previous'
): Promise<void> {
  if (command === 'pause') {
    await spotifyFetch('/me/player/pause', 'spotify pause', { method: 'PUT' })
  } else if (command === 'resume') {
    await spotifyFetch(`/me/player/play${await deviceParam()}`, 'spotify resume', {
      method: 'PUT',
    })
  } else {
    await spotifyFetch(`/me/player/${command}`, `spotify ${command}`, {
      method: 'POST',
    })
  }
}

export async function setVolume(percent: number): Promise<void> {
  await spotifyFetch(
    `/me/player/volume?volume_percent=${percent}`,
    'spotify volume',
    { method: 'PUT' }
  )
}

export type NowPlaying = {
  active: boolean
  is_playing?: boolean
  track?: string
  artist?: string
  album?: string
  device?: string
  volume_percent?: number | null
}

export async function nowPlaying(): Promise<NowPlaying> {
  const data = (await spotifyFetch('/me/player', 'spotify now playing')) as {
    is_playing?: boolean
    item?: { name?: string; artists?: Array<{ name?: string }>; album?: { name?: string } }
    device?: { name?: string; volume_percent?: number }
  } | null
  if (!data) return { active: false }
  return {
    active: true,
    is_playing: data.is_playing ?? false,
    track: data.item?.name,
    artist: data.item?.artists?.map((a) => a?.name).filter(Boolean).join(', '),
    album: data.item?.album?.name,
    device: data.device?.name,
    volume_percent: data.device?.volume_percent ?? null,
  }
}
