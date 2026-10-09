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
const SEARCH_TEXTAREA_MAX_HEIGHT = 162
const SAVED_MEMORY_QUERY =
  'Compare FastAPI and Flask for building a small Python API that may need to handle many simultaneous requests. Which one fits better, and what are the trade-offs? Include evidence and sources'
const SAVED_MEMORY_RESPONSE = [
  '## FastAPI',
  '- Specifically designed for high concurrency and modern APIs.',
  '- Includes built-in type hints and auto-generated documentation.',
  '- A better fit for handling many simultaneous requests.',
].join('\n')

/** @param {string} text @returns {import('react').ReactNode[]} */
const renderInlineMarkdown = (text) => {
  const tokenPattern = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*]+\*\*|`[^`]+`)/g
  return text.split(tokenPattern).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>
    }
    if (part.startsWith('[')) {
      const match = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/)
      if (match) {
        return (
          <a key={index} href={match[2]} target="_blank" rel="noreferrer">
            {match[1]}
          </a>
        )
      }
    }
    return part
  })
}

/** @param {string} message @returns {import('react').ReactNode[]} */
const renderFormattedMessage = (message) => {
  /** @type {import('react').ReactNode[]} */
  const blocks = []
  /** @type {string[]} */
  let paragraph = []
  /** @type {string[]} */
  let list = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push(<p key={`p-${blocks.length}`}>{renderInlineMarkdown(paragraph.join(' '))}</p>)
    paragraph = []
  }
  const flushList = () => {
    if (!list.length) return
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {list.map((item, index) => <li key={index}>{renderInlineMarkdown(item)}</li>)}
      </ul>,
    )
    list = []
  }

  message.split(/\r?\n/).forEach((line) => {
    const trimmedLine = line.trim()
    const heading = trimmedLine.match(/^(#{1,3})\s+(.+)$/)
    const listItem = trimmedLine.match(/^[-*]\s+(.+)$/)
    const quote = trimmedLine.match(/^>\s?(.*)$/)

    if (!trimmedLine) {
      flushParagraph()
      flushList()
      return
    }
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      const Heading = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3'
      blocks.push(<Heading key={`h-${blocks.length}`}>{renderInlineMarkdown(heading[2])}</Heading>)
      return
    }
    if (listItem) {
      flushParagraph()
      list.push(listItem[1])
      return
    }
    if (quote) {
      flushParagraph()
      flushList()
      blocks.push(<blockquote key={`quote-${blocks.length}`}>{renderInlineMarkdown(quote[1])}</blockquote>)
      return
    }

    flushList()
    paragraph.push(trimmedLine)
  })

  flushParagraph()
  flushList()
  return blocks
}

/** @param {unknown} value @returns {string[]} */
const toTextList = (value) => {
  const values = Array.isArray(value) ? value : [value]
  return values.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [item.trim()]
    if (typeof item === 'number') return [String(item)]
    if (item && typeof item === 'object') {
      const record = /** @type {Record<string, unknown>} */ (item)
      const text = [record.claim, record.text, record.statement, record.reason]
        .find((candidate) => typeof candidate === 'string' && candidate.trim())
      if (typeof text === 'string') return [text.trim()]
    }
    return []
  })
}

/** @param {unknown} result @returns {string} */
const formatComparisonResult = (result) => {
  if (!result || typeof result !== 'object') return 'Comparison completed, but the backend returned no verdict.'

  const response = /** @type {Record<string, unknown>} */ (result)
  const verdict = response.verdict && typeof response.verdict === 'object'
    ? /** @type {Record<string, unknown>} */ (response.verdict)
    : {}
  const sections = []
  const winner = typeof verdict.winner === 'string' ? verdict.winner.trim() : ''
  const reason = typeof verdict.reason === 'string' ? verdict.reason.trim() : ''

  if (winner) sections.push(`## ${winner}`)
  if (reason) sections.push(`- ${reason}`)

  const tradeoffs = toTextList(verdict.flips_if)
  if (tradeoffs.length) {
    sections.push(`### Trade-offs\n${tradeoffs.map((item) => `- ${item}`).join('\n')}`)
  }

  const claims = Array.isArray(response.claims)
    ? response.claims
    : Array.isArray(verdict.claims)
      ? verdict.claims
      : []
  const claimLines = claims.flatMap((/** @type {unknown} */ claim) => {
    if (typeof claim === 'string' && claim.trim()) return [`- ${claim.trim()}`]
    if (!claim || typeof claim !== 'object') return []
    const record = /** @type {Record<string, unknown>} */ (claim)
    const text = [record.claim, record.text, record.statement]
      .find((candidate) => typeof candidate === 'string' && candidate.trim())
    const quote = typeof record.quote === 'string' && record.quote.trim() ? record.quote.trim() : ''
    if (typeof text !== 'string' && !quote) return []
    const line = typeof text === 'string' ? `- ${text.trim()}` : '- Evidence'
    return [quote ? `${line}\n  > ${quote}` : line]
  })
  if (claimLines.length) sections.push(`### Evidence\n${claimLines.join('\n')}`)

  const sources = Array.isArray(response.sources)
    ? response.sources
    : Array.isArray(verdict.sources)
      ? verdict.sources
      : []
  const sourceLines = sources.flatMap((/** @type {unknown} */ source) => {
    if (!source || typeof source !== 'object') return []
    const record = /** @type {Record<string, unknown>} */ (source)
    const url = typeof record.url === 'string' && /^https?:\/\//i.test(record.url) ? record.url : ''
    const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : url
    if (url) return [`- [${title}](${url})`]
    return typeof record.title === 'string' && record.title.trim() ? [`- ${record.title.trim()}`] : []
  })
  if (sourceLines.length) sections.push(`### Sources\n${sourceLines.join('\n')}`)

  return sections.join('\n\n') || 'Comparison completed, but the backend returned no verdict.'
}

/**
 * @param {{ message: string, status?: boolean, plain?: boolean }} props
 */
function AIResponse({ message, status = false, plain = false }) {
  return (
    <div className={`ai-response-row${plain ? ' ai-response-row--plain' : ''}`} role={status ? 'status' : undefined}>
      <div className="ai-response-card">
        <div className="ai-response-message">
          {renderFormattedMessage(message)}
        </div>
        <div className="ai-response-actions" aria-hidden="true">
          <span title="Copy">
            <svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
          </span>
          <span title="Refresh">
            <svg viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9A7 7 0 0 1 18 6.5L20 12M4 12l2 5.5A7 7 0 0 0 18.4 15" /></svg>
          </span>
        </div>
      </div>
    </div>
  )
}

/** @param {HTMLTextAreaElement | null} element */
const resizeSearchTextarea = (element) => {
  if (!element) return

  element.style.height = 'auto'
  element.style.height = `${Math.min(element.scrollHeight, SEARCH_TEXTAREA_MAX_HEIGHT)}px`
  element.style.overflowY = element.scrollHeight > SEARCH_TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'
}

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
  const [isMemoryDetailOpen, setIsMemoryDetailOpen] = useState(false)
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
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [searchResult, setSearchResult] = useState('')
  const [memoryFollowUpQuery, setMemoryFollowUpQuery] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const searchRequestIdRef = useRef(0)
  const searchTextareaRef = useRef(/** @type {HTMLTextAreaElement | null} */ (null))
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
    const resizeTextarea = () => resizeSearchTextarea(searchTextareaRef.current)
    resizeTextarea()
    window.addEventListener('resize', resizeTextarea)
    return () => window.removeEventListener('resize', resizeTextarea)
  }, [])

  useEffect(() => {
    resizeSearchTextarea(searchTextareaRef.current)
  }, [query])

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
    const requestId = ++searchRequestIdRef.current
    setIsBusy(true)
    setError('')
    setSearchResult('')

    try {
      if (onSearch) {
        await onSearch(trimmedQuery)
        const answer = 'Search completed.'
        if (searchRequestIdRef.current === requestId) setSearchResult(answer)
        return
      }

      const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '')
      if (!configuredApiBaseUrl) {
        throw new Error('VITE_API_BASE_URL is not configured.')
      }

      const comparisonMatch = trimmedQuery.match(
        /^\s*compare\s+(.+?)\s+(?:and|vs\.?|versus)\s+(.+?)(?:\s+(?:for|to|when)\s+(.+))?[?.!]*\s*$/i,
      )
      const comparison = comparisonMatch
        ? {
            lib_a: comparisonMatch[1].trim(),
            lib_b: comparisonMatch[2].trim(),
            use_case: comparisonMatch[3]?.trim() || 'general purpose project',
            ecosystem: /\b(?:javascript|js|node(?:\.js)?|npm|react|vue)\b/i.test(trimmedQuery)
              ? 'npm'
              : /\b(?:rust|cargo|crate)\b/i.test(trimmedQuery)
                ? 'cargo'
                : /\b(?:go|golang|module)\b/i.test(trimmedQuery)
                  ? 'go'
                  : /\b(?:java|maven)\b/i.test(trimmedQuery)
                    ? 'maven'
                    : /\b(?:ruby|rubygems|gem)\b/i.test(trimmedQuery)
                      ? 'rubygems'
                      : /\b(?:php|packagist|composer)\b/i.test(trimmedQuery)
                        ? 'packagist'
                        : 'pypi',
          }
        : null
      const endpoint = comparison ? 'compare' : 'audit'
      const requestUrl = import.meta.env.DEV ? `/api/${endpoint}` : `${configuredApiBaseUrl}/${endpoint}`
      const requestBody = comparison || {
        manifest: trimmedQuery,
        manifest_type: 'auto',
        goal: '',
        auto_compare: false,
      }
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      let result
      try {
        result = await response.json()
      } catch {
        throw new Error(`The backend returned an unreadable response (HTTP ${response.status}).`)
      }

      if (!response.ok) {
        const detail = result?.detail
        const message = Array.isArray(detail)
          ? detail.map((item) => item.msg).filter(Boolean).join('; ')
          : typeof detail === 'string'
            ? detail
            : `The request failed (HTTP ${response.status}).`
        throw new Error(message)
      }

      if (comparison) {
        if (result.error) throw new Error(result.error)
        const answer = formatComparisonResult(result)
        if (searchRequestIdRef.current === requestId) setSearchResult(answer)
      } else {
        const dependencies = Array.isArray(result.dependencies) ? result.dependencies : []
        const summary = result.summary || {}
        const answer = [
          `- **Dependencies checked:** ${dependencies.length}`,
          `- **High risk:** ${summary.high ?? 0}`,
          `- **Medium risk:** ${summary.medium ?? 0}`,
          `- **Low risk:** ${summary.low ?? 0}`,
        ].join('\n')
        if (searchRequestIdRef.current === requestId) setSearchResult(answer)
      }
    } catch (searchError) {
      if (searchRequestIdRef.current === requestId) {
        setError(
          searchError instanceof TypeError
            ? import.meta.env.DEV
              ? 'Could not reach the backend. Check that the Render API is available and restart the dev server.'
              : 'Could not reach the backend. Check VITE_API_BASE_URL in Vercel and FRONTEND_ORIGINS in Render, then redeploy both services.'
            : searchError instanceof Error
              ? searchError.message
              : 'Search failed unexpectedly.',
        )
      }
    } finally {
      if (searchRequestIdRef.current === requestId) {
        busyRef.current = false
        setIsBusy(false)
      }
    }
  }

  const handleNewChat = () => {
    searchRequestIdRef.current += 1
    busyRef.current = false
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setActiveNavItem('')
    setIsMemoryDetailOpen(false)
    setIsProfileOpen(false)
    setIsSidebarOpen(false)
    setQuery('')
    setSubmittedQuery('')
    setSearchResult('')
    setMemoryFollowUpQuery('')
    setError('')
    setIsBusy(false)
    setIsListening(false)
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
        className={`screen screen--welcome${isProfileOpen ? ' screen--profile' : ''}${submittedQuery && !isProfileOpen && activeNavItem !== 'memory' ? ' screen--conversation' : ''}`}
        aria-label="Welcome screen"
      >
        <header className="topbar" aria-hidden="true" />
        <aside className="menu-rail" aria-label="Main menu">
          <button
            type="button"
            className="icon-button menu-button"
            aria-label={
              isProfileOpen || activeNavItem === 'memory'
                ? 'Go to homepage'
                : isSidebarOpen
                  ? 'Close menu'
                  : 'Open menu'
            }
            aria-expanded={isSidebarOpen}
            aria-controls="app-sidebar"
            onClick={() => {
              if (isProfileOpen) {
                setIsProfileOpen(false)
                setActiveNavItem('')
                setIsSidebarOpen(false)
                return
              }

              if (activeNavItem === 'memory') {
                setActiveNavItem('')
                setIsMemoryDetailOpen(false)
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
          isMemoryDetailOpen ? (
            <main className="memory-detail-screen">
              <button
                type="button"
                className="memory-detail-back"
                onClick={() => setIsMemoryDetailOpen(false)}
              >
                Back to Memories
              </button>
              <section className="memory-detail-thread" aria-label="Saved conversation">
                <p className="conversation-user-message">
                  {SAVED_MEMORY_QUERY}
                </p>
                <AIResponse message={SAVED_MEMORY_RESPONSE} plain />
                {memoryFollowUpQuery && (
                  <>
                    <p className="conversation-user-message">
                      {memoryFollowUpQuery}
                    </p>
                    {(searchResult || error || isBusy) && (
                      <AIResponse message={isBusy ? 'Searching…' : error || searchResult} status plain />
                    )}
                  </>
                )}
              </section>
              <form
                className={`memory-detail-composer${selectedChatColor?.name === 'Black' ? ' search-panel--dark-chat' : ''}`}
                style={{ backgroundColor: selectedChatColor?.value, color: chatColorText }}
                role="search"
                aria-busy={isBusy}
                onSubmit={(event) => {
                  event.preventDefault()
                  const trimmedQuery = query.trim()
                  if (!trimmedQuery || isBusy) return
                  setMemoryFollowUpQuery(trimmedQuery)
                  setQuery('')
                  void handleSubmit(trimmedQuery)
                }}
              >
                <textarea
                  className="search-input"
                  rows={1}
                  aria-label="Continue conversation"
                  placeholder="Message"
                  value={query}
                  disabled={isBusy}
                  onChange={(event) => setQuery(event.target.value)}
                  onInput={(event) => resizeSearchTextarea(event.currentTarget)}
                  onKeyDown={(event) => {
                    if (
                      event.key !== 'Enter' ||
                      event.shiftKey ||
                      event.nativeEvent.isComposing ||
                      event.nativeEvent.keyCode === 229
                    ) {
                      return
                    }

                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }}
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
                    aria-label="Send message"
                    disabled={!query.trim() || isBusy}
                    style={{ color: chatColorText }}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M3 3l19 9-19 9 4.5-9z" />
                    </svg>
                  </button>
                </div>
              </form>
            </main>
          ) : (
            <main className="library-screen memories-screen" aria-label="Memories">
              <header className="memories-header">
                <h1 className="memories-title">Memories</h1>
                <label className="memory-search">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="10.8" cy="10.8" r="6.8" />
                    <path d="m16 16 5 5" />
                  </svg>
                  <input type="search" aria-label="Search memory" placeholder="Search memory" />
                </label>
              </header>
              <section className="memory-group" aria-label="Memories from October 5, 2026">
                <h2 className="memory-date">
                  <time dateTime="2026-10-05">October 5, 2026</time>
                </h2>
                <button
                  type="button"
                  className="memory-file"
                  onClick={() => setIsMemoryDetailOpen(true)}
                  aria-label="Open saved chat: FastAPI vs Flask for APIs"
                >
                  <span className="memory-file-name">FastAPI vs Flask for APIs</span>
                </button>
              </section>
            </main>
          )
        ) : (
          <main className={`welcome-content${submittedQuery ? ' welcome-content--conversation' : ''}`}>
            {!submittedQuery && (
              <>
                {typeof userName === 'string' && userName.trim() && (
                  <p className="hero__greeting">Welcome back, {userName}.</p>
                )}
                <h1>Welcome, {DEMO_PROFILE.displayName}!</h1>
                <p className="welcome-subtitle">What are we searching for today?</p>
              </>
            )}

            {submittedQuery && (
              <section className="conversation-thread" aria-label="Research conversation" aria-live="polite">
                <p className="conversation-user-message">{submittedQuery}</p>
                {(isBusy || isListening || error || searchResult) && (
                  <AIResponse
                    message={isBusy ? 'Searching…' : isListening ? 'Listening…' : error || searchResult}
                    status
                    plain
                  />
                )}
              </section>
            )}

            <form
              className={`search-panel${submittedQuery ? ' search-panel--conversation' : ''}${selectedChatColor?.name === 'Black' ? ' search-panel--dark-chat' : ''}`}
              style={{ backgroundColor: selectedChatColor?.value, color: chatColorText }}
              role="search"
              aria-busy={isBusy}
              onSubmit={(event) => {
                event.preventDefault()
                const trimmedQuery = query.trim()
                if (!trimmedQuery || isBusy) return
                setSubmittedQuery(trimmedQuery)
                setQuery('')
                void handleSubmit(trimmedQuery)
              }}
            >
              <textarea
                className="search-input"
                ref={searchTextareaRef}
                rows={1}
                aria-label="Search"
                style={{ color: chatColorText }}
                placeholder="Find something to research"
                value={query}
                disabled={isBusy}
                onChange={(event) => setQuery(event.target.value)}
                onInput={() => resizeSearchTextarea(searchTextareaRef.current)}
                onKeyDown={(event) => {
                  if (
                    event.key !== 'Enter' ||
                    event.shiftKey ||
                    event.nativeEvent.isComposing ||
                    event.nativeEvent.keyCode === 229
                  ) {
                    return
                  }

                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }}
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
            {!submittedQuery && (isBusy || isListening || error || searchResult) && (
              <AIResponse
                message={isBusy ? 'Searching…' : isListening ? 'Listening…' : error || searchResult}
                status
              />
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
              setIsMemoryDetailOpen(false)
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

        <button
          type="button"
          className="nav-item"
          onClick={handleNewChat}
        >
          <span className="nav-icon nav-icon--new-chat" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
            </svg>
          </span>
          <span>New Chat</span>
        </button>

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
