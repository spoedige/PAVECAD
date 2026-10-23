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
  /** Indicadores do padrão Planservi. FC-2 e FC-3 já vêm em porcentagem (0,05 é "0,05 %"). Ausentes no RoadRunner. */
  igg?: number | null;
  fc2?: number | null;
  fc3?: number | null;
  /** Planservi: espessura de recomposição e de reforço (cm), lidas do número do código. */
  recCm?: number | null;
  refCm?: number | null;
  /** Planservi: as camadas da faixa como vieram, com a leitura em português, para o detalhe do segmento. */
  camadas?: { nome: string; bruto: string | null; texto: string }[];
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
  /** Planservi: texto do revestimento do acostamento como veio ("PMQ2,5", "R2,5", "*"). */
  shoulderRaw?: string | null;
  /** A linha começa um trecho novo: a coordenada tem uma descontinuidade real entre ela e a anterior. */
  quebra?: boolean;
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

/** Verificação de qualidade das coordenadas na importação. Só sinaliza: nada é corrigido nem descartado. */
export interface Qualidade {
  /** Linhas cuja distância à anterior fica fora de faixaSalto (m). `i` é o índice da linha, `km` o da anterior e `kmFim` o da própria. */
  saltos: { i: number; km: string; kmFim: string; dist: number }[];
  /** Linhas em que a distância entre os sentidos passa de maxSentidos (m). */
  sentidos: { i: number; km: string; dist: number }[];
  faixaSalto: [number, number];
  maxSentidos: number;
  /** Pontos cujas coordenadas foram reconstruídas (km, tipo, quanto andaram em relação à coordenada da planilha). */
  corrigidos?: { i: number; km: string; tipo: 'repetido' | 'salto' | 'retrocedendo' | 'inicial' | 'final'; causa?: string; deslocamento: number; orig: [number, number] }[];
  /** Descontinuidades reais: a linha foi cortada antes da linha `i`. */
  cortes?: { i: number; km: string; kmFim: string; dist: number; esperado: number }[];
  /** Anomalias deixadas como estão: trecho parado ou passo atípico. */
  avisos?: { tipo: 'estacionario' | 'passo'; km: string; kmFim: string; dist: number; esperado: number }[];
}

export interface ParsedProject {
  meta: ProjectMeta;
  rows: Row[];
  log: LogEntry[];
  /** Ocorrências por código principal de solução, para alimentar o catálogo. */
  codes: Record<string, number>;
  qualidade?: Qualidade;
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
  /** Um arquivo pode gerar mais de um projeto (o Planservi traz Crescente e Decrescente). */
  parse(wb: SheetBook): ParsedProject[];
}
