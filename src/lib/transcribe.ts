import 'server-only'

/**
 * Speech to text for Telegram voice notes, via Groq's Whisper endpoint.
 *
 * Claude's API takes text, images and PDFs — not audio — so transcription
 * has to come from somewhere. Groq runs whisper-large-v3-turbo on a free
 * tier that comfortably covers personal voice notes, and returns in about a
 * second. The API is OpenAI-shaped: multipart in, {text} out.
 */

// Voice notes are seconds long; a minute of audio still transcribes fast.
const TIMEOUT_MS = 30_000
const MODEL = 'whisper-large-v3-turbo'

/** Longer than this is almost certainly a misfire, not a note to Jarvis. */
export const MAX_VOICE_SECONDS = 300

export async function transcribeVoice(audio: Uint8Array): Promise<string> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not set.')

  const form = new FormData()
  // Telegram voice notes are OGG/Opus; the extension is what tells Whisper.
  form.append('file', new Blob([audio as BlobPart], { type: 'audio/ogg' }), 'voice.ogg')
  form.append('model', MODEL)
  // Nudges the model toward the vocabulary this bot actually hears.
  form.append(
    'prompt',
    'Personal finance note in Singapore. Amounts in SGD, e.g. "log $12 lunch".'
  )

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      {
        method: 'POST',
        signal: controller.signal,
        headers: { authorization: `Bearer ${key}` },
        body: form,
        cache: 'no-store',
      }
    )

    const payload = (await res.json().catch(() => null)) as {
      text?: string
      error?: { message?: string }
    } | null

    if (!res.ok || typeof payload?.text !== 'string') {
      throw new Error(
        `Transcription failed (HTTP ${res.status}): ${payload?.error?.message ?? 'no text returned'}`
      )
    }

    const text = payload.text.trim()
    if (!text) throw new Error('That voice note came back empty — try again?')
    return text
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Transcription timed out after ${TIMEOUT_MS / 1000}s`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
