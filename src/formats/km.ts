/** Rótulos de marco. O hodômetro contínuo não é exibido; vale o marco da planilha. */

/** "59+940" vira 59,94. Normaliza por metros totais: "9+1000" vira 10,000. */
export function parseMarco(marco: string | null | undefined): number | null {
  const m = /^(\d+)\+(\d+)$/.exec(marco ?? '');
  return m ? Number(m[1]) + Number(m[2]) / 1000 : null;
}

/** 10,02 vira "10+020". */
export function kmLabel(km: number): string {
  const k = Math.floor(km + 1e-9);
  return k + '+' + String(Math.round((km - k) * 1000)).padStart(3, '0');
}

export interface SolutionCode {
  /** Tratamento principal (letras e números), "-" quando vazio. */
  main: string;
  /** Complemento após o "+". */
  comp: string | null;
  /** Percentual de área entre parênteses, 100 quando ausente. */
  pct: number;
  code: string | null;
}

export function parseCode(code: string | null | undefined): SolutionCode {
  if (!code) return { main: '-', comp: null, pct: 100, code: null };
  const t = code.split('+');
  const m = /^[A-Za-z0-9]+/.exec(t[0]);
  const p = /\((\d+)%\)/.exec(t[0]);
  return { main: m ? m[0] : '-', comp: t[1] || null, pct: p ? Number(p[1]) : 100, code };
}
