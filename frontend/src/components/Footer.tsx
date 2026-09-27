const iconLink = 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors'

export default function Footer() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 mt-8">
      <div className="max-w-screen-2xl mx-auto px-4 py-4 flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400">
        <span>&copy; {new Date().getFullYear()} WildINTEL project</span>

        <div className="flex items-center gap-3">
          <a
            className={iconLink}
            href="https://wildintel.eu/"
            target="_blank"
            rel="noopener noreferrer"
            title="WildINTEL website"
            aria-label="WildINTEL website"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </a>
          <a
            className={iconLink}
            href="https://www.zooniverse.org/"
            target="_blank"
            rel="noopener noreferrer"
            title="Zooniverse"
            aria-label="Zooniverse"
          >
            🔭
          </a>
        </div>
      </div>
    </footer>
  )
}
