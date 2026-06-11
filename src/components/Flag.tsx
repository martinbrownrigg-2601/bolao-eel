// Mapa de códigos FIFA (3 letras) -> ISO 3166-1 alpha-2 (2 letras).
// O Windows não renderiza emoji de bandeira (mostra "MX", "BR" etc.),
// então usamos imagens da flagcdn a partir do código ISO-2.
const FIFA_TO_ISO2: Record<string, string> = {
  MEX: "mx", RSA: "za", KOR: "kr", CZE: "cz",
  CAN: "ca", SUI: "ch", QAT: "qa", BIH: "ba",
  BRA: "br", MAR: "ma", HAI: "ht", SCO: "gb-sct",
  USA: "us", PAR: "py", AUS: "au", TUR: "tr",
  GER: "de", CUW: "cw", CIV: "ci", ECU: "ec",
  NED: "nl", JPN: "jp", SWE: "se", TUN: "tn",
  BEL: "be", EGY: "eg", IRN: "ir", NZL: "nz",
  ESP: "es", CPV: "cv", KSA: "sa", URU: "uy",
  FRA: "fr", SEN: "sn", NOR: "no", IRQ: "iq",
  ARG: "ar", ALG: "dz", AUT: "at", JOR: "jo",
  POR: "pt", UZB: "uz", COL: "co", COD: "cd",
  ENG: "gb-eng", CRO: "hr", GHA: "gh", PAN: "pa",
};

type FlagProps = {
  codigo?: string | null;
  /** emoji de fallback (campo `bandeira`) */
  bandeira?: string | null;
  /** altura em px da bandeira */
  size?: number;
  className?: string;
};

export function Flag({ codigo, bandeira, size = 18, className }: FlagProps) {
  const iso = codigo ? FIFA_TO_ISO2[codigo.toUpperCase()] : undefined;

  if (!iso) {
    return (
      <span className={className} style={{ fontSize: size }}>
        {bandeira ?? "🏳️"}
      </span>
    );
  }

  // largura ~ 4:3; flagcdn serve por largura (w20, w40...)
  const width = Math.round(size * 1.5);
  return (
    <img
      src={`https://flagcdn.com/w40/${iso}.png`}
      srcSet={`https://flagcdn.com/w80/${iso}.png 2x`}
      width={width}
      height={size}
      alt={codigo ?? ""}
      loading="lazy"
      className={className}
      style={{ display: "inline-block", borderRadius: 2, objectFit: "cover" }}
    />
  );
}
