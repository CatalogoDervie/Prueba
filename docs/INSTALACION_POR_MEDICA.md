# Instalación paso a paso por médica

## 1. Crear la base

Para cada médica, crear o copiar una Google Sheet con el nombre:

```text
Control de Cremas - Dra. Nombre
```

Esa planilla es la base de datos de esa médica.

## 2. Copiar el ID de la planilla

Abrir la planilla y copiar la parte que está entre `/d/` y `/edit`.

Ejemplo:

```text
https://docs.google.com/spreadsheets/d/18K0DbRbM9ztIzfTmUIAzAUltrsff96dfjaCcNiLCnVE/edit
```

El ID sería:

```text
18K0DbRbM9ztIzfTmUIAzAUltrsff96dfjaCcNiLCnVE
```

## 3. Configurar Apps Script

En Apps Script, abrir `Code.gs` y cambiar esta línea:

```javascript
const SPREADSHEET_ID = '18K0DbRbM9ztIzfTmUIAzAUltrsff96dfjaCcNiLCnVE';
```

por el ID de la planilla de la médica.

## 4. Probar conexión

Ejecutar:

```javascript
testConexionPlanilla
```

Si devuelve el nombre de la planilla, la conexión está correcta.

## 5. Inicializar sistema

Ejecutar:

```javascript
inicializarSistema
```

Esto crea las hojas faltantes y respeta los productos ya cargados.

## 6. Publicar página

Ir a:

```text
Implementar > Nueva implementación > Aplicación web
```

Configuración recomendada:

```text
Ejecutar como: Yo
Quién tiene acceso: Cualquier persona con el enlace
```

## 7. Guardar URL

Guardar la URL publicada junto al nombre de la médica.

Ejemplo:

```text
Dra. Sofía → URL web app → Planilla Sofía
Dra. María → URL web app → Planilla María
```
