const FULL_TEXT =
  'Friends is a 501(c)3 nonprofit. EIN #91-1087153. Friends stewards charitable contributions and complex gifts responsibly, and we are proud to hold a Platinum rating from Candid. All donations to Friends are tax-deductible.';

export function Footer() {
  return (
    <footer className="bg-slate-blue relative px-4 py-1.5 sm:py-2 shrink-0 border-t border-white/10">
      {/* Desktop: the full line. Phones: copyright and logo only. */}
      <p className="text-white text-[11px] sm:text-xs leading-snug sm:leading-relaxed text-left sm:text-center pr-20 sm:pr-36 m-0">
        &copy; 2026 Friends of the San Juans<span className="hidden sm:inline">. {FULL_TEXT}</span>
      </p>
      <a
        href="https://sanjuans.org"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute right-4 top-1/2 -translate-y-1/2 opacity-90 hover:opacity-100 transition-opacity"
      >
        <img
          src="/friends-logo-white.webp"
          alt="Friends of the San Juans"
          className="h-5 sm:h-6"
        />
      </a>
    </footer>
  );
}
