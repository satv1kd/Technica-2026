export function AuroraBackground({ listening }: { listening: boolean }) {
  return (
    <div className={`aurora${listening ? " aurora-listening" : ""}`} aria-hidden="true">
      <span className="blob blob-teal" />
      <span className="blob blob-blue" />
      <span className="blob blob-amber" />
      <span className="blob blob-coral" />
      <span className="vignette" />
    </div>
  );
}
