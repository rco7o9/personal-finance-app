// Typed fetch wrapper for calling the NestJS backend.
//
// Two base URLs exist because fetch() is called from two different environments:
//
// 1. Server components (run on the Node.js server inside Docker):
//    → Use API_URL = "http://backend:3001" (Docker internal network hostname)
//    → "localhost" inside a Docker container refers to that container itself,
//      not the host machine — so you must use the service name "backend".
//
// 2. Client components (run in the user's browser):
//    → Use NEXT_PUBLIC_API_URL = "http://localhost:3001"
//    → The browser is outside Docker, so it uses localhost:3001 which Docker
//      forwards to the backend container via the port mapping in docker-compose.yml.
//
// typeof window === "undefined" is the standard check for "am I on the server?"
const baseUrl =
  typeof window === "undefined"
    ? process.env.API_URL // server-side (Docker network)
    : process.env.NEXT_PUBLIC_API_URL // client-side (browser)

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    // next.revalidate: 0 disables Next.js's fetch caching for this call.
    // During development, always get fresh data. We can tune this per-route later.
    next: { revalidate: 0 },
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(error.message ?? `API error ${res.status}`)
  }

  return res.json() as Promise<T>
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(error.message ?? `API error ${res.status}`)
  }

  return res.json() as Promise<T>
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(error.message ?? `API error ${res.status}`)
  }

  return res.json() as Promise<T>
}
