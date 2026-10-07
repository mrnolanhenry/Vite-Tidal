interface Props {
  src?: string;
  size?: number;
  /** Shown instead of an image when there is no src (e.g. a folder icon). */
  label?: string;
}

export default function Artwork({ src, size = 48, label = "♪" }: Props) {
  if (src) {
    return <img className="art" src={src} width={size} height={size} alt="" loading="lazy" />;
  }
  return (
    <div className="art art-empty" style={{ width: size, height: size }} aria-hidden="true">
      {label}
    </div>
  );
}