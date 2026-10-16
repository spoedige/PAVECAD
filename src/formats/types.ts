/** Modelo normalizado de projeto. Independe do padrão de planilha de origem. */

export interface Lane {
  /** Código de solução como veio da planilha (ex.: "FSE(50%)+Micro"). */
  code: string | null;
  iri: number | null;
  /** Fração 0 a 1. */
  defPct: number | null;
  atr: number | null;
  d0: number | null;
  rc: number | null;
  d120: number | null;
  /** O / P / R / D */
  opdr: string | null;
  /** EX / AF / E */
  exafe: string | null;
  hr: number | null;
  /** 7 colunas de tratamento: Estrutural, Fresagem funcional, Fresagem estrutural,
   *  Selagem, Microfresagem, Fresagem fina, Revestimento. 0 quando vazio. */
  treat: (number | string)[];
  fsTipo: 'C' | 'D' | null;
  /** Espessura de fresagem (cm) e % de área de atuação da solução (FS ou FSE). */
  fsEsp: number | null;
  fsPct: number | null;
  /** Espessura de gap graded (cm). */
  gapCm: number | null;
}

export interface Row {
  /** Hodômetro contínuo (km). Só serve para o vínculo entre abas. */
  hod: number;
  lat: number;
  lon: number;
  /** Cota do eixo (m). Vazio por enquanto; reservado para perfil longitudinal. */
  z: number | null;
  /** Largura de cada faixa existente (m). */
  widths: number[];
  /** Largura do acostamento externo (m). */
  shoulder: number;
  shoulderCode: string | null;
  obs: string | null;
  platform: string | null;
  lanes: Lane[];
  /** Rótulo de marco como veio ("59+940"). */
  marco: string | null;
  /** Tipo de dreno lido das colunas 15/18 e 16/19 da Solução. "?" = marcado sem tipo. */
  drain: [string | null, string | null] | null;
  /** Espessura do revestimento existente HE (colunas 186 e 187 do Unifilar). */
  he: [number | null, number | null];
}

export interface ProjectMeta {
  name: string;
  uf: string;
  via: string;
  /** +1 crescente, -1 decrescente. */
  travel: 1 | -1;
  kmi: number | null;
  kmf: number | null;
  format: string;
}

export interface LogEntry {
  level: 'info' | 'warn';
  code: string;
  msg: string;
}

export interface ParsedProject {
  meta: ProjectMeta;
  rows: Row[];
  log: LogEntry[];
  /** Ocorrências por código principal de solução, para alimentar o catálogo. */
  codes: Record<string, number>;
}

/** Entrada mínima do que o leitor precisa de um workbook, sem acoplar ao SheetJS. */
export interface SheetBook {
  names: string[];
  /** Matriz de células por aba (índices base 0), vazias como null. */
  sheet(name: string): unknown[][];
}

export interface FormatDef {
  id: string;
  label: string;
  detect(wb: SheetBook): boolean;
  parse(wb: SheetBook): ParsedProject;
}
