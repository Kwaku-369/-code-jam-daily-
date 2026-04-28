// Zustand global state
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { UserProfile } from './api'

type AuthState = {
  user: UserProfile | null
  token: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  setAuth: (user: UserProfile, token: string, refreshToken: string) => void
  clearAuth: () => void
  updateToken: (token: string, refreshToken: string) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      setAuth: (user, token, refreshToken) =>
        set({ user, token, refreshToken, isAuthenticated: true }),
      clearAuth: () =>
        set({ user: null, token: null, refreshToken: null, isAuthenticated: false }),
      updateToken: (token, refreshToken) =>
        set({ token, refreshToken }),
    }),
    {
      name: 'kwamnan-auth',
      storage: createJSONStorage(() => sessionStorage), // sessionStorage for security
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)

type UIState = {
  sidebarOpen: boolean
  toggleSidebar: () => void
  notifications: number
  setNotifications: (count: number) => void
}

export const useUIStore = create<UIState>()((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  notifications: 0,
  setNotifications: (count) => set({ notifications: count }),
}))
