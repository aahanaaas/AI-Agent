import { useEffect, useRef, useState } from 'react'
import './App.css'
import { DEMO_PROFILE } from './demoProfile'

const chatColors = [
  { name: 'Black', className: 'black', value: '#000000' },
  { name: 'Red-Orange', className: 'red', value: '#e64a33' },
  { name: 'Orange', className: 'orange', value: '#f5a623' },
  { name: 'Green', className: 'green', value: '#a4c639' },
  { name: 'Brown', className: 'brown', value: '#5c3a21' },
  { name: 'White', className: 'white', value: '#ffffff' },
]

/** @typedef {'name' | 'email' | 'phone' | 'password'} ProfileField */
/** @typedef {Record<ProfileField, string>} ProfileValues */

/**
 * @typedef {{
 *   lang: string,
 *   onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null,
 *   onerror: ((event: unknown) => void) | null,
 *   onend: (() => void) | null,
 *   start: () => void,
 *   stop: () => void
 * }} SpeechRecognitionLike
 */
/** @typedef {new () => SpeechRecognitionLike} SpeechRecognitionConstructor */
/** @typedef {Window & { SpeechRecognition?: SpeechRecognitionConstructor, webkitSpeechRecognition?: SpeechRecognitionConstructor }} SpeechWindow */

/**
 * @param {{ onSearch?: (query: string) => void | Promise<void>, userName?: string }} props
 */
export function App({ onSearch, userName } = {}) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [isChatColorOpen, setIsChatColorOpen] = useState(false)
  const [isThemeOpen, setIsThemeOpen] = useState(false)
  const [theme, setTheme] = useState('Light')
  const [activeNavItem, setActiveNavItem] = useState('')
  const [selectedChatColor, setSelectedChatColor] = useState(chatColors[5])
  const [profileValues, setProfileValues] = useState(/** @type {ProfileValues} */ ({
    name: DEMO_PROFILE.displayName,
    email: DEMO_PROFILE.email,
    phone: DEMO_PROFILE.phone,
    password: '',
  }))
  const [editingProfileField, setEditingProfileField] = useState(/** @type {ProfileField | ''} */ (''))
  const [profileDraft, setProfileDraft] = useState('')
  const [query, setQuery] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const recognitionRef = useRef(/** @type {SpeechRecognitionLike | null} */ (null))
  const chatColorPickerRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const chatColorTriggerRef = useRef(/** @type {HTMLButtonElement | null} */ (null))
  const themePickerRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const themeTriggerRef = useRef(/** @type {HTMLButtonElement | null} */ (null))
  const SpeechRecognition =
    typeof window !== 'undefined'
      ? /** @type {SpeechWindow} */ (window).SpeechRecognition ||
        /** @type {SpeechWindow} */ (window).webkitSpeechRecognition
      : undefined
  const chatColorText = selectedChatColor?.name === 'Black' ? '#fff' : '#000'

  useEffect(() => () => recognitionRef.current?.stop(), [])

  useEffect(() => {
    if (!isChatColorOpen) return undefined

    /** @param {PointerEvent} event */
    const dismissOnOutsideClick = (event) => {
      if (!(event.target instanceof Node) || !chatColorPickerRef.current?.contains(event.target)) {
        setIsChatColorOpen(false)
      }
    }
    /** @param {KeyboardEvent} event */
    const dismissOnEscape = (event) => {
      if (event.key === 'Escape') {
        setIsChatColorOpen(false)
        chatColorTriggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', dismissOnOutsideClick)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsideClick)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [isChatColorOpen])

  useEffect(() => {
    if (!isThemeOpen) return undefined

    /** @param {PointerEvent} event */
    const dismissOnOutsideClick = (event) => {
      if (!(event.target instanceof Node) || !themePickerRef.current?.contains(event.target)) {
        setIsThemeOpen(false)
      }
    }
    /** @param {KeyboardEvent} event */
    const dismissOnEscape = (event) => {
      if (event.key === 'Escape') {
        setIsThemeOpen(false)
        themeTriggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', dismissOnOutsideClick)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsideClick)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [isThemeOpen])

  /** @param {string} query */
  const handleSubmit = async (query) => {
    const trimmedQuery = query.trim()
    if (!trimmedQuery || busyRef.current) return

    busyRef.current = true
    setIsBusy(true)
    setError('')

    try {
      await onSearch?.(trimmedQuery)
    } catch {
      setError('Search failed. Check your connection and try again.')
    } finally {
      busyRef.current = false
      setIsBusy(false)
    }
  }

  const handleVoiceInput = () => {
    if (!SpeechRecognition || isBusy || isListening) return

    const recognition = new SpeechRecognition()
    recognitionRef.current = recognition
    recognition.lang = 'en-IN'
    /** @param {{ results: ArrayLike<ArrayLike<{ transcript: string }>> }} event */
    recognition.onresult = (event) => {
      setQuery(event.results[0][0].transcript)
    }
    recognition.onerror = () => {
      setError('Voice input failed. Please try again.')
    }
    recognition.onend = () => {
      recognitionRef.current = null
      setIsListening(false)
    }

    setError('')
    setIsListening(true)
    recognition.start()
  }

  /** @param {ProfileField} field */
  const beginProfileEdit = (field) => {
    setProfileDraft(field === 'password' ? '' : profileValues[field])
    setEditingProfileField(field)
  }

  const cancelProfileEdit = () => {
    setEditingProfileField('')
    setProfileDraft('')
  }

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  const saveProfileEdit = (event) => {
    event.preventDefault()
    if (!editingProfileField) return
    setProfileValues((values) => ({ ...values, [editingProfileField]: profileDraft.trim() }))
    setEditingProfileField('')
    setProfileDraft('')
  }

  /**
   * @param {ProfileField} field
   * @param {string} label
   * @param {string} [inputType]
   */
  const renderProfileValue = (field, label, inputType = 'text') => {
    if (editingProfileField === field) {
      return (
        <form className="profile-edit-form" onSubmit={saveProfileEdit}>
          <input
            autoFocus
            className="profile-edit-input"
            type={inputType}
            aria-label={`Edit ${label.toLowerCase()}`}
            value={profileDraft}
            placeholder={field === 'password' ? 'Enter new password' : undefined}
            onChange={(event) => setProfileDraft(event.target.value)}
            onKeyDown={(/** @type {import('react').KeyboardEvent<HTMLInputElement>} */ event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                cancelProfileEdit()
              }
            }}
          />
          <div className="profile-edit-actions">
            <button type="submit" className="profile-edit-action" aria-label={`Save ${label.toLowerCase()}`}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m5 12 4 4L19 6" />
              </svg>
            </button>
            <button
              type="button"
              className="profile-edit-action"
              aria-label={`Cancel editing ${label.toLowerCase()}`}
              onClick={cancelProfileEdit}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </form>
      )
    }

    return (
      <div className="profile-static-value">
        <span>{field === 'password' ? DEMO_PROFILE.passwordMask : profileValues[field]}</span>
        <button
          type="button"
          className="profile-edit-button"
          aria-label={`Edit ${label.toLowerCase()}`}
          onClick={() => beginProfileEdit(field)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m14.5 4.5 5 5M3 21l4.7-1 12.1-12.1a2.1 2.1 0 0 0-3-3L4.7 17 3 21Z" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="app-shell" data-theme={theme.toLowerCase()}>
      <section
        className={`screen screen--welcome${isProfileOpen ? ' screen--profile' : ''}`}
        aria-label="Welcome screen"
      >
        <header className="topbar" aria-hidden="true" />
        <aside className="menu-rail" aria-label="Main menu">
          <button
            type="button"
            className="icon-button menu-button"
            aria-label={isProfileOpen ? 'Go to homepage' : isSidebarOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isSidebarOpen}
            aria-controls="app-sidebar"
            onClick={() => {
              if (isProfileOpen) {
                setIsProfileOpen(false)
                setActiveNavItem('')
                setIsSidebarOpen(false)
                return
              }

              setIsSidebarOpen((open) => !open)
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </aside>

        {isProfileOpen ? (
          <main className="profile-screen" aria-label="Profile settings">
            <section className="profile-settings" aria-label="Account settings">
              <h1 className="profile-title">Profile</h1>
              <div className="profile-setting-row">
                <h2>Name</h2>
                <div className="profile-setting-value">
                  {renderProfileValue('name', 'name')}
                </div>
              </div>
              <div className="profile-setting-row">
                <h2>Email Address</h2>
                <div className="profile-setting-value">
                  {renderProfileValue('email', 'email address', 'email')}
                </div>
              </div>
              <div className="profile-setting-row">
                <h2>Phone Number</h2>
                <div className="profile-setting-value">
                  {renderProfileValue('phone', 'phone number', 'tel')}
                </div>
              </div>
              <div className="profile-setting-row profile-setting-row--password">
                <h2>Password</h2>
                <div className="profile-setting-value profile-password-value">
                  {renderProfileValue('password', 'password', 'password')}
                  <span className="password-changed">Last changed {DEMO_PROFILE.passwordChanged}</span>
                </div>
              </div>
              <div className="profile-setting-row">
                <h2>Origin</h2>
                <div className="profile-setting-value">
                  <span>{DEMO_PROFILE.origin}</span>
                </div>
              </div>
              <div className="profile-setting-row">
                <h2>Theme</h2>
                <div className="profile-setting-value">
                  <div className="theme-picker" ref={themePickerRef}>
                    <button
                      type="button"
                      className="theme-trigger"
                      ref={themeTriggerRef}
                      aria-haspopup="true"
                      aria-expanded={isThemeOpen}
                      aria-controls="theme-options"
                      onClick={() => setIsThemeOpen(!isThemeOpen)}
                    >
                      <span>{theme}</span>
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="m3 6 5 5 5-5" />
                      </svg>
                    </button>
                    {isThemeOpen && (
                      <div
                        id="theme-options"
                        className="theme-options"
                        role="group"
                        aria-label="Choose theme"
                      >
                        {['Light', 'Dark'].map((option) => (
                          <button
                            key={option}
                            type="button"
                            className="theme-option"
                            aria-pressed={theme === option}
                            onClick={() => {
                              setTheme(option)
                              setIsThemeOpen(false)
                            }}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="profile-setting-row profile-setting-row--chat-color">
                <h2>Chat Color</h2>
                <div className="profile-setting-value">
                  <div className="chat-color-picker" ref={chatColorPickerRef}>
                    <button
                      type="button"
                      className="chat-color-trigger"
                      ref={chatColorTriggerRef}
                      aria-label={`Chat color: ${selectedChatColor?.name}`}
                      aria-haspopup="true"
                      aria-expanded={isChatColorOpen}
                      aria-controls="chat-color-options"
                      onClick={() => setIsChatColorOpen(!isChatColorOpen)}
                    >
                      <span
                        className={`chat-color-dot chat-color-dot--${selectedChatColor?.className}`}
                        aria-hidden="true"
                      />
                      <span>{selectedChatColor?.name}</span>
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="m3 6 5 5 5-5" />
                      </svg>
                    </button>
                    {isChatColorOpen && (
                      <fieldset
                        id="chat-color-options"
                        className="chat-color-options"
                      >
                        <legend className="visually-hidden">Choose chat color</legend>
                        <div className="chat-color-radio-group">
                          {chatColors.map((color) => (
                            <label
                              key={color.name}
                              className="chat-color-radio"
                              title={color.name}
                            >
                              <input
                                type="radio"
                                name="chat-color"
                                value={color.name}
                                checked={selectedChatColor?.name === color.name}
                                onChange={() => {
                                  setSelectedChatColor(color)
                                  setIsChatColorOpen(false)
                                }}
                              />
                              <span
                                className={`chat-color-dot chat-color-dot--${color.className}`}
                                aria-hidden="true"
                              />
                              <span className="visually-hidden">{color.name}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </main>
        ) : activeNavItem === 'memory' ? (
          <main className="library-screen" aria-label="Quick Memory">
            <section className="library-empty-state">
              <div className="library-empty-icon library-empty-icon--memory" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M9 4a3 3 0 0 0-5.7 1.3A3 3 0 0 0 2 10a3 3 0 0 0 1 5.3A3.5 3.5 0 0 0 9 18.5V4Zm6 0a3 3 0 0 1 5.7 1.3A3 3 0 0 1 22 10a3 3 0 0 1-1 5.3 3.5 3.5 0 0 1-6 3.2V4ZM9 8H6m3 4H5m3 4H6m9-8h3m-3 4h4m-4 4h3" />
                </svg>
              </div>
              <h1>Quick Memory</h1>
              <p>Useful details saved from your research will be collected here.</p>
              <span className="memory-empty-note">Nothing saved yet</span>
            </section>
          </main>
        ) : (
          <main className="welcome-content">
            {typeof userName === 'string' && userName.trim() && (
              <p className="hero__greeting">Welcome back, {userName}.</p>
            )}
            <h1>Welcome, {DEMO_PROFILE.displayName}!</h1>
            <p className="welcome-subtitle">What are we searching for today?</p>

            <form
              className={`search-panel${selectedChatColor?.name === 'Black' ? ' search-panel--dark-chat' : ''}`}
              style={{ backgroundColor: selectedChatColor?.value, color: chatColorText }}
              role="search"
              aria-busy={isBusy}
              onSubmit={(event) => {
                event.preventDefault()
                void handleSubmit(query)
              }}
            >
              <input
                className="search-input"
                type="text"
                aria-label="Search"
                style={{ color: chatColorText }}
                placeholder="Find something to research"
                value={query}
                disabled={isBusy}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="search-actions">
                {SpeechRecognition && (
                  <button
                    type="button"
                    className="voice-button"
                    aria-label="Voice input"
                    aria-pressed={isListening}
                    disabled={isBusy || isListening}
                    style={{ color: chatColorText }}
                    onClick={handleVoiceInput}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
                    </svg>
                  </button>
                )}
                <button
                  type="submit"
                  className="send-button"
                  aria-label="Search"
                  disabled={!query.trim() || isBusy}
                  style={{ color: chatColorText }}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M3 3l19 9-19 9 4.5-9z" />
                  </svg>
                </button>
              </div>
            </form>
            {(isBusy || isListening || error) && (
              <p className="search-status" role="status">
                {isBusy ? 'Searching…' : isListening ? 'Listening…' : error}
              </p>
            )}
          </main>
        )}
      </section>

      {isSidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside
        id="app-sidebar"
        className={`sidebar-panel${isSidebarOpen ? ' is-open' : ''}`}
        aria-label="Sidebar navigation"
        aria-hidden={!isSidebarOpen}
        inert={!isSidebarOpen}
      >
        <nav className="sidebar-nav" aria-label="Main navigation">
          <button
            type="button"
            className="nav-item"
            aria-pressed={activeNavItem === 'memory'}
            onClick={() => {
              setActiveNavItem('memory')
              setIsProfileOpen(false)
              setIsSidebarOpen(false)
            }}
          >
            <span className="nav-icon nav-icon--memory" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M9 4a3 3 0 0 0-5.7 1.3A3 3 0 0 0 2 10a3 3 0 0 0 1 5.3A3.5 3.5 0 0 0 9 18.5V4Zm6 0a3 3 0 0 1 5.7 1.3A3 3 0 0 1 22 10a3 3 0 0 1-1 5.3 3.5 3.5 0 0 1-6 3.2V4ZM9 8H6m3 4H5m3 4H6m9-8h3m-3 4h4m-4 4h3" /></svg>
            </span>
            <span>View Memories</span>
          </button>

          <button
            type="button"
            className="nav-item"
            aria-pressed={activeNavItem === 'websites'}
            onClick={() => {
              setActiveNavItem('websites')
              setIsProfileOpen(false)
              setIsSidebarOpen(false)
            }}
          >
            <span className="nav-icon nav-icon--web" aria-hidden="true">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4a13 13 0 0 1 0 16M12 4a13 13 0 0 0 0 16" /></svg>
            </span>
            <span>Visit recent websites</span>
          </button>
        </nav>

        <div className="chat-section">
          <span>Chats</span>
        </div>

        <button
          type="button"
          className={`profile-block${isProfileOpen ? ' is-selected' : ''}`}
          aria-label={`Open profile for ${DEMO_PROFILE.displayName}`}
          aria-pressed={isProfileOpen}
          onClick={() => {
            setIsProfileOpen(!isProfileOpen)
            setActiveNavItem('')
            setIsSidebarOpen(false)
          }}
        >
          <div className="avatar" aria-hidden="true">
            <svg viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15" />
              <circle cx="18" cy="14" r="4.5" />
              <path d="M8.5 28c1.4-5.1 4.8-7.6 9.5-7.6s8.1 2.5 9.5 7.6" />
            </svg>
          </div>
          <span>{DEMO_PROFILE.displayName}</span>
        </button>
      </aside>
    </div>
  )
}

export default App
