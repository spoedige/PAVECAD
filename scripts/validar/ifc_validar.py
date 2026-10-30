"""Valida um IFC com ifcopenshell.validate (esquema e regras de sintaxe/WHERE) e, se instalado, com ifctester.
Uso: python3 scripts/validar/ifc_validar.py arquivo.ifc
Imprime JSON com contagens e erros. Sai com 0 quando não há erros, 1 quando há, 2 quando o ifcopenshell não está instalado."""
import json
import sys

try:
    import ifcopenshell
    import ifcopenshell.validate
except ImportError:
    print(json.dumps({"erro": "ifcopenshell não instalado (pip install ifcopenshell)"}))
    sys.exit(2)


class Registro:
    def __init__(self):
        self.erros = []

    def set_state(self, *_):
        pass

    def error(self, msg):
        self.erros.append(str(msg))

    def warning(self, msg):
        pass

    def info(self, msg):
        pass

    def debug(self, msg):
        pass

    def critical(self, msg):
        self.erros.append(str(msg))


def main(caminho):
    f = ifcopenshell.open(caminho)
    log = Registro()
    ifcopenshell.validate.validate(f, log, express_rules=True)
    contagem = {t: len(f.by_type(t)) for t in (
        "IfcProject", "IfcSite", "IfcRoad", "IfcRoadPart", "IfcPavement", "IfcPavementType", "IfcMaterial", "IfcAnnotation",
        "IfcPropertySet", "IfcElementQuantity", "IfcMapConversion", "IfcProjectedCRS",
    )}
    gids = [e.GlobalId for e in f.by_type("IfcRoot")]
    # entidades órfãs: instâncias soltas (sem nenhuma referência) ou objetos fora da hierarquia
    orfas = []
    for e in f:
        if e.is_a("IfcProject") or e.is_a("IfcMapConversion") or e.is_a("IfcUnitAssignment") or e.is_a("IfcRelationship"):
            continue
        if not f.get_total_inverses(e):
            orfas.append(f"#{e.id()} {e.is_a()}")
            continue
        if e.is_a("IfcPavement") and not e.ContainedInStructure:
            orfas.append(f"#{e.id()} {e.is_a()} fora da estrutura espacial")
        elif (e.is_a("IfcSite") or e.is_a("IfcRoad") or e.is_a("IfcRoadPart")) and not e.Decomposes:
            orfas.append(f"#{e.id()} {e.is_a()} fora da agregação")
        elif e.is_a("IfcPavementType") and not e.Types:
            orfas.append(f"#{e.id()} {e.is_a()} sem ocorrências")
        elif e.is_a("IfcPropertySetDefinition") and not e.DefinesOccurrence:
            orfas.append(f"#{e.id()} {e.is_a()} sem objeto")
        elif e.is_a("IfcMaterial") and not e.AssociatedTo:
            orfas.append(f"#{e.id()} {e.is_a()} sem objeto")
    ids_tester = None
    try:
        import ifctester
        import ifctester.ids
        import ifctester.reporter

        ids = ifctester.ids.Ids(title="PAVTRACK")
        spec = ifctester.ids.Specification(name="Pavimento com propriedades", ifcVersion=["IFC4X3_ADD2"], minOccurs=0)
        spec.applicability.append(ifctester.ids.Entity(name="IFCPAVEMENT"))
        spec.requirements.append(ifctester.ids.Property(propertySet="PAVTRACK_Trecho", baseName="Codigo", cardinality="required"))
        spec.requirements.append(ifctester.ids.Property(propertySet="PAVTRACK_Trecho", baseName="Area", cardinality="required"))
        spec.requirements.append(ifctester.ids.Material(cardinality="required"))
        ids.specifications.append(spec)
        ids.validate(f)
        ids_tester = {"aprovado": all(s.status for s in ids.specifications), "especificacoes": len(ids.specifications)}
    except ImportError:
        ids_tester = {"indisponivel": True}
    saida = {
        "schema": f.schema_identifier, "contagem": contagem, "erros": log.erros[:20], "nErros": len(log.erros),
        "globalIdsUnicos": len(gids) == len(set(gids)), "nGlobalIds": len(gids), "orfas": orfas[:10], "nOrfas": len(orfas), "ifctester": ids_tester,
    }
    print(json.dumps(saida, ensure_ascii=False))
    return 0 if not log.erros else 1


sys.exit(main(sys.argv[1]))
