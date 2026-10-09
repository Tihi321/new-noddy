import { useStore } from 'zustand'
import { toyStore, type ToyStore } from './store'

export function useToy<T>(selector: (s: ToyStore) => T): T {
  return useStore(toyStore, selector)
}
