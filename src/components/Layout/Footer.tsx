export function Footer() {
  return (
    <footer className="bg-slate-blue relative px-4 py-2 shrink-0 border-t border-white/10">
      <p className="text-white text-xs leading-relaxed text-center pr-36">
        &copy; 2026 Friends of the San Juans. Friends is a 501(c)3 nonprofit. EIN #91-1087153. Friends stewards charitable contributions and complex gifts responsibly, and we are proud to hold a Platinum rating from Candid. All donations to Friends are tax-deductible.
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
          className="h-6"
        />
      </a>
    </footer>
  );
}
