---
paths:
  - "**/*.py"
---

<!-- Destino: ~/.claude/rules/python.md  (nivel usuario: aplica a TODOS tus proyectos). -->
<!-- Las secciones marcadas [AJUSTAR] describen un proyecto tipo, no uno tuyo concreto: -->
<!-- verificar contra el proyecto real antes de darlas por buenas. -->

# Python

## Entorno
- Fijar la versión real del proyecto, no una genérica. En el HTPC el webpanel corre con
  `C:\Users\HTPC\AppData\Local\Programs\Python\Python314\python.exe` (**3.14**), invocado por ruta completa.
- [AJUSTAR] Entorno virtual (`venv` o poetry) si el proyecto lo usa. El webpanel del HTPC **no** lo usa.

## Estilo
- PEP 8.
- Type hints en parámetros y valor de retorno de toda función.
- `dataclasses` o Pydantic para modelos de datos.
- f-strings para formatear.
- `pathlib` para rutas, no concatenación de strings.

## Convenciones
- `snake_case` variables y funciones · `PascalCase` clases · `UPPER_CASE` constantes.
- Funciones pequeñas y con una sola responsabilidad.
- Docstring en las funciones públicas.

## Estructura [AJUSTAR]
- Proyecto nuevo: `src/` código, `tests/` tests, `pyproject.toml` dependencias.
- Webpanel del HTPC: **no** sigue esa estructura — es `webpanel/app.py` (Flask + SSE) con
  `webpanel/templates/index.html`. No proponer reorganizarlo sin pedirlo antes.

## Tests [AJUSTAR — el webpanel del HTPC no tiene tests hoy]
- pytest. Tests unitarios de la lógica de negocio. Fixtures para el setup.

## Comandos [AJUSTAR por proyecto — verificar que existen antes de proponerlos]
- `python -m pytest` — tests
- `python -m pip install -r requirements.txt` — dependencias
- `python -m black .` — formato
- `python -m mypy .` — tipos

## Frontend servido por Flask
- Tras tocar JS o plantillas, recargar con `Ctrl+Shift+R`: si no, el navegador sirve la versión
  cacheada y parece que el cambio no ha hecho nada.
