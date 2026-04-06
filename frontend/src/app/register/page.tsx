"use client"

// CLIENT component — this page has a form with state and a submit handler.
// It's outside the (app) route group so it gets no sidebar (intentional).

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function RegisterPage() {
  const [name, setName] = useState("")
  const [homeId, setHomeId] = useState("1")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/persons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, homeId: Number(homeId) }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.message ?? "Failed to create person")
        return
      }

      router.push("/dashboard")
    } catch {
      setError("Could not connect to the backend. Is it running?")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-lg border p-8">
        <h1 className="mb-6 text-xl font-semibold">Add Person</h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Arjun"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="homeId" className="text-sm font-medium">
              Home ID
            </label>
            <input
              id="homeId"
              type="number"
              value={homeId}
              onChange={(e) => setHomeId(e.target.value)}
              required
              min={1}
              className="rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Home ID 1 is seeded automatically. Use 1 unless you have multiple families.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Person"}
          </button>
        </form>
      </div>
    </div>
  )
}
