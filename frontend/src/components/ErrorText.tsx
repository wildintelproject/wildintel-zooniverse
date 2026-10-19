/** Asks the app to open the settings page, shown over whatever is on screen. */
export const OPEN_SETTINGS_EVENT = 'wildintel:open-settings'

/**
 * An error message in red. When it says the account must be saved "in the
 * configuration" (what the backend answers when credentials are missing), it
 * ends with a link that opens the settings.
 */
export default function ErrorText({ message, className = '' }: { message: string; className?: string }) {
  const mentionsConfiguration = /\bconfiguration\b/.test(message)
  return (
    <p className={`text-sm text-red-600 dark:text-red-400 ${className}`}>
      {message}
      {mentionsConfiguration && (
        <>
          {' '}
          <button
            type="button"
            className="underline font-medium hover:opacity-80"
            onClick={() => window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT))}
          >
            Open the settings
          </button>
        </>
      )}
    </p>
  )
}
