"""Valida um KML contra o esquema oficial do KML 2.2 (ogckml22.xsd, que vem no pacote pykml).
Uso: python3 scripts/validar/kml_xsd.py arquivo.kml
Sai com código 0 quando válido, 1 quando há erro, 2 quando o validador não está instalado."""
import os
import sys

try:
    from lxml import etree
    import pykml
except ImportError:
    print("pykml/lxml não instalados (pip install pykml)")
    sys.exit(2)

xsd = os.path.join(os.path.dirname(pykml.__file__), "schemas", "ogckml22.xsd")
esquema = etree.XMLSchema(etree.parse(xsd))
doc = etree.parse(sys.argv[1])
if esquema.validate(doc):
    print("KML 2.2 válido")
    sys.exit(0)
for e in list(esquema.error_log)[:10]:
    print(f"linha {e.line}: {e.message}")
sys.exit(1)
