import { useEffect, useState } from 'react'
import type { EpisodeSummary } from '../../../shared/protocol'
import { readJson } from '../../api'
import { useToy } from '../../store/hooks'

/** Loads `episodes/<id>/<rel>` as JSON and reloads when the episode changes or an asset arrives. Keeps the old data while reloading. */
export function useEpisodeJson<T>(ep: EpisodeSummary, rel: string): { data: T | null; loaded: boolean } {
  const tick = useToy((s) => s.assetTick[ep.id] ?? 0)
  const [state, setState] = useState<{ key: string; data: T | null; loaded: boolean }>({ key: '', data: null, loaded: false })
  const key = `${ep.id}/${rel}`
  useEffect(() => {
    let off = false
    void readJson<T>(`episodes/${ep.id}/${rel}`).then((data) => {
      if (!off) setState({ key, data, loaded: true })
    })
    return () => {
      off = true
    }
  }, [ep.id, ep.updatedAt, rel, tick, key])
  return state.key === key ? { data: state.data, loaded: state.loaded } : { data: null, loaded: false }
}
