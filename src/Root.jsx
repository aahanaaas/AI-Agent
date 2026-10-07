import { useAuth } from '@clerk/react'
import { useState } from 'react'
import App from './App.jsx'
import Login from './pages/Login.jsx'

function ClerkRoot({ isGuest, setIsGuest }) {
  const { isLoaded, isSignedIn } = useAuth()

  if (!isLoaded) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f1e6] font-sans text-sm text-gray-500">
        Loading...
      </main>
    )
  }

  if (isSignedIn || isGuest) return <App />

  return <Login onGuest={() => setIsGuest(true)} isClerkEnabled />
}

export default function Root({ isClerkEnabled = true }) {
  const [isGuest, setIsGuest] = useState(false)

  if (!isClerkEnabled) {
    return isGuest ? <App /> : <Login onGuest={() => setIsGuest(true)} isClerkEnabled={false} />
  }

  return <ClerkRoot isGuest={isGuest} setIsGuest={setIsGuest} />
}
