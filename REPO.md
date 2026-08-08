# Repositorio de archivo — CRM Círculos Ciudadanos v15.29

**Este repositorio es LOCAL. No tiene remoto y no debe tenerlo.**

## Qué es

Snapshot forense del backup descargado de cPanel el 25 de abril de 2026, previo
al retiro del CRM del servidor. El primer commit (`a2e2022`) contiene el estado
**exacto** tal como se descargó, sin una sola modificación.

Propósito del control de versiones aquí:

1. **Integridad verificable.** Git guarda el hash SHA-1 de cada archivo. Si en el
   futuro alguien afirma que este código decía otra cosa, el historial lo
   desmiente con fechas y hashes.
2. **Diff contra producción.** Cuando se compare este backup contra lo que quedó
   en el servidor, el resultado se puede versionar en una rama aparte.

## Por qué NUNCA se sube a GitHub

| Motivo | Detalle |
|---|---|
| Token de administración en duro | `circmast.php:27` → `AC_TOKEN`. Es la VULN01 de la evaluación de seguridad de julio 2026. |
| Datos personales | `clientes_import.csv` y `pedidos_import.csv` contienen nombres y teléfonos reales. |
| Rango de IP del domicilio | `circmast.php:28` expone el rango Telmex desde el que se administraba. |
| Marco legal | El sistema trata CURP, clave de elector y afiliación política (dato **sensible** bajo LFPDPPP). |

Un repositorio privado de GitHub **no** es suficiente mitigación: el token sigue
siendo válido y los datos siguen saliendo de tu control.

Hay un hook `pre-push` instalado que bloquea cualquier intento de `git push`.

## Cómo se trabaja aquí

```bash
git status              # ver qué cambió
git diff                # ver el detalle línea por línea
git add -A              # preparar cambios
git commit -m "mensaje" # sellar el cambio
git log --oneline       # historial
```

Para comparar contra la versión de producción, crear una rama:

```bash
git checkout -b produccion-jun2026
```

...copiar encima los archivos descargados del servidor, y luego:

```bash
git diff main
```

Eso responde de forma definitiva la pregunta pendiente: qué se modificó durante
las tres semanas del incidente.

## Pendiente de seguridad

`AC_TOKEN` debe rotarse y moverse al archivo de secretos externo **antes** de
que este código vuelva a producción. No se corrige en este repositorio porque
alteraría el valor probatorio del snapshot.
