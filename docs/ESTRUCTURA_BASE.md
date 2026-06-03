# Estructura de datos

## Hojas principales

### Productos

Catálogo y stock actual.

Columnas:

```text
ID_PRODUCTO
CODIGO
PRODUCTO
DESCRIPCION
CATEGORIA
PRECIO_COMPRA_REVENTA
PRECIO_VENTA_SUGERIDO
PRECIO_VENTA_PROPIO
STOCK_ACTUAL
ACTIVO
CANT_DESC_1
DESC_1
CANT_DESC_2
DESC_2
FECHA_ACTUALIZACION
```

### Pacientes

Personas a las que se entrega o vende producto.

### Ventas

Cabecera de cada entrega/venta.

Incluye total, pagado, saldo y estado.

### DetalleVentas

Productos de cada venta.

### Pagos

Registro de pagos totales o parciales.

### Compras

Cabecera de cada compra al proveedor/distribuidor.

### DetalleCompras

Productos comprados.

### MovimientosStock

Historial de entradas, salidas y anulaciones.

## Estados principales

Ventas:

```text
Pagada
Parcial
Pendiente
Anulada
```

Pedidos:

```text
Borrador
Confirmado
Anulado
```

## Conceptos de precio

```text
PRECIO_COMPRA_REVENTA
```

Es el precio que la médica paga al distribuidor.

```text
PRECIO_VENTA_SUGERIDO
```

Es el precio estimado para venta al paciente.

```text
PRECIO_VENTA_PROPIO
```

Es el precio que decide usar esa médica.
