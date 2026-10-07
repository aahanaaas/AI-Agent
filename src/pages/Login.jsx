import { useSignIn } from '@clerk/react/legacy'
import { useState } from 'react'

function LoginContent({ onGuest, signIn, isLoaded }) {
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState('')

  const handleGoogleSignIn = async () => {
    if (!isLoaded || !signIn || isSigningIn) return

    setError('')
    setIsSigningIn(true)

    try {
      await signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: '/sso-callback',
        redirectUrlComplete: '/',
      })
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : 'Unable to start Google sign-in. Please try again.',
      )
      setIsSigningIn(false)
    }
  }

  return (
    <main className="flex min-h-screen w-full flex-col justify-center bg-[#f5f1e6] p-8 font-sans text-gray-950 sm:p-12">
      <div className="mx-auto w-full max-w-md">
        <a href="/" className="mb-16 inline-flex items-center gap-3" aria-label="Research Agent home">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-black text-sm font-semibold text-white">
            R
          </span>
          <span className="text-sm font-semibold tracking-tight">Research Agent</span>
        </a>

        <div className="mb-9">
          <p className="mb-3 text-sm font-medium text-gray-500">Your research, with receipts.</p>
          <h1 className="max-w-sm text-4xl font-semibold leading-tight tracking-tight">
            Sign in to start researching
          </h1>
          <p className="mt-3 text-base leading-6 text-gray-500">
            New here? We&apos;ll set up your account automatically.
          </p>
        </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={!isLoaded || !signIn || isSigningIn}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-md border border-gray-300 bg-white text-sm font-medium transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 4)" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.74 7.18l7.65 5.94c4.47-4.13 7.13-10.2 7.13-17.59Z" />
            <path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.94 23.94 0 0 0 0 21.56l7.98-6.19Z" transform="translate(0 4)" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.81l-7.65-5.94c-2.13 1.43-4.85 2.27-8.25 2.27-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" transform="translate(0 -4)" />
          </svg>
          {isSigningIn ? 'Connecting to Google...' : 'Continue with Google'}
        </button>
        {error && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="my-7 flex items-center gap-4" aria-hidden="true">
          <span className="h-px flex-1 bg-gray-200" />
          <span className="text-xs font-medium uppercase tracking-wider text-gray-400">or</span>
          <span className="h-px flex-1 bg-gray-200" />
        </div>

        <form onSubmit={(event) => event.preventDefault()} className="space-y-3">
          <label className="sr-only" htmlFor="login-email">Email or mobile number</label>
          <input
            id="login-email"
            type="text"
            autoComplete="email"
            placeholder="Email or mobile number"
            className="h-12 w-full rounded-md border border-gray-300 bg-white px-4 text-sm outline-none transition focus:border-gray-950 focus:ring-2 focus:ring-gray-950/10"
          />
          <button
            type="submit"
            className="h-12 w-full rounded-md bg-black text-sm font-medium text-white transition-colors hover:bg-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            Continue
          </button>
          <button
            type="button"
            onClick={onGuest}
            className="h-12 w-full rounded-md border border-black bg-transparent text-sm font-medium text-black transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            Continue as Guest
          </button>
        </form>

        <p className="mt-6 text-center text-xs leading-5 text-gray-400">
          By continuing, you agree to our terms and acknowledge our privacy policy.
        </p>
      </div>
    </main>
  )
}

function ClerkLogin({ onGuest }) {
  const { isLoaded, signIn } = useSignIn()
  return <LoginContent onGuest={onGuest} signIn={signIn} isLoaded={isLoaded} />
}

/** @param {{ onGuest: () => void, isClerkEnabled?: boolean }} props */
export default function Login({ onGuest, isClerkEnabled = true }) {
  if (!isClerkEnabled) {
    return <LoginContent onGuest={onGuest} signIn={null} isLoaded />
  }

  return <ClerkLogin onGuest={onGuest} />
}
