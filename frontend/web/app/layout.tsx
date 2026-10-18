import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sonar",
  description: "A voice-first investing tutor for blind and low-vision learners.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* Polite live region: every caption is mirrored here for screen readers. */}
        <div id="sonar-live" className="sr-only" aria-live="polite" aria-atomic="true" />
      </body>
    </html>
  );
}
