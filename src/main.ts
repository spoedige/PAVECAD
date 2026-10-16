import { parseSpreadsheet } from './formats';
import { prepareProject } from './geometry/project';
import { buildGeometry } from './geometry/build';

const out = document.querySelector<HTMLPreElement>('#out')!;
document.querySelector<HTMLInputElement>('#file')!.addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const lines: string[] = [];
  for (const f of Array.from(input.files ?? [])) {
    try {
      const parsed = parseSpreadsheet(new Uint8Array(await f.arrayBuffer()));
      const prj = prepareProject(parsed);
      const g = buildGeometry(prj);
      lines.push(
        `${f.name}\n  ${parsed.meta.name} · ${parsed.rows.length} linhas · ${prj.segs.length} trecho(s) · ${g.polys.length} polígonos · ${g.drains.length} drenos`,
        `  CRS EPSG:${prj.crs.epsg} (fuso ${prj.crs.zone}S)`,
        ...parsed.log.map((l) => `  [${l.level}] ${l.msg}`),
      );
    } catch (err) {
      lines.push(`${f.name}: ${(err as Error).message}`);
    }
  }
  out.textContent = lines.join('\n');
});
