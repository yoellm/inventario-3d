# Mundo Azul · Inventario 3D

Aplicación web para gestionar el stock cedido a la persona que realiza las ventas, registrar reservas y calcular cuánto dinero corresponde a Yoel y cuánto conserva la vendedora.

## Flujo de trabajo

1. El administrador crea los productos e indica el stock, el importe para Yoel y el precio final de venta.
2. La vendedora registra ventas o reservas desde el inventario o mediante QR.
3. La cabecera muestra las cantidades todavía pendientes: total cobrado, importe para Yoel y ganancia de la vendedora.
4. Cuando se entrega el dinero, el administrador pulsa **Cerrar liquidación**.
5. La liquidación queda guardada y únicamente se ponen a cero los contadores de ventas del periodo. El stock, las reservas y el historial se conservan.
6. En **Finanzas** se registran materiales, maquinaria, embalaje, mantenimiento y otros gastos. El panel calcula el resultado de Yoel restando esos gastos al importe de ventas que le corresponde.
7. Si el administrador vende un artículo por su cuenta, lo registra en **Mis ventas**. Se descuenta el stock y se suma el ingreso a Finanzas, sin modificar la liquidación de la vendedora.

## Archivos principales

- `index.html`: inventario, ventas, reservas y liquidaciones.
- `index.js`: lógica del inventario, ventas, reservas y liquidaciones.
- `catalogo.html`: catálogo público para clientes, accesible sin iniciar sesión.
- `catalogo.js` y `catalogo.css`: carga de productos públicos, búsqueda, filtros, ordenación y diseño adaptable del catálogo.
- `stock.html` y `stock.js`: consulta rápida del stock para usuarios autorizados, con búsqueda, filtros e impresión.
- `novedades.html` y `novedades.js`: historial de entradas de stock agrupado por fecha.
- `ventas-propias.html` y `ventas-propias.js`: registro privado de ventas del administrador, correcciones y actualización de stock.
- `operations-modern.css`: diseño Material compartido por Stock, Novedades y Mis ventas.
- `scanner.html`: consulta pública por QR y venta rápida para usuarios autenticados.
- `scanner.js`: lógica del lector QR y operaciones rápidas.
- `estadisticas.html`: informes históricos basados en movimientos.
- `estadisticas.js`: cálculos, gráficos y exportaciones de estadísticas.
- `logs.html`: auditoría de operaciones.
- `logs.js`: filtros, cálculos y exportación de movimientos.
- `gastos.html`: gastos, inversión, ingresos para Yoel y resultado neto por periodo.
- `gastos.js`: lógica financiera y gestión de gastos.
- `finanzas.css`: diseño específico del panel financiero.
- `pages-modern.css`: estilo común de las pantallas secundarias.
- `theme-dark.css`: tema oscuro plano común a toda la aplicación.
- `pwa-register.js`: registro de la aplicación instalable.
- `firebase-config.js`: configuración compartida de Firebase y usuarios autorizados.
- `app-bootstrap.js`: carga Firebase de forma compatible tanto con la web publicada como al abrir los HTML desde la carpeta local.
- `database.rules.json`: reglas recomendadas para Firebase Realtime Database.
- `storage.rules`: reglas recomendadas para imágenes en Firebase Storage.
- `manifest.webmanifest` y `sw.js`: instalación como aplicación web.
- `pwa-register.js`: botón de instalación, instrucciones para iPhone, control de actualizaciones y avisos de conexión.
- `offline.html`: pantalla segura cuando la aplicación se abre sin conexión.
- `app-icon-192.png`, `app-icon-512.png`, `app-icon-maskable-512.png` y `apple-touch-icon.png`: iconos para Android, iPhone y accesos directos.

## Seguridad

Las comprobaciones visuales del navegador no sustituyen las reglas de Firebase. Después de revisar los correos autorizados, las reglas incluidas deben publicarse en el proyecto `savvy-nature-200119` desde Firebase Console o Firebase CLI.

El catálogo de clientes usa únicamente la rama `productos_publicos`. Para abrirlo sin iniciar sesión es imprescindible publicar la versión incluida de `database.rules.json`; la aplicación mantiene esa rama sincronizada al crear, editar, vender o reponer productos. La dirección pública termina en `/catalogo.html`.

No se deben realizar ventas sin conexión: la aplicación necesita confirmar cada transacción con Firebase para evitar vender dos veces la misma unidad.

Los HTML pueden abrirse directamente desde la carpeta. La instalación PWA y su manifiesto solo se activan cuando la aplicación se sirve mediante HTTP/HTTPS.

## Aplicación móvil instalable

La web funciona como PWA cuando está publicada mediante HTTPS. En Android aparece el botón **Instalar aplicación** cuando el navegador confirma que puede instalarse. En iPhone el mismo botón explica cómo usar **Compartir → Añadir a pantalla de inicio**. Las actualizaciones nuevas muestran un aviso y solo recargan después de pulsar **Actualizar**, evitando interrumpir una operación en curso.

La interfaz básica puede abrirse sin conexión, pero las ventas, reservas y cambios de stock requieren internet para confirmarse en Firebase.

El resultado financiero mostrado es orientativo y anterior a impuestos. Las ventas se calculan a partir del historial disponible; por ello no conviene borrar los movimientos.
