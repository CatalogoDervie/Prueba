# Control de Cremas - una página por médica

Sistema en Google Apps Script + Google Sheets para manejar stock, entregas/ventas, compras, pagos parciales, deudores y anulación con devolución automática al stock.

## Estructura recomendada

La base de datos no está en GitHub. GitHub guarda el código.

Cada médica debe tener su propia planilla en Drive:

```text
Drive de la médica
└── Control de Cremas - Dra. Nombre
    ├── Configuracion
    ├── Productos
    ├── Pacientes
    ├── Pedidos
    ├── DetallePedidos
    ├── Compras
    ├── DetalleCompras
    ├── Ventas
    ├── DetalleVentas
    ├── Pagos
    ├── MovimientosStock
    └── Listas
```

La página web de esa médica se conecta a su planilla con el valor:

```javascript
const SPREADSHEET_ID = 'ID_DE_LA_PLANILLA';
```

## Archivos de Apps Script

Copiar estos archivos en el proyecto de Apps Script:

- `AppsScript/Code.gs`
- `AppsScript/Index.html`
- `AppsScript/Style.html`
- `AppsScript/Script.html`
- `AppsScript/appsscript.json`

## Instalación por médica

1. Copiar la planilla base en el Drive de la médica.
2. Abrir la planilla.
3. Copiar el ID de la URL:
   `https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit`
4. En `AppsScript/Code.gs`, cambiar:
   `const SPREADSHEET_ID = '...'`
5. Ejecutar `testConexionPlanilla`.
6. Ejecutar `inicializarSistema`.
7. Ir a `Implementar > Nueva implementación`.
8. Elegir `Aplicación web`.
9. Ejecutar como: `Yo`.
10. Acceso: según necesidad.
11. Guardar la URL de la página de esa médica.

## Regla actual

- Compra base: 15 unidades del mismo producto = 20% de descuento.
- Anulación de venta: vuelve el stock y queda registro en movimientos.
- Pago parcial: queda saldo como deuda.
- Precio compra/reventa: lo que la médica paga al distribuidor.
- Precio venta sugerido/propio: lo que se vende o sugiere vender al paciente.

## Nota

Este repositorio queda como fuente de código. Las bases reales quedan en Google Sheets para que sean fáciles de revisar, conectar y exportar.
