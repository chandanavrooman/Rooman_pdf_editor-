/**
 * Base URL of the FastAPI backend. Empty string = same origin (the Vite dev server proxies /api to the backend).
 * Only non-secret configuration lives in the frontend; API keys are server-side only.
 */
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

export const apiUrl = (path: string): string => `${API_BASE}/api${path.startsWith('/') ? path : `/${path}`}`
