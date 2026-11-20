import { useEffect, useState } from 'react'
import { getCapabilities, startLocalSession, type Capabilities } from '@/lib/apiClient'
import { getToken } from '@/lib/auth'

let cached: Capabilities | null = null
let inflight: Promise<Capabilities | null> | null = null

async function load(): Promise<Capabilities | null> {
  if (cached) return cached
  inflight ??= getCapabilities()
    .then(async (c) => {
      cached = c
      if (c.local_test_mode && !getToken()) await startLocalSession()
      return c
    })
    .catch(() => null)
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Server capabilities (installed programs, TTL, AI configured). `null` while loading or when the server is unreachable. */
export function useCapabilities(enabled = true): { caps: Capabilities | null; loading: boolean } {
  const [caps, setCaps] = useState<Capabilities | null>(cached)
  const [loading, setLoading] = useState(enabled && !cached)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void load().then((c) => {
      if (!live) return
      setCaps(c)
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [enabled])
  return { caps: enabled ? caps : null, loading: enabled && loading }
}

export function _resetCapabilitiesCache() {
  cached = null
}
